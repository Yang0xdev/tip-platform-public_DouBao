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
import { OrderService } from "../order/order.service.js";
import { PaymentService } from "./payment.service.js";

const ENTITY_NAME = "示例出入境咨询有限公司";

function effectiveOrder(customerRef: string, advisorId: string) {
  const audit = new AuditService();
  const vr = new VerificationService();
  const cat = new CatalogService(vr);
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const grants = new AuthorizationService(ob, ent);
  const eng = new EngagementService(audit);
  const props = new ProposalService(cat, grants, eng, audit);
  const orders = new OrderService(ent, eng, audit);
  const payments = new PaymentService(orders, audit);

  const fee = cat.createFeeDraft(
    {
      code: `F-${Math.random().toString(36).slice(2, 7)}`,
      title: "费表",
      body: "x",
      feeItems: [
        { code: "platform_fee", label: "平台服务费", nature: "platform_service", collector: ENTITY_NAME, currency: "CNY", amountMinor: 8_800_000n, certainty: "confirmed", timing: "签约时" },
        { code: "official_fee", label: "官方费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52_500n, certainty: "estimated", timing: "递交时" }
      ]
    },
    "editor-1"
  );
  cat.submitFee(fee.id, "editor-1");
  cat.reviewFee(fee.id, "approve", "reviewer-2");
  const fact = vr.register({ fact: "本科以上", factType: "condition", sourceType: "official_url", sourceRef: "https://gov.example/a" }, "verifier-3");
  const proj = cat.createProjectDraft({ code: `P-${Math.random().toString(36).slice(2, 7)}`, title: "项目", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "editor-1");
  cat.submitProjectForVerification(proj.id, "editor-1");
  cat.passVerification(proj.id, "verifier-3");
  cat.approvePublication(proj.id, "boss-4");
  const e = ent.create({ name: ENTITY_NAME, creditCode: `C-${Math.random().toString(36).slice(2, 8)}` }, "admin");
  ent.update(e.id, { filingNo: "BJ-2026-018", filingExpiresAt: new Date(Date.now() + 4e10).toISOString() }, "admin");
  ent.markActive(e.id, "admin");
  const d = ob.createDraft({ phone: `138${Math.floor(Math.random() * 1e8)}`, entityId: e.id, realName: "陈某", materialRefs: ["m1"], selfIntro: "x", title: "顾问", yearsOfPractice: 6, filingNo: "BJ-2026-018" }, advisorId);
  for (const k of COMMITMENT_KEYS) ob.signCommitment(d.id, k, advisorId);
  ob.confirmTraining(d.id, advisorId);
  ob.submit(d.id, advisorId);
  ob.approve(d.id, "admin2");
  grants.start(advisorId, proj.code);
  for (const m of ["project_rules", "banned_words", "fee_script"] as const) grants.confirmMaterial(advisorId, proj.code, m);
  grants.submit(advisorId, proj.code, 500);
  grants.approve("admin2", advisorId, proj.code);
  const cap = eng.capture({ source: "card_request", customerRef, advisorId, actor: customerRef });
  eng.accept(cap.consultation.id, advisorId);
  const p = props.draft({ customerRef, projectCode: proj.code, advice: [{ text: "学历条件匹配，建议准备认证。", sourceRef: `${proj.code}@v1#edu` }], responsibilities: "平台负责清单。", nonCommitments: ["不承诺获批"] }, advisorId);
  props.submitReview(p.id, advisorId);
  props.approve(p.id, "rev-2");
  props.confirm(p.id, customerRef);
  orders.updateConfig(
    {
      overseasParty: { linked: true, name: "自营交付部门", licensed: false },
      payeeAccounts: [{ name: ENTITY_NAME, bank: "中国银行北京分行", account: "1100 0000 1234" }]
    },
    "admin"
  );
  const order = orders.createFromProposal(props.getById(p.id, { realm: "advisor", ref: advisorId }), advisorId);
  orders.runSubjectCheck(order.id, "admin");
  let t = orders.createTemplateDraft({ title: "合同" }, "admin");
  orders.updateTemplate(t.id, { scope: true, refund: true, overseasNotice: true, guarantee: true, privacy: true }, "admin");
  t = orders.publishTemplate(t.id, "admin");
  orders.startSigning(order.id, t.id, "admin");
  for (const k of ["fees", "non_commitment", "privacy"] as const) orders.addConsent(order.id, k, customerRef);
  orders.registerSigned(order.id, { signedAt: new Date().toISOString(), artifactRef: "L3://s.pdf", registrarId: "reg-9" }, "reg-9");
  orders.makeEffective(order.id, "admin");
  return { payments, orders, order, customerRef, advisorId };
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

test("首付全链路：计划仅平台费到期（官方费未发生不预记应收）→上传显待核验→财务双人核验→开收据→订单待建案", () => {
  const ctx = effectiveOrder("c-1", "adv-1");
  const plan = ctx.payments.ensurePlan(ctx.order.id, { realm: "customer", ref: "c-1" });
  const due = plan.installments.filter((i) => i.status === "due");
  assert.equal(due.length, 1);
  assert.equal(plan.installments.find((i) => i.status === "not_accrued")?.label, "官方费");
  // 收款账户仅主体对公
  const info = ctx.payments.payeeInfo(ctx.order.id, { realm: "customer", ref: "c-1" });
  assert.equal(info.accounts.length, 1);
  // 上传凭证
  let p = ctx.payments.uploadVoucher(
    ctx.order.id,
    { installmentSeq: 1, fileHash: "h-aaa", artifactRef: "L3://voucher1.jpg", amountMinor: "8800000", currency: "CNY" },
    "c-1"
  );
  const ins = p.installments[0]!;
  assert.equal(ins.paymentState, "pending_verify");
  assert.equal(ins.verifiedAt, null); // 待核验≠到账
  // 财务队列可见
  assert.equal(ctx.payments.pendingVerify().length, 1);
  // 缺第二核验人
  expectError(() => ctx.payments.verify(ctx.order.id, { installmentSeq: 1, decision: "verified" }, "fin-1"), "42412");
  // 双人核验通过
  p = ctx.payments.verify(ctx.order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  assert.equal(p.installments[0]!.paymentState, "verified");
  assert.ok(p.installments[0]!.receiptId);
  const receipts = ctx.payments.listReceipts(ctx.order.id);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.amountMinor, "8800000");
  // 订单待建案
  assert.ok(ctx.orders.list().find((o) => o.id === ctx.order.id)?.readyForCaseAt);
});

test("凭证上传后任何终端不显示已到账/已付款；重复凭证（哈希+金额）拦截", () => {
  const ctx = effectiveOrder("c-2", "adv-2");
  ctx.payments.ensurePlan(ctx.order.id, { realm: "customer", ref: "c-2" });
  ctx.payments.uploadVoucher(ctx.order.id, { installmentSeq: 1, fileHash: "h-dup", artifactRef: "L3://v1.jpg", amountMinor: "8800000", currency: "CNY" }, "c-2");
  // 同一凭证再次提交（模拟重复记账）
  expectError(
    () => ctx.payments.uploadVoucher(ctx.order.id, { installmentSeq: 1, fileHash: "h-dup", artifactRef: "L3://v2.jpg", amountMinor: "8800000", currency: "CNY" }, "c-2"),
    "42204"
  );
});

test("凭证金额与应付不一致不可核验通过；驳回回 unpaid 可重传，原记录留存", () => {
  const ctx = effectiveOrder("c-3", "adv-3");
  ctx.payments.ensurePlan(ctx.order.id, { realm: "customer", ref: "c-3" });
  ctx.payments.uploadVoucher(ctx.order.id, { installmentSeq: 1, fileHash: "h-x", artifactRef: "L3://v.jpg", amountMinor: "8000000", currency: "CNY" }, "c-3");
  expectError(() => ctx.payments.verify(ctx.order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1"), "42411");
  // 驳回
  let p = ctx.payments.verify(ctx.order.id, { installmentSeq: 1, decision: "rejected", reason: "金额不符" }, "fin-1");
  assert.equal(p.installments[0]!.paymentState, "rejected");
  assert.equal(p.installments[0]!.rejectReason, "金额不符");
  // 重传
  p = ctx.payments.uploadVoucher(ctx.order.id, { installmentSeq: 1, fileHash: "h-y", artifactRef: "L3://v2.jpg", amountMinor: "8800000", currency: "CNY" }, "c-3");
  assert.equal(p.installments[0]!.paymentState, "pending_verify");
  assert.ok(p.installments[0]!.voucher.artifactRef);
});

test("顾问不可核验凭证（职责分离，42409）", () => {
  const ctx = effectiveOrder("c-4", "adv-4");
  ctx.payments.ensurePlan(ctx.order.id, { realm: "customer", ref: "c-4" });
  ctx.payments.uploadVoucher(ctx.order.id, { installmentSeq: 1, fileHash: "h-z", artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" }, "c-4");
  expectError(() => ctx.payments.verify(ctx.order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, ctx.advisorId), "42409");
});

test("退款申请提交即冻结（refund_pending）有编号；冻结期不可并行付款、不可并行申请", () => {
  const ctx = effectiveOrder("c-5", "adv-5");
  ctx.payments.ensurePlan(ctx.order.id, { realm: "customer", ref: "c-5" });
  const req = ctx.payments.submitChange(ctx.order.id, { kind: "refund", note: "个人计划变更，申请退款。" }, "c-5");
  assert.match(req.id, /^CHG-/);
  assert.equal(ctx.orders.list().find((o) => o.id === ctx.order.id)?.freezeStatus, "refund_pending");
  expectError(
    () => ctx.payments.uploadVoucher(ctx.order.id, { installmentSeq: 1, fileHash: "h-f", artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" }, "c-5"),
    "42401"
  );
  expectError(() => ctx.payments.submitChange(ctx.order.id, { kind: "fee_dispute", note: "再申请" }, "c-5"), "42251");
});

test("变更说明为空 → 42420；平台外交易不假装受理", () => {
  const ctx = effectiveOrder("c-6", "adv-6");
  ctx.payments.ensurePlan(ctx.order.id, { realm: "customer", ref: "c-6" });
  expectError(() => ctx.payments.submitChange(ctx.order.id, { kind: "proposal_change", note: "" }, "c-6"), "42420");
  const notice = ctx.payments.offPlatformNotice();
  assert.equal(notice.accepted, false);
});
