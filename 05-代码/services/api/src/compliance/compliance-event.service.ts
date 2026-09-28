import { Injectable } from "@nestjs/common";
import { complianceMachine, type ComplianceState } from "@tip/core";
import { AuditService } from "../audit.service.js";

/**
 * M4-04 合规事件工作台
 * 来源：投诉自动转、词库四生产点命中、主体门反复阻断、门户越权、审计异常、外部举报、财务异常。
 * 分级 L1/L2/L3；L3 双人审批；回避规则；处置动作组合且各自留痕；
 * 已发生合规佣金不连坐清零，逐笔决定（调 CommissionService）。
 */

export type EventSource =
  | "complaint_auto"
  | "banned_word"
  | "subject_gate"
  | "portal_breach"
  | "audit_anomaly"
  | "external_report"
  | "finance_anomaly";

export type DispositionKind =
  | "advisor_warning"
  | "retraining"
  | "suspend_authorization"
  | "terminate_partnership"
  | "freeze_portal_account"
  | "commission_freeze"
  | "commission_adjust"
  | "commission_clawback"
  | "refund_plan"
  | "evidence_preservation";

export interface Disposition {
  id: string;
  kind: DispositionKind;
  detail: string;
  approverId: string | null;
  executed: boolean;
}

export interface ComplianceEvent {
  id: string;
  source: EventSource;
  level: "L1" | "L2" | "L3";
  title: string;
  detail: string;
  relatedTicketId: string | null;
  respondentAdvisorId: string | null;
  state: ComplianceState;
  authorId: string;
  reviewerId: string | null;
  secondApproverId: string | null;
  investigatorIds: string[];
  dispositions: Disposition[];
  log: Array<{ at: string; to: ComplianceState; actor: string; note?: string }>;
  createdAt: string;
}

export class ComplianceError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

@Injectable()
export class ComplianceEventService {
  private events = new Map<string, ComplianceEvent>();
  private seq = 0;
  private dseq = 0;

  constructor(private readonly audit: AuditService) {}

  /** 工单自动转（无需人工判断严重性） */
  openFromTicket(t: { id: string; kind: string; title: string; description: string; respondentAdvisorId: string | null }, actor: string): ComplianceEvent {
    return this.open(
      {
        source: "complaint_auto",
        level: "L2",
        title: `投诉线索：${t.title}`,
        detail: t.description,
        relatedTicketId: t.id,
        respondentAdvisorId: t.respondentAdvisorId
      },
      actor
    );
  }

  open(
    body: {
      source: EventSource;
      level: "L1" | "L2" | "L3";
      title: string;
      detail: string;
      relatedTicketId?: string | null;
      respondentAdvisorId?: string | null;
    },
    actor: string
  ): ComplianceEvent {
    if (!body.title?.trim() || !body.detail?.trim())
      throw new ComplianceError("43801", "标题与事实描述必填");
    this.seq += 1;
    const e: ComplianceEvent = {
      id: `CEV-${String(this.seq).padStart(4, "0")}`,
      source: body.source,
      level: body.level,
      title: body.title,
      detail: body.detail,
      relatedTicketId: body.relatedTicketId ?? null,
      respondentAdvisorId: body.respondentAdvisorId ?? null,
      state: "new",
      authorId: actor,
      reviewerId: null,
      secondApproverId: null,
      investigatorIds: [],
      dispositions: [],
      log: [{ at: new Date().toISOString(), to: "new", actor }],
      createdAt: new Date().toISOString()
    };
    this.events.set(e.id, e);
    this.audit.record({ realm: "staff", action: "compliance.event.opened", resource: e.id, result: "info", reason: e.source, actor });
    return e;
  }

  /** 分级（可人工调整并留理由） */
  triage(id: string, level: "L1" | "L2" | "L3", actor: string, note?: string): ComplianceEvent {
    const e = this.must(id);
    e.level = level;
    this.move(e, "triage", actor, note ?? `分级 ${level}`);
    return e;
  }

  investigate(id: string, investigatorId: string, excluded: string[] = []): ComplianceEvent {
    const e = this.must(id);
    if (excluded.includes(investigatorId))
      throw new ComplianceError("43802", "调查人适用回避规则");
    if (e.respondentAdvisorId && investigatorId === e.respondentAdvisorId)
      throw new ComplianceError("43803", "当事人不可调查本人事件");
    if (!e.investigatorIds.includes(investigatorId)) e.investigatorIds.push(investigatorId);
    this.move(e, "investigate", investigatorId);
    return e;
  }

