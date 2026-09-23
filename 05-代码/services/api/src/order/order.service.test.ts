import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditService } from "../audit.service.js";
import { VerificationService } from "../catalog/verification.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService, COMMITMENT_KEYS } from "../advisors/onboarding.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { ProposalService } from "../proposal/proposal.service.js";
import { OrderService } from "./order.service.js";

interface World {
  audit: AuditService;
  vr: VerificationService;
  cat: CatalogService;
  ent: EntityService;
  ob: OnboardingService;
  grants: AuthorizationService;
  eng: EngagementService;
  props: ProposalService;
  orders: OrderService;
  entityName: string;
}

function world(): World {
  const audit = new AuditService();
  const vr = new VerificationService();
  const cat = new CatalogService(vr);
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const grants = new AuthorizationService(ob, ent);
  const eng = new EngagementService(audit);
  const props = new ProposalService(cat, grants, eng, audit);
  const orders = new OrderService(ent, eng, audit);
  return { audit, vr, cat, ent, ob, grants, eng, props, orders, entityName: "示例出入境咨询有限公司" };
}

/** 铺一条已确认方案 + 订单（可选是否配置三要素） */
function confirmedOrder(w: World, customerRef: string, advisorId: string, configure = true) {
  // 费表
  const fee = w.cat.createFeeDraft(
    {
      code: `F-${Math.random().toString(36).slice(2, 7)}`,
      title: "费表",
      body: "x",
      feeItems: [
        { code: "platform_fee", label: "平台服务费", nature: "platform_service", collector: "境内主体", currency: "CNY", amountMinor: 8_800_000n, certainty: "confirmed", timing: "签约时" },
        { code: "official_fee", label: "官方费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52_500n, certainty: "estimated", timing: "递交时" }
      ]
    },
    "editor-1"
  );
  w.cat.submitFee(fee.id, "editor-1");
  w.cat.reviewFee(fee.id, "approve", "reviewer-2");
  // 项目
  const fact = w.vr.register({ fact: "本科以上", factType: "condition", sourceType: "official_url", sourceRef: "https://gov.example/a" }, "verifier-3");
  const proj = w.cat.createProjectDraft({ code: `P-${Math.random().toString(36).slice(2, 7)}`, title: "项目", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "editor-1");
  w.cat.submitProjectForVerification(proj.id, "editor-1");
  w.cat.passVerification(proj.id, "verifier-3");
  w.cat.approvePublication(proj.id, "boss-4");
  // 机构
  const e = w.ent.create({ name: w.entityName, creditCode: `C-${Math.random().toString(36).slice(2, 8)}` }, "admin");
  w.ent.update(e.id, { filingNo: "BJ-2026-018", filingExpiresAt: new Date(Date.now() + 4e10).toISOString() }, "admin");
  w.ent.markActive(e.id, "admin");
  // 顾问入驻 + 授权
  const d = w.ob.createDraft({ phone: `138${Math.floor(Math.random() * 1e8)}`, entityId: e.id, realName: "陈某", materialRefs: ["m1"], selfIntro: "x", title: "顾问", yearsOfPractice: 6, filingNo: "BJ-2026-018" }, advisorId);
  for (const k of COMMITMENT_KEYS) w.ob.signCommitment(d.id, k, advisorId);
  w.ob.confirmTraining(d.id, advisorId);
  w.ob.submit(d.id, advisorId);
  w.ob.approve(d.id, "admin2");
  w.grants.start(advisorId, proj.code);
  for (const m of ["project_rules", "banned_words", "fee_script"] as const) w.grants.confirmMaterial(advisorId, proj.code, m);
  w.grants.submit(advisorId, proj.code, 500);
  w.grants.approve("admin2", advisorId, proj.code);
  // 关系
  const cap = w.eng.capture({ source: "card_request", customerRef, advisorId, actor: customerRef });
  w.eng.accept(cap.consultation.id, advisorId);
  // 方案
  const p = w.props.draft(
    { customerRef, projectCode: proj.code, advice: [{ text: "学历条件匹配，建议准备认证。", sourceRef: `${proj.code}@v1#edu` }], responsibilities: "平台负责清单。", nonCommitments: ["不承诺获批"] },
    advisorId
  );
  w.props.submitReview(p.id, advisorId);
  w.props.approve(p.id, "rev-2");
  w.props.confirm(p.id, customerRef);
  // 配置三要素
  if (configure) {
    w.orders.updateConfig(
      {
        overseasParty: { linked: true, name: "自营交付部门", licensed: false },
        payeeAccounts: [{ name: w.entityName, bank: "中国银行北京分行", account: "1100 0000 1234" }]
      },
      "admin"
    );
  }
  const order = w.orders.createFromProposal(w.props.getById(p.id, { realm: "advisor", ref: advisorId }), advisorId);
  return { order, projectCode: proj.code };
}

function publishedTemplate(w: World) {
  let t = w.orders.createTemplateDraft({ title: "标准服务合同" }, "admin");
  w.orders.updateTemplate(t.id, { scope: true, refund: true, overseasNotice: true, guarantee: true, privacy: true }, "admin");
  t = w.orders.publishTemplate(t.id, "admin");
  return t;
}

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
  } catch (e) {
    const body = (e as { getResponse?: () => { code: string } }).getResponse?.();
    assert.equal(body?.code, bizCode);
    return;
  }
  assert.fail(`应抛出 ${bizCode}`);
}

