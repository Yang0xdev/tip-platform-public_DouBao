/**
 * 全部聚合状态机（PRD 冻结基线 v1.0 的唯一状态真源，前后端共用）
 * 依据：GP4 核心对象与状态机、PRD-M1…M5。
 * 守卫只做业务不变量判定；持久化/通知/审计由应用层在迁移成功后完成。
 */
import { StateMachine, guard, type GuardResult } from "./fsm.js";

/* ============ M1：项目版本 / 收费方案（四眼发布） ============ */

export interface FourEyesContext {
  authorId: string;
  reviewerId: string | null;
}

const fourEyesGuard = (ctx: FourEyesContext): GuardResult =>
  ctx.reviewerId === null
    ? guard.fail("REVIEWER_REQUIRED", "缺少复核人")
    : ctx.reviewerId === ctx.authorId
      ? guard.fail("REVIEWER_IS_AUTHOR", "编制人与复核人不得为同一人（四眼原则）")
      : guard.ok();

/* ---- M1-02 项目版本：草稿→待核验→待发布复核→已发布→暂停→下架（驳回回草稿） ---- */
export type ProjectVersionState =
  | "draft" | "pending_verification" | "pending_publish"
  | "published" | "suspended" | "delisted";
export type ProjectVersionEvent =
  | "submit_verification" | "pass_verification" | "reject_verification"
  | "approve_publication" | "reject_publication" | "suspend" | "delist";

export interface ProjectVersionContext {
  editorId: string;
  verifierId: string | null;
  publisherId: string | null;
  keyFactsTotal: number;
  keyFactsVerified: number;
}

const verifierDistinctGuard = (ctx: ProjectVersionContext): GuardResult =>
  ctx.verifierId === null
    ? guard.fail("REVIEWER_REQUIRED", "缺少核验人")
    : ctx.verifierId === ctx.editorId
      ? guard.fail("VERIFIER_IS_EDITOR", "核验人不得为该版本最后编辑人（职责分离）")
      : guard.ok();

const factsCompleteGuard = (ctx: ProjectVersionContext): GuardResult =>
  ctx.keyFactsTotal === 0
    ? guard.fail("KEY_FACTS_REQUIRED", "项目版本至少登记一条关键事实")
    : ctx.keyFactsVerified < ctx.keyFactsTotal
      ? guard.fail("KEY_FACTS_UNVERIFIED", `仍有 ${ctx.keyFactsTotal - ctx.keyFactsVerified} 条关键事实未核验`)
      : guard.ok();

const publisherDistinctGuard = (ctx: ProjectVersionContext): GuardResult =>
  ctx.publisherId === null
    ? guard.fail("REVIEWER_REQUIRED", "缺少发布复核人")
    : ctx.publisherId === ctx.editorId
      ? guard.fail("PUBLISHER_IS_EDITOR", "最后编辑人不得兼任发布人（四眼原则）")
      : guard.ok();

export const projectVersionMachine = new StateMachine<ProjectVersionState, ProjectVersionEvent, ProjectVersionContext>(
  "ProjectVersion",
  [
    { from: "draft", event: "submit_verification", to: "pending_verification" },
    { from: "pending_verification", event: "pass_verification", to: "pending_publish", guards: [verifierDistinctGuard, factsCompleteGuard] },
    { from: "pending_verification", event: "reject_verification", to: "draft", guards: [verifierDistinctGuard] },
    { from: "pending_publish", event: "approve_publication", to: "published", guards: [publisherDistinctGuard] },
    { from: "pending_publish", event: "reject_publication", to: "draft", guards: [publisherDistinctGuard] },
    { from: "published", event: "suspend", to: "suspended" }, // 原因类别与处置说明由应用层强制
    { from: "suspended", event: "delist", to: "delisted" }
  ]
);

/* ---- M1-04 收费方案版本：draft→in_review→published→superseded ---- */
export type FeeScheduleState = "draft" | "in_review" | "published" | "superseded";
export type FeeScheduleEvent = "submit" | "approve" | "reject" | "supersede";

export const feeScheduleMachine = new StateMachine<FeeScheduleState, FeeScheduleEvent, FourEyesContext>(
  "FeeScheduleVersion",
  [
    { from: "draft", event: "submit", to: "in_review" },
    { from: "in_review", event: "approve", to: "published", guards: [fourEyesGuard] },
    { from: "in_review", event: "reject", to: "draft", guards: [fourEyesGuard] },
    { from: "published", event: "supersede", to: "superseded" } // 同 code 新版本发布时系统迁移，旧版只读
  ]
);

