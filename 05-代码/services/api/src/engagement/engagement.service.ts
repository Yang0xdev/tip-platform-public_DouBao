import { HttpException, Injectable } from "@nestjs/common";
import {
  consultationMachine,
  relationshipMachine,
  type ConsultationState,
  type ConsultationEvent,
  type RelationshipState
} from "@tip/core";
import type { StateMachine } from "@tip/core";
import { AuditService } from "../audit.service.js";

function must<T extends string, E extends string>(m: StateMachine<T, E, unknown>, from: T, event: E): T {
  const out = m.transition(undefined as never, from, event);
  if (!out.ok) throw new EngagementError(409, "42130", out.reason ?? `当前状态不允许该操作（${from} → ${event}）`);
  return out.to as T;
}

/**
 * M2-01/02 咨询捕获 + 分配队列 + 服务关系双向确认（engagement 限界上下文）。
 * 铁律：
 *  - 预约沟通只产生咨询，绝不成立关系、不授权问卷；
 *  - 关系 active 必须同时具备客户发起事件与顾问接受事件（D7）；
 *  - 一名客户一名主责；冲突未裁决锁方案/订单（assertWritable）；
 *  - 点击/浏览/分享来源不产生归属；问卷解读授权与关系解耦、可撤回；
 *  - 顾问只能看自己的队列与客户，越权 403 并审计 deny。
 */

export type ConsultationSource =
  | "assessment_explain"
  | "card_appointment"
  | "card_request"
  | "share_link"
  | "manual";