test("全链路（影子）：确认方案→三要素通过→合同五要素+逐条告知→登记（核验人≠顾问）→生效", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-1", "adv-1");
  let o = w.orders.runSubjectCheck(order.id, "admin");
  assert.equal(o.contractState, "gate_passed");
  assert.equal(o.subject.status, "passed");
  const t = publishedTemplate(w);
  o = w.orders.startSigning(o.id, t.id, "admin");
  assert.equal(o.contractState, "pending_sign");
  for (const key of ["fees", "non_commitment", "privacy"] as const) w.orders.addConsent(o.id, key, "c-1");
  o = w.orders.registerSigned(o.id, { signedAt: new Date().toISOString(), artifactRef: "L3://signed/1.pdf", registrarId: "reg-9" }, "reg-9");
  assert.equal(o.contractState, "signed_registered");
  o = w.orders.makeEffective(o.id, "admin");
  assert.equal(o.contractState, "effective");
  // M2-13：佣金槽位为空、归因三字段分离
  assert.equal(o.snapshots.commissionRuleSlot, null);
  assert.equal(o.snapshots.attribution.commission, "not_accrued");
});

test("三要素任一不一致即阻断：境外方未关联/收款户名不符，状态停留 draft，无强制通过", () => {
  const w = world();
  // 不配置三要素
  const { order } = confirmedOrder(w, "c-2", "adv-2", false);
  const o = w.orders.runSubjectCheck(order.id, "admin");
  assert.equal(o.contractState, "draft");
  assert.equal(o.subject.status, "blocked");
  assert.equal(o.subject.items.every((i) => typeof i.pass === "boolean"), true);
  assert.ok(o.subject.items.find((i) => i.key === "overseas_party")?.pass === false);
  // 顾问阻断详情含强制路径、无强制通过
  const br = w.orders.blockReason(o.id, { realm: "advisor", ref: "adv-2" });
  assert.equal(br.forcedPath.length, 4);
});

test("ORD-2409-018 反例：收款账户户名为第三方 → 主体门阻断", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-3", "adv-3");
  w.orders.updateConfig({ payeeAccounts: [{ name: "第三方商务公司", bank: "某银行", account: "9999" }] }, "admin");
  const o = w.orders.runSubjectCheck(order.id, "admin");
  assert.equal(o.subject.status, "blocked");
  assert.equal(o.subject.items.find((i) => i.key === "payee_account")?.pass, false);
});

test("24h 内反复提交阻断≥3次 → blocked_alert 合规告警留痕", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-4", "adv-4", false);
  for (let i = 0; i < 3; i++) w.orders.runSubjectCheck(order.id, "admin");
  const tail = w.audit.tail(30);
  assert.ok(tail.some((e) => e.action === "order.subject.blocked_alert"));
});

test("合同模板五要素不齐不可发布；未发布模板不可进入签署（42202）", () => {
  const w = world();
  const t = w.orders.createTemplateDraft({ title: "残缺合同" }, "admin");
  expectError(() => w.orders.publishTemplate(t.id, "admin"), "42202");
  const { order } = confirmedOrder(w, "c-5", "adv-5");
  w.orders.runSubjectCheck(order.id, "admin");
  expectError(() => w.orders.startSigning(order.id, t.id, "admin"), "42202");
});

test("告知 Consent 未逐条完成不可登记（contractRegisterGuard）", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-6", "adv-6");
  let o = w.orders.runSubjectCheck(order.id, "admin");
  const t = publishedTemplate(w);
  o = w.orders.startSigning(o.id, t.id, "admin");
  w.orders.addConsent(o.id, "fees", "c-6"); // 只确认一项
  expectError(
    () => w.orders.registerSigned(o.id, { signedAt: new Date().toISOString(), artifactRef: "L3://x.pdf", registrarId: "reg-9" }, "reg-9"),
    "42246"
  );
});

test("合同核验人=顾问本人 → 403（职责分离）", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-7", "adv-7");
  let o = w.orders.runSubjectCheck(order.id, "admin");
  const t = publishedTemplate(w);
  o = w.orders.startSigning(o.id, t.id, "admin");
  for (const key of ["fees", "non_commitment", "privacy"] as const) w.orders.addConsent(o.id, key, "c-7");
  expectError(
    () => w.orders.registerSigned(o.id, { signedAt: new Date().toISOString(), artifactRef: "L3://x.pdf", registrarId: "adv-7" }, "adv-7"),
    "42239"
  );
});

test("D 门未开且非影子环境：已登记订单不可生效", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-8", "adv-8");
  let o = w.orders.runSubjectCheck(order.id, "admin");
  const t = publishedTemplate(w);
  o = w.orders.startSigning(o.id, t.id, "admin");
  for (const key of ["fees", "non_commitment", "privacy"] as const) w.orders.addConsent(o.id, key, "c-8");
  o = w.orders.registerSigned(o.id, { signedAt: new Date().toISOString(), artifactRef: "L3://x.pdf", registrarId: "reg-9" }, "reg-9");
  w.orders.updateConfig({ shadowEnv: false, doorsOpen: false }, "admin");
  expectError(() => w.orders.makeEffective(o.id, "admin"), "42246");
});

test("同一方案重复生成订单 → 42231；客户对他人订单作告知确认 → 403", () => {
  const w = world();
  const { order } = confirmedOrder(w, "c-9", "adv-9");
  const p = w.props.getById(order.proposalId, { realm: "advisor", ref: "adv-9" });
  expectError(() => w.orders.createFromProposal(p, "adv-9"), "42231");
  expectError(() => w.orders.addConsent(order.id, "fees", "c-other"), "42234");
});