/* ============ M1：顾问授权五步 ============ */

export type AuthzState =
  | "applied" | "learning" | "exam_pending" | "exam_passed" | "grant_pending"
  | "authorized" | "rejected" | "renewal_pending" | "reconfirm_required" | "expiring"
  | "suspended" | "terminated" | "revoked" | "expired";
export type AuthzEvent =
  | "start_learning" | "complete_learning" | "pass_exam" | "fail_exam" | "submit_grant"
  | "approve" | "reject" | "request_renewal" | "renew" | "suspend" | "terminate" | "revoke"
  | "expire" | "mark_expiring" | "require_reconfirm" | "start_reconfirm";

export interface AuthzContext extends FourEyesContext {
  scope: string[];
  projectCode: string;
  grantedScopes: string[];
}

const scopeGuard = (ctx: AuthzContext): GuardResult =>
  ctx.grantedScopes.includes(ctx.projectCode) ? guard.ok() : guard.fail("SCOPE_NOT_GRANTED", "该项目未授权");

export const authorizationMachine = new StateMachine<AuthzState, AuthzEvent, AuthzContext>("Authorization", [
  { from: "applied", event: "start_learning", to: "learning" },
  { from: "learning", event: "complete_learning", to: "exam_pending" },
  { from: "exam_pending", event: "pass_exam", to: "exam_passed" },
  { from: "exam_pending", event: "fail_exam", to: "learning" },
  { from: "exam_passed", event: "submit_grant", to: "grant_pending" },
  // M1-10：无考试环节，三份必读材料逐项确认后可直接提交申请（跳步由应用层确认记录守卫）
  { from: "learning", event: "submit_grant", to: "grant_pending" },
  { from: "grant_pending", event: "approve", to: "authorized", guards: [fourEyesGuard, scopeGuard] },
  { from: "grant_pending", event: "reject", to: "rejected", guards: [fourEyesGuard] },
  { from: "rejected", event: "start_learning", to: "learning" }, // 驳回可重申
  { from: "authorized", event: "request_renewal", to: "renewal_pending" },
  { from: "renewal_pending", event: "renew", to: "authorized", guards: [fourEyesGuard] },
  // M1-10：项目规则版本更新 → 旧确认失效，展业前必须重确认
  { from: "authorized", event: "require_reconfirm", to: "reconfirm_required" },
  { from: "reconfirm_required", event: "start_reconfirm", to: "learning" },
  { from: "authorized", event: "suspend", to: "suspended" },
  { from: "suspended", event: "renew", to: "authorized", guards: [fourEyesGuard] },
  { from: "authorized", event: "expire", to: "expired" }, // 到期定时任务，停新接旧
  { from: "authorized", event: "mark_expiring", to: "expiring" }, // 60/30/7 天临期
  { from: "expiring", event: "expire", to: "expired" },
  { from: "expiring", event: "renew", to: "authorized", guards: [fourEyesGuard] },
  { from: "expiring", event: "require_reconfirm", to: "reconfirm_required" },
  { from: "expired", event: "start_learning", to: "learning" }, // 重新申请
  { from: "authorized", event: "terminate", to: "terminated" },
  { from: "suspended", event: "terminate", to: "terminated" },
  { from: "authorized", event: "revoke", to: "revoked" },
  { from: "suspended", event: "revoke", to: "revoked" }
]);

/* ---- M1-09 顾问入驻：draft→submitted→correcting→approved/rejected ---- */
export type OnboardingState = "draft" | "submitted" | "correcting" | "approved" | "rejected";
export type OnboardingEvent = "submit" | "approve" | "reject" | "request_correction" | "resubmit";

export const onboardingMachine = new StateMachine<OnboardingState, OnboardingEvent, FourEyesContext>("AdvisorOnboarding", [
  { from: "draft", event: "submit", to: "submitted" },
  { from: "submitted", event: "approve", to: "approved", guards: [fourEyesGuard] },
  { from: "submitted", event: "reject", to: "rejected", guards: [fourEyesGuard] },
  { from: "submitted", event: "request_correction", to: "correcting", guards: [fourEyesGuard] },
  { from: "correcting", event: "resubmit", to: "submitted" },
  { from: "correcting", event: "submit", to: "submitted" }
]);

