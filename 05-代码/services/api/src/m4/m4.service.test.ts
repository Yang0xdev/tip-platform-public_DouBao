import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
  } catch (e) {
    const body = (e as { getResponse?: () => { code: string }; code?: string }).getResponse?.();
    if (body?.code) {
      assert.equal(body.code, bizCode);
      return;
    }
    assert.equal((e as { code?: string }).code, bizCode);
    return;
  }
  assert.fail(`应抛出 ${bizCode}`);
}

function payFirst(w: ReturnType<typeof world>, customerRef: string, advisorId: string) {
  const { order } = effectiveOrder(w, customerRef, advisorId);
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    customerRef
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  return order;
}

/* ================= 佣金 ================= */

test("佣金：订单生效建 not_accrued（仅平台服务费），首付核验后 accrued；非平台费无佣金", () => {
  const w = world();
  const customerRef = "c-m4-1";
  const advisorId = "adv-m4-1";
  const order = effectiveOrder(w, customerRef, advisorId).order;
  let lines = w.commissions.listLines().filter((l) => l.orderId === order.id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.state, "not_accrued");
  assert.equal(lines[0]!.currency, "CNY");
  // 首付核验
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: "h1", artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    customerRef
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  lines = w.commissions.listLines().filter((l) => l.orderId === order.id);
  assert.equal(lines[0]!.state, "accrued");
});

test("佣金：非法跳步 not_accrued→settled 拒绝；结算须双人互异", () => {
  const w = world();
  const order = payFirst(w, "c-m4-2", "adv-m4-2");
  const line = w.commissions.listLines().find((l) => l.orderId === order.id)!;
  // 直接 clawback 已 settled 之外的路径从 accrued 也不允许
  expectError(() => w.commissions.clawback(line.id, "x", "原因"), "43608");
  const b = w.commissions.createSettlementBatch("fin-lead");
  w.commissions.reviewSettlement(b.id, "rev-a");
  expectError(() => w.commissions.reviewSettlement(b.id, "rev-a"), "43602");
  w.commissions.reviewSettlement(b.id, "rev-b");
  w.commissions.approveSettlement(b.id, "boss");
  w.commissions.registerPaid(b.id, "fin-3", "L3://pay.pdf");
  const after = w.commissions.listLines().find((l) => l.id === line.id)!;
  assert.equal(after.state, "paid");
});

test("佣金：clawback 必填事实原因；adjust 只记事件不改状态", () => {
  const w = world();
  const order = payFirst(w, "c-m4-3", "adv-m4-3");
  const line = w.commissions.listLines().find((l) => l.orderId === order.id)!;
  expectError(() => w.commissions.clawback(line.id, "x", "  "), "43607");
  const before = line.state;
  w.commissions.adjust(line.id, "x", "口径更正");
  assert.equal(line.state, before);
  assert.equal(line.adjusted.length, 1);
});

/* ================= 退款 ================= */

test("退款：每条须依据；执行须业务+财务双人互异；执行后留冲红", () => {
  const w = world();
  const order = payFirst(w, "c-m4-4", "adv-m4-4");
  expectError(
    () => w.commissions.proposeRefund({ orderId: order.id, lines: [{ amountMinor: "100000", currency: "CNY", reason: "" }] }, "cs-1"),
    "43702"
  );
  const r = w.commissions.proposeRefund(
    { orderId: order.id, lines: [{ amountMinor: "500000", currency: "CNY", reason: "未发生阶段服务费按实退还" }] },
    "cs-1"
  );
  // 退款申请联动冻结订单佣金
  const line = w.commissions.listLines().find((l) => l.orderId === order.id)!;
  assert.equal(line.state, "frozen");
  expectError(() => w.commissions.executeRefund(r.id, "x", "L3://r.pdf"), "43704");
  w.commissions.reviewRefund(r.id, "biz-1", "business");
  expectError(() => w.commissions.reviewRefund(r.id, "biz-1", "finance"), "43703");
  w.commissions.reviewRefund(r.id, "fin-1", "finance");
  const done = w.commissions.executeRefund(r.id, "fin-1", "L3://refund.pdf");
  assert.equal(done.state, "executed");
  assert.ok(done.receiptReversalRef);
});

/* ================= 工单投诉 ================= */