  addDisposition(id: string, kind: DispositionKind, detail: string, actor: string): Disposition {
    const e = this.must(id);
    if (e.state !== "investigating")
      throw new ComplianceError("43804", "调查中才可登记处置方案");
    if (!detail?.trim()) throw new ComplianceError("43805", "处置说明必填");
    this.dseq += 1;
    const d: Disposition = {
      id: `DSP-${String(this.dseq).padStart(4, "0")}`,
      kind,
      detail,
      approverId: null,
      executed: false
    };
    e.dispositions.push(d);
    this.audit.record({ realm: "staff", action: "compliance.disposition.added", resource: e.id, result: "info", reason: kind, actor });
    return d;
  }

  propose(id: string, actor: string): ComplianceEvent {
    const e = this.must(id);
    if (!e.dispositions.length) throw new ComplianceError("43806", "无处置方案不可提交审批");
    this.move(e, "propose", actor);
    return e;
  }

  /** 决定：四眼（编制/审批不同人）；L3 双人审批 */
  decide(id: string, approverId: string, secondApproverId?: string): ComplianceEvent {
    const e = this.must(id);
    if (approverId === e.authorId)
      throw new ComplianceError("43807", "审批人不可为事件编制人");
    e.reviewerId = approverId;
    if (e.level === "L3") {
      if (!secondApproverId) throw new ComplianceError("43808", "L3 事件须双人审批");
      if (secondApproverId === approverId)
        throw new ComplianceError("43809", "两位审批人不得为同一人");
      e.secondApproverId = secondApproverId;
    }
    const r = complianceMachine.transition(
      {
        authorId: e.authorId,
        reviewerId: approverId,
        level: e.level,
        secondApproverId: e.secondApproverId
      },
      e.state,
      "decide"
    );
    if (!r.ok) throw new ComplianceError("43810", r.reason ?? "决定守卫拒绝");
    e.state = r.to!;
    e.log.push({ at: new Date().toISOString(), to: e.state, actor: approverId });
    return e;
  }

  approveDisposition(eventId: string, dispositionId: string, approverId: string): Disposition {
    const e = this.must(eventId);
    if (e.state !== "decided") throw new ComplianceError("43811", "事件决定后处置才可审批执行");
    const d = e.dispositions.find((x) => x.id === dispositionId)!;
    if (approverId === e.authorId)
      throw new ComplianceError("43812", "处置审批人不可为编制人");
    d.approverId = approverId;
    d.executed = true;
    this.audit.record({ realm: "staff", action: "compliance.disposition.executed", resource: dispositionId, result: "allow", actor: approverId });
    return d;
  }

  close(id: string, actor: string): ComplianceEvent {
    const e = this.must(id);
    if (e.dispositions.some((d) => !d.executed))
      throw new ComplianceError("43813", "尚有处置未执行，不可归档");
    this.move(e, "close", actor);
    return e;
  }

  appeal(id: string, actor: string): ComplianceEvent {
    const e = this.must(id);
    this.move(e, "appeal", actor);
    return e;
  }

  reviewAppeal(id: string, reviewerId: string): ComplianceEvent {
    const e = this.must(id);
    if (e.investigatorIds.includes(reviewerId))
      throw new ComplianceError("43814", "申诉复核人未参与原调查");
    this.move(e, "review_appeal", reviewerId);
    return e;
  }

  list(): ComplianceEvent[] {
    return [...this.events.values()];
  }

  private must(id: string): ComplianceEvent {
    const e = this.events.get(id);
    if (!e) throw new ComplianceError("43815", "合规事件不存在");
    return e;
  }

  private move(e: ComplianceEvent, event: Parameters<typeof complianceMachine.transition>[2], actor: string, note?: string) {
    const r = complianceMachine.transition({} as Parameters<typeof complianceMachine.transition>[0], e.state, event);
    if (!r.ok) throw new ComplianceError("43816", r.reason ?? "当前状态不允许该操作");
    e.state = r.to!;
    e.log.push({ at: new Date().toISOString(), to: e.state, actor, note });
  }
}