/* ============ M2：咨询 / 关系 ============ */

export type ConsultationState =
  | "pending_assign" | "pending_accept" | "accepted" | "reassigned" | "closed"
  | "conflict_pending" | "resolved";
export type ConsultationEvent = "assign" | "accept" | "reassign" | "close" | "flag_conflict" | "resolve";

export const consultationMachine = new StateMachine<ConsultationState, ConsultationEvent, unknown>("Consultation", [
  { from: "pending_assign", event: "assign", to: "pending_accept" },
  { from: "pending_accept", event: "accept", to: "accepted" },
  { from: "pending_accept", event: "reassign", to: "reassigned" },
  { from: "reassigned", event: "assign", to: "pending_accept" },
  { from: "pending_accept", event: "close", to: "closed" },
  { from: "pending_assign", event: "flag_conflict", to: "conflict_pending" },
  { from: "pending_accept", event: "flag_conflict", to: "conflict_pending" },
  { from: "conflict_pending", event: "resolve", to: "resolved" },
  { from: "resolved", event: "assign", to: "pending_accept" }
]);

export type RelationshipState = "requested" | "active" | "declined" | "reassigned" | "handoff_frozen" | "ended";
export type RelationshipEvent = "accept" | "decline" | "reassign" | "freeze_handoff" | "complete_handoff" | "end";

export const relationshipMachine = new StateMachine<RelationshipState, RelationshipEvent, unknown>("Relationship", [
  { from: "requested", event: "accept", to: "active" },
  { from: "requested", event: "decline", to: "declined" },
  { from: "requested", event: "reassign", to: "reassigned" },
  { from: "reassigned", event: "accept", to: "active" },
  { from: "active", event: "freeze_handoff", to: "handoff_frozen" },
  { from: "handoff_frozen", event: "complete_handoff", to: "active" },
  { from: "active", event: "end", to: "ended" }
]);

/* ============ M2：方案 ============ */

export type ProposalState =
  | "advisor_draft" | "pending_review" | "pending_customer"
  | "customer_confirmed" | "revised" | "invalid" | "rejected_review";
export type ProposalEvent = "submit_review" | "approve" | "reject" | "confirm" | "revise" | "invalidate";

export interface ProposalContext extends FourEyesContext {
  projectPublished: boolean;
  feePublished: boolean;
  advisorAuthorized: boolean;
  relationshipActive: boolean;
  validUntil: string | null;
  now: string;
}

const proposalPrereq = (ctx: ProposalContext): GuardResult => {
  if (!ctx.projectPublished || !ctx.feePublished) return guard.fail("PROPOSAL_CONTENT_UNPUBLISHED", "引用的项目/费表必须为已发布版本");
  if (!ctx.advisorAuthorized) return guard.fail("ADVISOR_UNAUTHORIZED", "顾问未获该项目授权");
  if (!ctx.relationshipActive) return guard.fail("RELATIONSHIP_NOT_ACTIVE", "服务关系未双向确认");
  return guard.ok();
};

const proposalReviewGuard = (ctx: ProposalContext): GuardResult => {
  const f = fourEyesGuard(ctx);
  return f.ok ? proposalPrereq(ctx) : f;
};

const proposalConfirmGuard = (ctx: ProposalContext): GuardResult => {
  if (!ctx.validUntil) return guard.fail("PROPOSAL_NO_VALIDITY", "方案缺少有效期");
  if (ctx.now > ctx.validUntil) return guard.fail("PROPOSAL_EXPIRED", "方案已过期，需刷新版本（40902）");
  return guard.ok();
};

export const proposalMachine = new StateMachine<ProposalState, ProposalEvent, ProposalContext>("Proposal", [
  { from: "advisor_draft", event: "submit_review", to: "pending_review", guards: [proposalPrereq] },
  { from: "pending_review", event: "approve", to: "pending_customer", guards: [proposalReviewGuard] },
  { from: "pending_review", event: "reject", to: "rejected_review", guards: [fourEyesGuard] },
  { from: "rejected_review", event: "revise", to: "advisor_draft" },
  { from: "pending_customer", event: "confirm", to: "customer_confirmed", guards: [proposalConfirmGuard] },
  { from: "pending_customer", event: "revise", to: "advisor_draft" },
  { from: "customer_confirmed", event: "revise", to: "revised" },
  { from: "revised", event: "submit_review", to: "pending_review", guards: [proposalPrereq] },
  { from: "advisor_draft", event: "invalidate", to: "invalid" },
  { from: "pending_review", event: "invalidate", to: "invalid" },
  { from: "pending_customer", event: "invalidate", to: "invalid" }
]);