test("投诉：提交后自动生成合规事件并冻结被投诉顾问新增授权；投诉进合规队列物理隔离", () => {
  const w = world();
  const order = payFirst(w, "c-m4-5", "adv-m4-5");
  const t = w.tickets.submit(
    {
      kind: "complaint",
      complaintCategory: "off_platform_deal",
      respondentAdvisorId: "adv-m4-5",
      orderId: order.id,
      title: "被要求私下转账",
      description: "顾问让我把钱转到他个人账户，承诺包成功"
    },
    "c-m4-5"
  );
  const events = w.complianceEvents.list().filter((e) => e.relatedTicketId === t.id);
  assert.equal(events.length, 1);
  assert.equal(w.grants.isFrozenNew("adv-m4-5"), true);
  // 客服队列看不到投诉
  assert.equal(w.tickets.listQueue("customer_service").some((x) => x.id === t.id), false);
  assert.equal(w.tickets.listQueue("compliance_team").some((x) => x.id === t.id), true);
});

test("工单：SLA tick 超时升级主管，再超 1 天升级合规", () => {
  const w = world();
  const t = w.tickets.submit(
    { kind: "consult", title: "咨询", description: "一个普通咨询" },
    "c-m4-6"
  );
  w.tickets.accept(t.id, "cs-1", {});
  const escalated = w.tickets.tick(new Date(Date.now() + 2 * 864e5).toISOString());
  assert.equal(escalated.some((x) => x.id === t.id), true);
  const again = w.tickets.tick(new Date(Date.now() + 4 * 864e5).toISOString());
  assert.equal(again.some((x) => x.id === t.id), true);
});

test("投诉复核：复核人未参与原调查（回避）", () => {
  const w = world();
  const t = w.tickets.submit(
    { kind: "complaint", complaintCategory: "delivery_quality", title: "服务质量", description: "长期无人跟进" },
    "c-m4-7"
  );
  w.tickets.accept(t.id, "inv-1", {});
  w.tickets.process(t.id, "inv-1");
  w.tickets.resolve(t.id, "inv-1", "已联系");
  w.tickets.close(t.id, "inv-1");
  w.tickets.requestReview(t.id, "c-m4-7");
  expectError(() => w.tickets.reviewByNewInvestigator(t.id, "inv-1"), "43513");
  w.tickets.reviewByNewInvestigator(t.id, "inv-2");
});

/* ================= 合规事件 ================= */

test("合规：L3 须双人审批且互异；处置未全执行不可归档", () => {
  const w = world();
  const e = w.complianceEvents.open(
    { source: "external_report", level: "L3", title: "外部举报", detail: "某顾问疑似私收款" },
    "staff-1"
  );
  w.complianceEvents.triage(e.id, "L3", "staff-2");
  w.complianceEvents.investigate(e.id, "inv-9");
  w.complianceEvents.addDisposition(e.id, "suspend_authorization", "暂停授权待查", "inv-9");
  w.complianceEvents.propose(e.id, "inv-9");
  expectError(() => w.complianceEvents.decide(e.id, "appr-1"), "43808");
  expectError(() => w.complianceEvents.decide(e.id, "appr-1", "appr-1"), "43809");
  w.complianceEvents.decide(e.id, "appr-1", "appr-2");
  // 处置未执行不可归档
  expectError(() => w.complianceEvents.close(e.id, "x"), "43813");
  const d = e.dispositions[0]!;
  w.complianceEvents.approveDisposition(e.id, d.id, "appr-1");
  w.complianceEvents.close(e.id, "appr-1");
  assert.equal(w.complianceEvents.list().find((x) => x.id === e.id)!.state, "closed");
});

test("合规：当事人不可自查；申诉复核人未参与原调查", () => {
  const w = world();
  const e = w.complianceEvents.open(
    { source: "banned_word", level: "L2", title: "话术违规", detail: "出现承诺成功", respondentAdvisorId: "adv-x" },
    "staff-1"
  );
  w.complianceEvents.triage(e.id, "L2", "staff-2");
  expectError(() => w.complianceEvents.investigate(e.id, "adv-x"), "43803");
  w.complianceEvents.investigate(e.id, "inv-1");
  w.complianceEvents.addDisposition(e.id, "retraining", "重新培训", "inv-1");
  w.complianceEvents.propose(e.id, "inv-1");
  w.complianceEvents.decide(e.id, "appr-1");
  w.complianceEvents.approveDisposition(e.id, e.dispositions[0]!.id, "appr-1");
  w.complianceEvents.close(e.id, "appr-1");
  w.complianceEvents.appeal(e.id, "adv-x");
  expectError(() => w.complianceEvents.reviewAppeal(e.id, "inv-1"), "43814");
  w.complianceEvents.reviewAppeal(e.id, "appr-3");
});
