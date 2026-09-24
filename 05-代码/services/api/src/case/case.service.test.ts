import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";

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

/** 走完首付凭证 → 财务双人核验，触发自动建案，返回案件 */
function payAndCreate(w: ReturnType<typeof world>, customerRef: string, advisorId: string) {
  const { order } = effectiveOrder(w, customerRef, advisorId);
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://voucher.jpg", amountMinor: "8800000", currency: "CNY" },
    customerRef
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  const c = w.cases.list().find((x) => x.orderId === order.id)!;
  return { order, c };
}

test("建案：合同生效+首付核验自动建案（material_prep），一单一案幂等", () => {
  const w = world();
  const { order, c } = payAndCreate(w, "c-1", "adv-1");
  assert.ok(c);
  assert.equal(c.stage, "material_prep");
  assert.equal(c.initiatorId, "adv-1");
  assert.deepEqual(c.applicants, [{ ref: "c-1", role: "primary" }]);
  // 再次核验/手动建案不产生第二案
  const again = w.cases.createFromOrder(w.orders.getById(order.id, { realm: "staff", ref: "admin" }), "admin");
  assert.equal(again.id, c.id);
  assert.equal(w.cases.list().length, 1);
});

test("未生效/未到账订单不可建案", () => {
  const w = world();
  const { order } = effectiveOrder(w, "c-2", "adv-2");
  expectError(() => w.cases.createFromOrder(w.orders.getById(order.id, { realm: "staff", ref: "admin" }), "admin"), "42701");
});

test("阶段迁移：官方节点无凭据拒（42210）；核验人=发起人拒（42211）；挂凭据可推进", () => {
  const w = world();
  const { c } = payAndCreate(w, "c-3", "adv-3");
  // material_prep → pending_submit → submitted（公司动作，无需凭据）
  w.cases.transition(c.id, "ready_submit", "caseworker-1");
  w.cases.transition(c.id, "submit", "caseworker-1");
  // submitted → accepted 必须 off 凭据
  expectError(() => w.cases.transition(c.id, "accept_official", "caseworker-1"), "42210");
  // 挂了凭据但核验人=发起人（adv-3）
  expectError(
    () => w.cases.transition(c.id, "accept_official", "caseworker-1", { evidenceRef: "L3://off.pdf", verifierId: "adv-3" }),
    "42211"
  );
  const after = w.cases.transition(c.id, "accept_official", "caseworker-1", {
    evidenceRef: "L3://off.pdf",
    verifierId: "ver-9"
  });
  assert.equal(after.stage, "accepted");
  // 阶段日志留痕
  const last = after.stageLog.at(-1)!;
  assert.equal(last.evidenceRef, "L3://off.pdf");
});

test("异常态并行独立：暂停/失联/争议不改阶段，重复登记拒，解除留痕", () => {
  const w = world();
  const { c } = payAndCreate(w, "c-4", "adv-4");
  w.cases.setException(c.id, "paused", "客户家庭原因暂缓", "caseworker-1");
  w.cases.setException(c.id, "lost_contact", "电话短信均无应答", "caseworker-1");
  const mid = w.cases.getScoped(c.id, { realm: "staff", ref: "adv-4" });
  assert.equal(mid.stage, "material_prep"); // 阶段不变
  assert.equal(mid.exceptions.filter((e) => e.active).length, 2);
  expectError(() => w.cases.setException(c.id, "paused", "再次暂停", "caseworker-1"), "42703");
  expectError(() => w.cases.setException(c.id, "disputed", "", "caseworker-1"), "42702");
  const cleared = w.cases.clearException(c.id, "paused", "客户确认恢复办理", "caseworker-1");
  assert.equal(cleared.exceptions.find((e) => e.kind === "paused")!.active, false);
  expectError(() => w.cases.clearException(c.id, "paused", "x", "caseworker-1"), "42704");
});

test("看板：按阶段分列，异常案件独立成段；顾问/客户视角隔离与越权拒绝", () => {
  const w = world();
  const a = payAndCreate(w, "c-5", "adv-5");
  const b = payAndCreate(w, "c-6", "adv-6");
  w.cases.transition(a.c.id, "ready_submit", "cw");
  w.cases.transition(a.c.id, "submit", "cw");
  w.cases.setException(b.c.id, "disputed", "费用争议待处理", "cw");
  const board = w.cases.board();
  const submitted = board.columns.find((x) => x.stage === "submitted")!.cases;
  assert.deepEqual(submitted.map((x) => x.id), [a.c.id]);
  assert.deepEqual(board.exceptions.map((x) => x.case.id), [b.c.id]);
  // 顾问只见自己的案
  assert.deepEqual(w.cases.listForAdvisor("adv-5").map((x) => x.id), [a.c.id]);
  // 越权：顾问看他人案、客户看他人案
  expectError(() => w.cases.getScoped(b.c.id, { realm: "staff", ref: "adv-5" }), "42705");
  expectError(() => w.cases.getScoped(a.c.id, { realm: "customer", ref: "c-6" }), "42705");
});