/* ============ M2：订单三态 ============ */

export type ContractState = "draft" | "gate_passed" | "pending_sign" | "signed_registered" | "effective" | "cancelled";
export type ContractEvent = "pass_gate" | "block" | "sign_register" | "make_effective" | "cancel";

export interface SubjectGateContext {
  signingEntityRegistered: boolean;
  overseasPartyLinked: boolean;
  payeeNameMatches: boolean;
  contractHasFiveElements: boolean;
  registrarId: string | null;
  advisorId: string | null;
  consentsComplete: boolean;
  /** D 门：境外方/合同文本未拍板时，仅影子环境可生效 */
  doorsOpen: boolean;
  shadowEnv: boolean;
}

const subjectGateGuard = (ctx: SubjectGateContext): GuardResult => {
  if (!ctx.signingEntityRegistered || !ctx.overseasPartyLinked || !ctx.payeeNameMatches)
    return guard.fail("SUBJECT_GATE_FAILED", "主体三要素不一致，四入口同关，无强制通过（42201）");
  return guard.ok();
};

const contractRegisterGuard = (ctx: SubjectGateContext): GuardResult => {
  if (!ctx.contractHasFiveElements) return guard.fail("CONTRACT_ELEMENTS_MISSING", "合同五要素缺失（42202）");
  if (!ctx.consentsComplete) return guard.fail("CONSENT_INCOMPLETE", "告知确认未逐条完成");
  if (!ctx.registrarId) return guard.fail("REGISTRAR_REQUIRED", "缺少合同核验人");
  if (ctx.registrarId === ctx.advisorId) return guard.fail("REGISTRAR_IS_ADVISOR", "合同核验人不得为顾问本人");
  return guard.ok();
};

const effectiveGuard = (ctx: SubjectGateContext): GuardResult =>
  ctx.doorsOpen || ctx.shadowEnv ? guard.ok() : guard.fail("DECISION_DOOR_CLOSED", "D 门未开，真实客户订单不可生效");

export const contractMachine = new StateMachine<ContractState, ContractEvent, SubjectGateContext>("Order.Contract", [
  { from: "draft", event: "pass_gate", to: "gate_passed", guards: [subjectGateGuard] },
  { from: "gate_passed", event: "sign_register", to: "pending_sign" }, // 登记动作先落记录
  { from: "pending_sign", event: "make_effective", to: "signed_registered", guards: [contractRegisterGuard] },
  { from: "signed_registered", event: "make_effective", to: "effective", guards: [effectiveGuard] },
  { from: "draft", event: "cancel", to: "cancelled" },
  { from: "gate_passed", event: "cancel", to: "cancelled" },
  { from: "pending_sign", event: "cancel", to: "cancelled" }
]);

export type PaymentState = "unpaid" | "pending_verify" | "verified" | "rejected";
export type PaymentEvent = "upload_voucher" | "verify" | "reject" | "reupload";

export const paymentMachine = new StateMachine<PaymentState, PaymentEvent, unknown>("Order.Payment", [
  { from: "unpaid", event: "upload_voucher", to: "pending_verify" },
  { from: "pending_verify", event: "verify", to: "verified" }, // verified 后由应用层开收据
  { from: "pending_verify", event: "reject", to: "rejected" },
  { from: "rejected", event: "reupload", to: "pending_verify" }
]);

export type ServiceState = "not_started" | "material_prep" | "in_delivery" | "completed";
export type ServiceEvent = "create_case" | "advance" | "complete";

export const serviceMachine = new StateMachine<ServiceState, ServiceEvent, unknown>("Order.Service", [
  { from: "not_started", event: "create_case", to: "material_prep" },
  { from: "material_prep", event: "advance", to: "in_delivery" },
  { from: "in_delivery", event: "advance", to: "in_delivery" },
  { from: "in_delivery", event: "complete", to: "completed" }
]);

/* ============ M3：案件 / 材料 / 事件 ============ */

export type CaseState =
  | "material_prep" | "pending_submit" | "submitted" | "accepted"
  | "supplementing" | "reviewing" | "approved" | "refused" | "closed";
export type CaseEvent =
  | "ready_submit" | "submit" | "accept_official" | "request_supplement"
  | "resubmit" | "enter_review" | "approve" | "refuse" | "close";

