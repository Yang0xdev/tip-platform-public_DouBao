import { AuditService } from "../audit.service.js";
import { VerificationService } from "../catalog/verification.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService, COMMITMENT_KEYS } from "../advisors/onboarding.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { ProposalService } from "../proposal/proposal.service.js";
import { OrderService } from "../order/order.service.js";
import { PaymentService } from "../payment/payment.service.js";
import { ClientDetailService } from "../clientdetail/clientdetail.service.js";
import { IpadService } from "../ipad/ipad.service.js";
import { CaseService } from "../case/case.service.js";
import { TaskService } from "../task/task.service.js";
import { MaterialService } from "../material/material.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { ConsentService } from "../consent/consent.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { ProviderService } from "../provider/provider.service.js";
import { PortalService } from "../portal/portal.service.js";
import { HandoverService } from "../handover/handover.service.js";

export const ENTITY_NAME = "示例出入境咨询有限公司";

export interface World {
  audit: AuditService;
  vr: VerificationService;
  cat: CatalogService;
  ent: EntityService;
  ob: OnboardingService;
  grants: AuthorizationService;
  eng: EngagementService;
  props: ProposalService;
  orders: OrderService;
  payments: PaymentService;
  details: ClientDetailService;
  ipad: IpadService;
  cases: CaseService;
  tasks: TaskService;
  materials: MaterialService;
  timeline: TimelineService;
  consents: ConsentService;
  notifications: NotificationService;
  providers: ProviderService;
  portal: PortalService;
  handovers: HandoverService;
}

export function world(): World {
  const audit = new AuditService();
  const vr = new VerificationService();
  const cat = new CatalogService(vr);
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const grants = new AuthorizationService(ob, ent);
  const eng = new EngagementService(audit);
  const props = new ProposalService(cat, grants, eng, audit);
  const providers = new ProviderService(ent, audit);
  const orders = new OrderService(ent, eng, audit, undefined, providers);
  const details = new ClientDetailService(eng, props, orders, audit);
  const ipad = new IpadService(cat, props, audit);
  const cases = new CaseService(audit);
  const timeline = new TimelineService(cases, audit);
  const consents = new ConsentService(cases, audit);
  const notifications = new NotificationService(cases, audit);
  const tasks = new TaskService(cases, audit, notifications);
  const materials = new MaterialService(cases, tasks, timeline, consents, audit);
  const portal = new PortalService(providers, cases, timeline, audit);
  const handovers = new HandoverService(eng, cases, grants, audit);
  const payments = new PaymentService(orders, audit, cases);
  return { audit, vr, cat, ent, ob, grants, eng, props, orders, payments, details, ipad, cases, tasks, materials, timeline, consents, notifications, providers, portal, handovers };
}

/**
 * 铺一条已生效订单（影子）：费表/项目/机构/顾问/关系/方案/订单/合同登记/生效。
 * 返回订单与项目编号。
 */
export function effectiveOrder(w: World, customerRef: string, advisorId: string) {
  const fee = w.cat.createFeeDraft(
    {
      code: `F-${Math.random().toString(36).slice(2, 7)}`,
      title: "费表",
      body: "x",
      feeItems: [
        { code: "platform_fee", label: "平台服务费", nature: "platform_service", collector: ENTITY_NAME, currency: "CNY", amountMinor: 8_800_000n, certainty: "confirmed", timing: "签约时" },
        { code: "overseas_fee", label: "境外持牌方法律服务费", nature: "overseas_professional", collector: "示例境外律所A", currency: "USD", amountMinor: 450_000n, certainty: "estimated", timing: "立案时" },
        { code: "official_fee", label: "官方费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52_500n, certainty: "estimated", timing: "递交时" }
      ]
    },
    "editor-1"
  );
  w.cat.submitFee(fee.id, "editor-1");
  w.cat.reviewFee(fee.id, "approve", "reviewer-2");
  const fact = w.vr.register({ fact: "本科以上", factType: "condition", sourceType: "official_url", sourceRef: "https://gov.example/a" }, "verifier-3");
  const proj = w.cat.createProjectDraft({ code: `P-${Math.random().toString(36).slice(2, 7)}`, title: "项目", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "editor-1");
  w.cat.submitProjectForVerification(proj.id, "editor-1");
  w.cat.passVerification(proj.id, "verifier-3");
  w.cat.approvePublication(proj.id, "boss-4");
  const e = w.ent.create({ name: ENTITY_NAME, creditCode: `C-${Math.random().toString(36).slice(2, 8)}` }, "admin");
  w.ent.update(e.id, { filingNo: "BJ-2026-018", filingExpiresAt: new Date(Date.now() + 4e10).toISOString() }, "admin");
  w.ent.markActive(e.id, "admin");
  const d = w.ob.createDraft({ phone: `138${Math.floor(Math.random() * 1e8)}`, entityId: e.id, realName: "陈某", materialRefs: ["m1"], selfIntro: "x", title: "顾问", yearsOfPractice: 6, filingNo: "BJ-2026-018" }, advisorId);
  for (const k of COMMITMENT_KEYS) w.ob.signCommitment(d.id, k, advisorId);
  w.ob.confirmTraining(d.id, advisorId);
  w.ob.submit(d.id, advisorId);
  w.ob.approve(d.id, "admin2");
  w.grants.start(advisorId, proj.code);
  for (const m of ["project_rules", "banned_words", "fee_script"] as const) w.grants.confirmMaterial(advisorId, proj.code, m);
  w.grants.submit(advisorId, proj.code, 500);
  w.grants.approve("admin2", advisorId, proj.code);
  const cap = w.eng.capture({ source: "card_request", customerRef, advisorId, actor: customerRef });
  w.eng.accept(cap.consultation.id, advisorId);
  const p = w.props.draft({ customerRef, projectCode: proj.code, advice: [{ text: "学历条件匹配，建议准备认证。", sourceRef: `${proj.code}@v1#edu` }], responsibilities: "平台负责清单。", nonCommitments: ["不承诺获批"] }, advisorId);
  w.props.submitReview(p.id, advisorId);
  w.props.approve(p.id, "rev-2");
  w.props.confirm(p.id, customerRef);
  w.orders.updateConfig(
    {
      overseasParty: { linked: true, name: "自营交付部门", licensed: false },
      payeeAccounts: [{ name: ENTITY_NAME, bank: "中国银行北京分行", account: "1100 0000 1234" }]
    },
    "admin"
  );
  const order = w.orders.createFromProposal(w.props.getById(p.id, { realm: "advisor", ref: advisorId }), advisorId);
  w.orders.runSubjectCheck(order.id, "admin");
  let t = w.orders.createTemplateDraft({ title: "合同" }, "admin");
  w.orders.updateTemplate(t.id, { scope: true, refund: true, overseasNotice: true, guarantee: true, privacy: true }, "admin");
  t = w.orders.publishTemplate(t.id, "admin");
  w.orders.startSigning(order.id, t.id, "admin");
  for (const k of ["fees", "non_commitment", "privacy"] as const) w.orders.addConsent(order.id, k, customerRef);
  w.orders.registerSigned(order.id, { signedAt: new Date().toISOString(), artifactRef: "L3://s.pdf", registrarId: "reg-9" }, "reg-9");
  w.orders.makeEffective(order.id, "admin");
  return { order, projectCode: proj.code, proposalId: p.id };
}