export interface Consultation {
  id: string;
  source: ConsultationSource;
  customerRef: string;
  /** 重复线索键：手机号或证件哈希（只存哈希/掩码，不存原文） */
  duplicateKey: string | null;
  advisorId: string | null;
  state: ConsultationState;
  questionnaireGranted: boolean;
  projectCode: string | null;
  note: string | null;
  conflictReason: string | null;
  history: Array<{ at: string; event: string; actor: string; detail?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface Relationship {
  id: string;
  consultationId: string;
  customerRef: string;
  advisorId: string | null;
  state: RelationshipState;
  customerInitiated: boolean;
  customerEventAt: string | null;
  advisorAcceptedAt: string | null;
  endReason: string | null;
  createdAt: string;
  updatedAt: string;
}

class EngagementError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

const DUP_WINDOW_MS = 90 * 24 * 3600 * 1000;

@Injectable()
export class EngagementService {
  private consultations = new Map<string, Consultation>();
  private relationships = new Map<string, Relationship>();
  private seq = 0;

  constructor(private readonly audit: AuditService) {}

  private newId(prefix: string) {
    this.seq += 1;
    return `${prefix}-${String(this.seq).padStart(4, "0")}`;
  }

  private now() {
    return new Date().toISOString();
  }

  private getConsultation(id: string): Consultation {
    const c = this.consultations.get(id);
    if (!c) throw new EngagementError(404, "42101", "咨询不存在或不可见");
    return c;
  }

  private getRelationshipByConsultation(consultationId: string): Relationship | null {
    for (const r of this.relationships.values()) if (r.consultationId === consultationId) return r;
    return null;
  }

  private activeRelationship(customerRef: string): Relationship | null {
    for (const r of this.relationships.values()) {
      if (r.customerRef === customerRef && (r.state === "active" || r.state === "requested" || r.state === "handoff_frozen")) return r;
    }
    return null;
  }

  private transition(c: Consultation, event: ConsultationEvent, actor: string, detail?: string) {
    const next = must(consultationMachine, c.state, event);
    c.state = next;
    c.history.push({ at: this.now(), event, actor, detail });
    c.updatedAt = this.now();
  }

  /** 客户：预约沟通 / 请求服务 / 初评请人解读 / 分享落地 / 后台手工录入 */
  capture(input: {
    source: ConsultationSource;
    customerRef: string;
    duplicateKey?: string | null;
    advisorId?: string | null;
    projectCode?: string | null;
    note?: string | null;
    actor: string;
  }): { consultation: Consultation; relationship: Relationship | null } {
    const at = this.now();
    const id = this.newId("CON");
    const isRequest = input.source === "card_request" || input.source === "assessment_explain";

    // 指定顾问的服务请求：已有主责关系直接拒绝（换顾问走 M2 交接五步，不新建并行关系）
    if (isRequest && input.advisorId) {
      const active = this.activeRelationship(input.customerRef);
      if (active?.state === "active") {
        throw new EngagementError(409, "42102", `该客户已有主责顾问关系 ${active.id}，一名客户仅一名主责`);
      }
    }

    // 预约/分享不成立关系；只有明确"请求 TA 服务我/请顾问解读"且指定顾问才进入待接受
    const c: Consultation = {
      id,
      source: input.source,
      customerRef: input.customerRef,
      duplicateKey: input.duplicateKey ?? null,
      advisorId: input.advisorId ?? null,
      state: isRequest && input.advisorId ? "pending_accept" : "pending_assign",
      questionnaireGranted: false,
      projectCode: input.projectCode ?? null,
      note: input.note ?? null,
      conflictReason: null,
      history: [{ at, event: "capture", actor: input.actor, detail: input.source }],
      createdAt: at,
      updatedAt: at
    };

    // 重复线索：同键近 90 天已有关系 → 冲突队列，锁方案/订单
    if (input.duplicateKey) {
      const dup = this.findRecentDuplicate(input.customerRef, input.duplicateKey);
      if (dup) {
        c.state = "conflict_pending";
        c.conflictReason = `近 90 天存在关系 ${dup.id}（顾问 ${dup.advisorId ?? "未分配"}），进冲突裁决`;
        c.history.push({ at, event: "flag_conflict", actor: "system", detail: c.conflictReason });
      }
    }

    this.consultations.set(id, c);

    let rel: Relationship | null = null;
    if (isRequest && input.advisorId && c.state === "pending_accept") {
      rel = this.createRelationship(id, input.customerRef, input.advisorId, true, at, input.actor);
    }

    this.audit.record({
      actor: input.actor,
      realm: input.actor.startsWith("c-") ? "customer" : "staff",
      action: "engagement.capture",
      resource: id,
      result: "allow",
      subjectRef: input.customerRef
    });
    return { consultation: c, relationship: rel };
  }

  private findRecentDuplicate(customerRef: string, key: string): Relationship | null {
    const since = Date.now() - DUP_WINDOW_MS;
    for (const r of this.relationships.values()) {
      if (r.customerRef !== customerRef && r.state !== "ended" && r.state !== "declined") {
        const c = this.consultations.get(r.consultationId);
        if (c?.duplicateKey === key && Date.parse(r.createdAt) >= since) return r;
      }
    }
    return null;
  }

  private createRelationship(
    consultationId: string,
    customerRef: string,
    advisorId: string,
    customerInitiated: boolean,
    at: string,
    actor: string
  ): Relationship {
    const id = this.newId("REL");
    const r: Relationship = {
      id,
      consultationId,
      customerRef,
      advisorId,
      state: "requested",
      customerInitiated,
      customerEventAt: customerInitiated ? at : null,
      advisorAcceptedAt: null,
      endReason: null,
      createdAt: at,
      updatedAt: at
    };
    this.relationships.set(id, r);
    this.audit.record({ actor, realm: customerInitiated ? "customer" : "staff", action: "relationship.request", resource: id, result: "allow", subjectRef: customerRef });
    return r;
  }

  /** 后台 A04：人工分配（首期不自动派单） */
  assign(id: string, advisorId: string, staff: string): { consultation: Consultation; relationship: Relationship | null } {
    const c = this.getConsultation(id);
    if (c.state === "pending_assign" || c.state === "reassigned" || c.state === "resolved") {
      c.advisorId = advisorId;
      this.transition(c, "assign", staff, `分配顾问 ${advisorId}`);
    } else {
      throw new EngagementError(409, "42103", `当前状态 ${c.state} 不可分配`);
    }
    // 平台分配的线索：关系要等客户确认（双向确认的客户事件），此处不建关系
    const rel = this.getRelationshipByConsultation(id);
    this.audit.record({ actor: staff, realm: "staff", action: "engagement.assign", resource: id, result: "allow", subjectRef: c.customerRef });
    return { consultation: c, relationship: rel };
  }

  /** 客户确认平台分配的顾问 → 关系 requested（客户事件） */
  confirmAssignment(id: string, customerRef: string): Relationship {
    const c = this.getConsultation(id);
    if (c.customerRef !== customerRef) throw new EngagementError(403, "42104", "只能确认本人的咨询");
    if (c.state !== "pending_accept" || !c.advisorId) throw new EngagementError(409, "42105", "当前没有待确认的分配");
    let rel = this.getRelationshipByConsultation(id);
    if (!rel) rel = this.createRelationship(id, c.customerRef, c.advisorId, false, this.now(), customerRef);
    if (!rel.customerEventAt) {
      rel.customerEventAt = this.now();
      rel.updatedAt = this.now();
    }
    this.audit.record({ actor: customerRef, realm: "customer", action: "relationship.customer_confirm", resource: rel.id, result: "allow", subjectRef: customerRef });
    return rel;
  }

  /** 顾问接受：关系 active（顾问事件）；咨询 accepted */
  accept(id: string, advisorId: string): { consultation: Consultation; relationship: Relationship } {
    const c = this.getConsultation(id);
    if (c.advisorId !== advisorId) {
      this.audit.record({ actor: advisorId, realm: "partner", action: "engagement.accept", resource: id, result: "deny", reason: "非本人队列" });
      throw new EngagementError(403, "42106", "该咨询不在你的队列");
    }
    if (c.state !== "pending_accept") throw new EngagementError(409, "42107", `当前状态 ${c.state} 不可接受`);
    const rel = this.getRelationshipByConsultation(id);
    if (!rel || !rel.customerEventAt) throw new EngagementError(409, "42108", "客户尚未发起/确认服务请求，双向确认未完成");
    const at = this.now();
    rel.state = must(relationshipMachine, rel.state, "accept");
    rel.advisorAcceptedAt = at;
    rel.updatedAt = at;
    this.transition(c, "accept", advisorId, "顾问接受，关系成立");
    this.audit.record({ actor: advisorId, realm: "partner", action: "relationship.accept", resource: rel.id, result: "allow", subjectRef: c.customerRef });
    return { consultation: c, relationship: rel };
  }

  /** 顾问转分配（回队列，必填原因） */
  reassign(id: string, advisorId: string, reason: string): Consultation {
    if (!reason?.trim()) throw new EngagementError(422, "42109", "转分配必须填写原因");
    const c = this.getConsultation(id);
    if (c.advisorId !== advisorId) throw new EngagementError(403, "42110", "只能转分配自己队列中的咨询");
    if (c.state !== "pending_accept") throw new EngagementError(409, "42111", `当前状态 ${c.state} 不可转分配`);
    const rel = this.getRelationshipByConsultation(id);
    if (rel && rel.state === "requested") {
      rel.state = must(relationshipMachine, rel.state, "reassign");
      rel.updatedAt = this.now();
    }
    c.advisorId = null;
    this.transition(c, "reassign", advisorId, reason);
    this.audit.record({ actor: advisorId, realm: "partner", action: "engagement.reassign", resource: id, result: "allow", reason });
    return c;
  }

  /** 客户在顾问接受前撤回 */
  withdraw(id: string, customerRef: string): Consultation {
    const c = this.getConsultation(id);
    if (c.customerRef !== customerRef) throw new EngagementError(403, "42112", "只能撤回本人的咨询");
    if (c.state !== "pending_assign" && c.state !== "pending_accept") throw new EngagementError(409, "42113", "当前状态不可撤回");
    const rel = this.getRelationshipByConsultation(id);
    if (rel?.state === "active") throw new EngagementError(409, "42114", "关系已成立，不可撤回，请走结束流程");
    if (rel && rel.state === "requested") {
      rel.state = must(relationshipMachine, rel.state, "decline");
      rel.endReason = "客户接受前撤回";
      rel.updatedAt = this.now();
    }
    this.transition(c, "close", customerRef, "客户撤回");
    this.audit.record({ actor: customerRef, realm: "customer", action: "engagement.withdraw", resource: id, result: "allow" });
    return c;
  }

  /** 冲突裁决：归位给 advisorId（或关闭） */
  resolveConflict(id: string, staff: string, advisorId: string | null, reason: string): Consultation {
    const c = this.getConsultation(id);
    if (c.state !== "conflict_pending") throw new EngagementError(409, "42115", "仅冲突待裁决可裁决");
    this.transition(c, "resolve", staff, reason);
    if (advisorId) {
      c.advisorId = advisorId;
      this.transition(c, "assign", staff, `裁决归位 ${advisorId}`);
    } else {
      this.transition(c, "close", staff, "裁决关闭：重复线索");
    }
    this.audit.record({ actor: staff, realm: "staff", action: "engagement.resolve_conflict", resource: id, result: "allow", reason });
    return c;
  }

  /** 问卷解读授权（与关系解耦，默认不授权，可撤回） */
  setQuestionnaireGrant(id: string, customerRef: string, granted: boolean): Consultation {
    const c = this.getConsultation(id);
    if (c.customerRef !== customerRef) throw new EngagementError(403, "42116", "只能授权本人的问卷");
    c.questionnaireGranted = granted;
    c.updatedAt = this.now();
    this.audit.record({ actor: customerRef, realm: "customer", action: "engagement.questionnaire_grant", resource: id, result: "allow", reason: granted ? "授权" : "撤回" });
    return c;
  }

  /* ---------------- 查询（分角色严格过滤） ---------------- */

  /** 顾问队列：只含分配给我的 */
  advisorQueue(advisorId: string, chip: "pending_accept" | "active" | "all" = "all") {
    const rows = [];
    for (const c of this.consultations.values()) {
      if (c.advisorId !== advisorId) continue;
      const rel = this.getRelationshipByConsultation(c.id);
      if (chip === "pending_accept" && c.state !== "pending_accept") continue;
      if (chip === "active" && rel?.state !== "active") continue;
      rows.push(this.maskConsultation(c, rel));
    }
    return rows;
  }

  /** 顾问客户列表（仅 active 关系；无全平台检索） */
  advisorClients(advisorId: string) {
    return [...this.relationships.values()]
      .filter((r) => r.advisorId === advisorId && r.state === "active")
      .map((r) => ({ id: r.id, customerRef: r.customerRef, customerEventAt: r.customerEventAt, advisorAcceptedAt: r.advisorAcceptedAt, consultationId: r.consultationId }));
  }

  /** 顾问读取单个客户详情：越权 → 403 + 审计 deny */
  advisorClientView(advisorId: string, relationshipId: string) {
    const r = this.relationships.get(relationshipId);
    if (!r || r.advisorId !== advisorId) {
      this.audit.record({ actor: advisorId, realm: "partner", action: "relationship.view", resource: relationshipId, result: "deny", reason: "越权查看他人客户" });
      throw new EngagementError(403, "42117", "该客户不在你的服务关系中");
    }
    const c = this.consultations.get(r.consultationId)!;
    return { relationship: r, consultation: this.maskConsultation(c, r) };
  }

  /** 后台队列：待分配 + 冲突；脱敏摘要 */
  adminQueue() {
    return [...this.consultations.values()]
      .filter((c) => c.state === "pending_assign" || c.state === "conflict_pending" || c.state === "reassigned")
      .map((c) => ({ ...c, note: c.note ? `${c.note.slice(0, 20)}…（脱敏）` : null }));
  }

  adminListRelationships() {
    return [...this.relationships.values()];
  }

  /** M2 后续切片的方案/订单写入门：冲突期或关系未 active 一律拒绝 */
  assertWritable(customerRef: string, advisorId: string): Relationship {
    for (const c of this.consultations.values()) {
      if (c.customerRef === customerRef && c.state === "conflict_pending") {
        throw new EngagementError(409, "42118", "客户线索冲突待裁决，方案与订单已锁定");
      }
    }
    const rel = this.activeRelationship(customerRef);
    if (!rel || rel.state !== "active") throw new EngagementError(409, "42119", "服务关系未双向确认，不可发起方案/订单");
    if (rel.advisorId !== advisorId) throw new EngagementError(403, "42120", "主责顾问不匹配");
    return rel;
  }

  /** 对客 DTO：不暴露内部分配备注 */
  private maskConsultation(c: Consultation, rel: Relationship | null) {
    return {
      id: c.id,
      source: c.source,
      state: c.state,
      projectCode: c.projectCode,
      advisorId: c.advisorId,
      questionnaireGranted: c.questionnaireGranted,
      conflictReason: c.conflictReason,
      relationshipState: rel?.state ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    };
  }

  customerList(customerRef: string) {
    return [...this.consultations.values()]
      .filter((c) => c.customerRef === customerRef)
      .map((c) => this.maskConsultation(c, this.getRelationshipByConsultation(c.id)));
  }
}