export interface CaseEventContext {
  hasOfficialEvidence: boolean;
  verifierId: string | null;
  initiatorId: string | null;
}

const officialEvidenceGuard = (ctx: CaseEventContext): GuardResult => {
  if (!ctx.hasOfficialEvidence) return guard.fail("OFFICIAL_EVIDENCE_REQUIRED", "无已核验官方凭据不可发布官方节点（42210）");
  if (ctx.verifierId && ctx.verifierId === ctx.initiatorId)
    return guard.fail("VERIFIER_IS_INITIATOR", "核验人不得为案件发起人（42211）");
  return guard.ok();
};

export const caseMachine = new StateMachine<CaseState, CaseEvent, CaseEventContext>("Case", [
  { from: "material_prep", event: "ready_submit", to: "pending_submit" },
  { from: "pending_submit", event: "submit", to: "submitted" },
  { from: "submitted", event: "accept_official", to: "accepted", guards: [officialEvidenceGuard] },
  { from: "accepted", event: "request_supplement", to: "supplementing" },
  { from: "supplementing", event: "resubmit", to: "reviewing" },
  { from: "accepted", event: "enter_review", to: "reviewing" },
  { from: "reviewing", event: "approve", to: "approved", guards: [officialEvidenceGuard] },
  { from: "reviewing", event: "refuse", to: "refused", guards: [officialEvidenceGuard] },
  { from: "approved", event: "close", to: "closed" },
  { from: "refused", event: "close", to: "closed" }
]);

export type MaterialState = "pending" | "submitted" | "approved" | "supplement_needed";
export type MaterialEvent = "submit" | "approve" | "return" | "resubmit" | "void";

export const materialMachine = new StateMachine<MaterialState, MaterialEvent, unknown>("Material", [
  { from: "pending", event: "submit", to: "submitted" },
  { from: "submitted", event: "approve", to: "approved" },
  { from: "submitted", event: "return", to: "supplement_needed" },
  { from: "supplement_needed", event: "resubmit", to: "submitted" },
  // 已审核通过后替换文件：只能作为新版本重新提交审核（旧版应用层留存）
  { from: "approved", event: "submit", to: "submitted" },
  { from: "pending", event: "void", to: "pending" }, // 作废仅标记，不删除（应用层记录版本）
  { from: "submitted", event: "void", to: "pending" }
]);

/* ============ M3：任务与 T0 时钟 ============ */

export type TaskState = "open" | "doing" | "overdue" | "escalated" | "done";
export type TaskEvent = "start" | "complete" | "mark_overdue" | "escalate" | "reschedule";

/**
 * 任务生命周期：open→doing→done；
 * T0 时钟：open/doing → overdue → escalated（多级，escalated 自循环，升级记录由应用层逐条留痕）；
 * reschedule 仅 overdue→open，且必须挂已核验官方改期凭据（守卫复用官方凭据门）。
 */
export const taskMachine = new StateMachine<TaskState, TaskEvent, CaseEventContext>("Task", [
  { from: "open", event: "start", to: "doing" },
  { from: "open", event: "complete", to: "done" },
  { from: "doing", event: "complete", to: "done" },
  { from: "overdue", event: "complete", to: "done" },
  { from: "escalated", event: "complete", to: "done" },
  { from: "open", event: "mark_overdue", to: "overdue" },
  { from: "doing", event: "mark_overdue", to: "overdue" },
  { from: "overdue", event: "escalate", to: "escalated" },
  { from: "escalated", event: "escalate", to: "escalated" },
  { from: "overdue", event: "reschedule", to: "open", guards: [officialEvidenceGuard] }
]);

/* ============ M3：家庭授权 / 门户批次 ============ */

export type ConsentState = "not_invited" | "pending_self" | "active" | "revoked" | "expired";
export type ConsentEvent = "invite" | "self_confirm" | "revoke" | "expire";

export const consentMachine = new StateMachine<ConsentState, ConsentEvent, unknown>("Consent", [
  { from: "not_invited", event: "invite", to: "pending_self" },
  { from: "pending_self", event: "self_confirm", to: "active" },
  { from: "active", event: "revoke", to: "revoked" },
  { from: "active", event: "expire", to: "expired" },
  { from: "pending_self", event: "expire", to: "expired" }
]);

