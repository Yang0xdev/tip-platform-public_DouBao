import { HttpException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { CaseService } from "../case/case.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";

/**
 * M3-11 顾问交接五步与停新接旧。
 * 触发：授权到期/离职/暂停/调查/机构备案到期/客户申请。
 * 五步（缺一不可切换）：
 *  1 客户发起或同意；
 *  2 冻结新分配/报价/合同（关系 handoff_frozen，接口级停新）；
 *  3 资料与在办交接清单（案件/材料/任务逐项）；
 *  4 新顾问接受（其授权须有效）；
 *  5 切换并通知客户。
 * 完成前旧顾问承担在办责任；顾问不可自行转客户；强制交接须 A04 双人复核。
 */

export interface HandoverSteps {
  consent: { at: string; by: string } | null;
  freeze: { at: string; by: string } | null;
  checklist: { at: string; by: string; items: number } | null;
  accept: { at: string; by: string } | null;
  notify: { at: string; by: string } | null;
}

export interface HandoverRecord {
  id: string;
  relationshipId: string;
  customerRef: string;
  fromAdvisorId: string;
  toAdvisorId: string | null;
  reason: string;
  forced: boolean;
  reviewers: string[];
  steps: HandoverSteps;
  state: "in_progress" | "completed" | "cancelled";
  createdAt: string;
}

class HandoverError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class HandoverService {
  private records = new Map<string, HandoverRecord>();
  private seq = 0;

  constructor(
    private readonly engagements: EngagementService,
    private readonly cases: CaseService,
    private readonly authz: AuthorizationService,
    private readonly audit: AuditService
  ) {}

  /** 步骤1：发起（客户发起/同意；强制交接双人复核） */
  start(
    body: {
      relationshipId: string;
      toAdvisorId?: string;
      reason: string;
      customerConsent?: boolean;
      forced?: boolean;
      reviewers?: string[];
    },
    actor: string,
    realm: "customer" | "staff"
  ): HandoverRecord {
    const rel = this.engagements.getRelationship(body.relationshipId);
    if (!body.reason?.trim()) throw new HandoverError(422, "43302", "交接原因必填");

    // 顾问不可自行发起把客户转走
    if (realm === "staff" && !body.forced)
      throw new HandoverError(403, "43304", "顾问不可自行转客户；客户申请或强制交接才可发起");
    // 强制交接：A04 双人复核（两名不同复核人）
    if (body.forced) {
      const r = body.reviewers ?? [];
      if (new Set(r).size < 2)
        throw new HandoverError(422, "43302", "强制交接须两名不同复核人双人复核");
    } else {
      // 客户路径：须本人发起或显式同意
      const isCustomer = realm === "customer" && actor === rel.customerRef;
      if (!isCustomer && !body.customerConsent)
        throw new HandoverError(403, "43304", "须客户发起或明确同意");
    }

    this.seq += 1;
    const h: HandoverRecord = {
      id: `HO-${String(this.seq).padStart(4, "0")}`,
      relationshipId: rel.id,
      customerRef: rel.customerRef,
      fromAdvisorId: rel.advisorId!,
      toAdvisorId: body.toAdvisorId ?? null,
      reason: body.reason,
      forced: body.forced ?? false,
      reviewers: body.reviewers ?? [],
      steps: { consent: null, freeze: null, checklist: null, accept: null, notify: null },
      state: "in_progress",
      createdAt: new Date().toISOString()
    };
    h.steps.consent = { at: new Date().toISOString(), by: actor };
    this.records.set(h.id, h);
    this.audit.record({ actor, realm, action: "handover.start", resource: h.id, result: "allow", reason: body.reason });
    return h;
  }

  /** 步骤2：冻结停新 */
  freeze(id: string, actor: string): HandoverRecord {
    const h = this.require(id);
    if (!h.steps.consent) throw new HandoverError(409, "43303", "须先取得客户发起/同意");
    this.engagements.freezeForHandover(h.relationshipId, actor);
    h.steps.freeze = { at: new Date().toISOString(), by: actor };
    this.audit.record({ actor, realm: "staff", action: "handover.freeze", resource: id, result: "allow" });
    return h;
  }

  /** 步骤3：在办交接清单（案件×材料×任务逐项） */
  checklist(id: string, actor: string): HandoverRecord {
    const h = this.require(id);
    if (!h.steps.freeze) throw new HandoverError(409, "43303", "须先冻结停新");
    const caseCount = this.cases.list().filter((c) => c.customerRef === h.customerRef).length;
    h.steps.checklist = { at: new Date().toISOString(), by: actor, items: caseCount };
    this.audit.record({ actor, realm: "staff", action: "handover.checklist", resource: id, result: "allow", reason: `cases:${caseCount}` });
    return h;
  }

  /** 步骤4：新顾问接受（授权有效；不可自接？可接受；须与旧顾问不同） */
  accept(id: string, toAdvisorId: string, actor: string): HandoverRecord {
    const h = this.require(id);
    if (!h.steps.checklist) throw new HandoverError(409, "43303", "须先完成交接清单");
    if (actor !== toAdvisorId) throw new HandoverError(403, "43304", "须新顾问本人接受");
    if (toAdvisorId === h.fromAdvisorId) throw new HandoverError(422, "43302", "新顾问不能与旧顾问相同");
    // 新顾问授权须有效（可接案）
    const grant = this.authz.list().find((g) => g.advisorUserId === toAdvisorId);
    if (!grant || grant.state !== "authorized")
      throw new HandoverError(409, "43303", "新顾问授权无效/临期，不可接新案");
    h.toAdvisorId = toAdvisorId;
    h.steps.accept = { at: new Date().toISOString(), by: actor };
    this.audit.record({ actor, realm: "staff", action: "handover.accept", resource: id, result: "allow" });
    return h;
  }

  /** 步骤5：切换 + 通知（五步齐备才执行） */
  complete(id: string, actor: string): HandoverRecord {
    const h = this.require(id);
    const s = h.steps;
    if (!s.consent || !s.freeze || !s.checklist || !s.accept)
      throw new HandoverError(409, "43303", "五步缺一，不可切换");
    if (!h.toAdvisorId) throw new HandoverError(422, "43302", "未确定新顾问");
    this.engagements.completeHandover(h.relationshipId, h.toAdvisorId, actor);
    h.steps.notify = { at: new Date().toISOString(), by: actor };
    h.state = "completed";
    this.audit.record({ actor, realm: "staff", action: "handover.complete", resource: id, result: "allow", reason: h.toAdvisorId });
    return h;
  }

  cancel(id: string, actor: string): HandoverRecord {
    const h = this.require(id);
    h.state = "cancelled";
    this.audit.record({ actor, realm: "staff", action: "handover.cancel", resource: id, result: "allow" });
    return h;
  }

  list(): HandoverRecord[] {
    return [...this.records.values()];
  }

  private require(id: string): HandoverRecord {
    const h = this.records.get(id);
    if (!h) throw new HandoverError(404, "43301", "交接记录不存在");
    return h;
  }
}