export type GuardianshipState = "evidence_pending" | "verified" | "dispute_frozen";
export type GuardianshipEvent = "verify" | "raise_dispute" | "resubmit";

export const guardianshipMachine = new StateMachine<GuardianshipState, GuardianshipEvent, unknown>("Guardianship", [
  { from: "evidence_pending", event: "verify", to: "verified" },
  { from: "evidence_pending", event: "raise_dispute", to: "dispute_frozen" },
  { from: "verified", event: "raise_dispute", to: "dispute_frozen" },
  { from: "dispute_frozen", event: "resubmit", to: "evidence_pending" }
]);

export type PortalGrantState = "pending" | "viewable" | "download_approving" | "download_window" | "expired" | "revoked";
export type PortalGrantEvent = "approve_view" | "request_download" | "approve_download" | "expire" | "revoke";

export const portalGrantMachine = new StateMachine<PortalGrantState, PortalGrantEvent, unknown>("PortalGrant", [
  { from: "pending", event: "approve_view", to: "viewable" },
  { from: "viewable", event: "request_download", to: "download_approving" },
  { from: "download_approving", event: "approve_download", to: "download_window" },
  { from: "download_window", event: "expire", to: "expired" },
  { from: "viewable", event: "expire", to: "expired" },
  { from: "download_approving", event: "revoke", to: "revoked" },
  { from: "viewable", event: "revoke", to: "revoked" },
  { from: "download_window", event: "revoke", to: "revoked" }
]);

/* ============ M3：通知送达 ============ */

export type DeliveryState = "pending" | "sent" | "delivered" | "read" | "failed" | "channel_switched" | "manual_call" | "escalated";
export type DeliveryEvent = "send" | "deliver" | "read" | "fail" | "switch_channel" | "manual_reach" | "escalate";

export const deliveryMachine = new StateMachine<DeliveryState, DeliveryEvent, unknown>("DeliveryRecord", [
  { from: "pending", event: "send", to: "sent" },
  { from: "sent", event: "deliver", to: "delivered" },
  { from: "delivered", event: "read", to: "read" },
  { from: "sent", event: "fail", to: "failed" },
  { from: "pending", event: "fail", to: "failed" },
  { from: "failed", event: "switch_channel", to: "channel_switched" },
  { from: "channel_switched", event: "send", to: "sent" },
  { from: "channel_switched", event: "manual_reach", to: "manual_call" },
  { from: "failed", event: "manual_reach", to: "manual_call" },
  { from: "manual_call", event: "escalate", to: "escalated" },
  { from: "channel_switched", event: "escalate", to: "escalated" }
]);

/* ============ M4：工单 / 合规事件 / 佣金 ============ */

export type TicketState =
  | "draft" | "submitted" | "accepted" | "processing" | "info_needed"
  | "resolved_pending" | "closed" | "rated" | "review_pending" | "compliance_referred" | "withdrawn";
export type TicketEvent =
  | "submit" | "accept" | "process" | "request_info" | "provide_info"
  | "resolve" | "close" | "rate" | "request_review" | "refer_compliance" | "withdraw";

export const ticketMachine = new StateMachine<TicketState, TicketEvent, unknown>("Ticket", [
  { from: "draft", event: "submit", to: "submitted" },
  { from: "submitted", event: "accept", to: "accepted" },
  { from: "accepted", event: "process", to: "processing" },
  { from: "processing", event: "request_info", to: "info_needed" },
  { from: "info_needed", event: "provide_info", to: "processing" },
  { from: "processing", event: "resolve", to: "resolved_pending" },
  { from: "resolved_pending", event: "close", to: "closed" },
  { from: "closed", event: "rate", to: "rated" },
  { from: "resolved_pending", event: "request_review", to: "review_pending" },
  { from: "review_pending", event: "process", to: "processing" },
  { from: "accepted", event: "refer_compliance", to: "compliance_referred" },
  { from: "processing", event: "refer_compliance", to: "compliance_referred" },
  { from: "submitted", event: "withdraw", to: "withdrawn" },
  { from: "accepted", event: "withdraw", to: "withdrawn" }
]);

export type ComplianceState = "new" | "triaged" | "investigating" | "proposed" | "decided" | "closed" | "appeal_pending" | "appeal_reviewed";
export type ComplianceEvent = "triage" | "investigate" | "propose" | "decide" | "close" | "appeal" | "review_appeal";

export interface ComplianceContext extends FourEyesContext {
  level: "L1" | "L2" | "L3";
  secondApproverId: string | null;
}

const complianceDecisionGuard = (ctx: ComplianceContext): GuardResult => {
  if (ctx.level !== "L3") return fourEyesGuard(ctx);
  if (!ctx.secondApproverId) return guard.fail("L3_DOUBLE_APPROVAL", "L3 事件需双人审批");
  if (ctx.secondApproverId === ctx.reviewerId) return guard.fail("L3_SAME_APPROVER", "两位审批人不得为同一人");
  return guard.ok();
};

export const complianceMachine = new StateMachine<ComplianceState, ComplianceEvent, ComplianceContext>("ComplianceEvent", [
  { from: "new", event: "triage", to: "triaged" },
  { from: "triaged", event: "investigate", to: "investigating" },
  { from: "investigating", event: "propose", to: "proposed" },
  { from: "proposed", event: "decide", to: "decided", guards: [complianceDecisionGuard] },
  { from: "decided", event: "close", to: "closed" },
  { from: "proposed", event: "appeal", to: "appeal_pending" },
  { from: "decided", event: "appeal", to: "appeal_pending" },
  { from: "appeal_pending", event: "review_appeal", to: "appeal_reviewed" },
  { from: "appeal_reviewed", event: "decide", to: "decided", guards: [complianceDecisionGuard] }
]);

export type CommissionState = "not_accrued" | "accrued" | "frozen" | "settled" | "paid" | "clawback";
export type CommissionEvent = "accrue" | "freeze" | "settle" | "pay" | "clawback" | "unfreeze";

export interface CommissionContext {
  settlementReviewerA: string | null;
  settlementReviewerB: string | null;
}

const settlementDoubleGuard = (ctx: CommissionContext): GuardResult => {
  if (!ctx.settlementReviewerA || !ctx.settlementReviewerB) return guard.fail("SETTLEMENT_DOUBLE_REQUIRED", "结算需双人复核（42220）");
  if (ctx.settlementReviewerA === ctx.settlementReviewerB) return guard.fail("SETTLEMENT_SAME_REVIEWER", "两位复核人不得相同");
  return guard.ok();
};

export const commissionMachine = new StateMachine<CommissionState, CommissionEvent, CommissionContext>("Commission", [
  { from: "not_accrued", event: "accrue", to: "accrued" }, // 仅订单生效/到账触发；点击/咨询无此路径
  { from: "accrued", event: "freeze", to: "frozen" },
  { from: "frozen", event: "unfreeze", to: "accrued" },
  { from: "accrued", event: "settle", to: "settled", guards: [settlementDoubleGuard] },
  { from: "frozen", event: "clawback", to: "clawback" },
  { from: "settled", event: "pay", to: "paid" },
  { from: "paid", event: "clawback", to: "clawback" }
  // 注意：不存在 not_accrued→settled、accrued→paid 等跳步迁移
]);

/* ============ M5：数据源授权 ============ */

export type DataSourceState = "absent" | "contracted" | "enabled" | "suspended" | "terminated";
export type DataSourceEvent = "sign" | "enable" | "suspend" | "terminate" | "resume";

export const dataSourceMachine = new StateMachine<DataSourceState, DataSourceEvent, unknown>("DataSourceAuthorization", [
  { from: "absent", event: "sign", to: "contracted" },
  { from: "contracted", event: "enable", to: "enabled" },
  { from: "enabled", event: "suspend", to: "suspended" },
  { from: "suspended", event: "resume", to: "enabled" },
  { from: "enabled", event: "terminate", to: "terminated" },
  { from: "suspended", event: "terminate", to: "terminated" }
]);

/** 全部状态机注册表（供启动时做完整性/悬挂状态校验） */
export const ALL_MACHINES = {
  projectVersion: projectVersionMachine,
  feeSchedule: feeScheduleMachine,
  authorization: authorizationMachine,
  consultation: consultationMachine,
  relationship: relationshipMachine,
  proposal: proposalMachine,
  contract: contractMachine,
  payment: paymentMachine,
  service: serviceMachine,
  case: caseMachine,
  material: materialMachine,
  task: taskMachine,
  consent: consentMachine,
  guardianship: guardianshipMachine,
  portalGrant: portalGrantMachine,
  delivery: deliveryMachine,
  ticket: ticketMachine,
  compliance: complianceMachine,
  commission: commissionMachine,
  dataSource: dataSourceMachine,
  onboarding: onboardingMachine
};
