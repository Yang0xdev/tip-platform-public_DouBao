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

test("客户详情三页签：biz 只回方案/订单状态编号（无支付账户明细），scope 显式列出不可见范围", () => {
  const w = world();
  const { order } = effectiveOrder(w, "c-1", "adv-1");
  const d = w.details.detail("c-1", "adv-1");
  assert.equal(d.tabs.biz.proposals[0]!.state, "customer_confirmed");
  assert.equal(d.tabs.biz.orders[0]!.id, order.id);
  assert.equal(d.tabs.biz.orders[0]!.contractState, "effective");
  // 字段级 DTO：订单对象不含支付字段
  const json = JSON.stringify(d.tabs.biz);
  assert.equal(json.includes("payeeAccounts"), false);
  assert.equal(json.includes("amountMinor"), false);
  assert.ok(d.tabs.scope.notVisible.includes("支付账户与到账明细（财务域）"));
});

test("跟进记录：可新增 fact；命中禁用表述强拦截；空内容拒", () => {
  const w = world();
  effectiveOrder(w, "c-2", "adv-2");
  const f = w.details.addFollow("c-2", { text: "今日已电话沟通，客户本周补充学位材料。" }, "adv-2");
  assert.equal(f.kind, "fact");
  expectError(() => w.details.addFollow("c-2", { text: "这个项目我们包过，放心。" }, "adv-2"), "42503");
  expectError(() => w.details.addFollow("c-2", { text: "" }, "adv-2"), "42501");
});

test("跟进不可删除只能更正：旧条留存并标记，更正缺原因拒", () => {
  const w = world();
  effectiveOrder(w, "c-3", "adv-3");
  const f = w.details.addFollow("c-3", { text: "客户计划下周面谈。" }, "adv-3");
  expectError(() => w.details.correctFollow(f.id, { text: "客户改约下周三。", note: "" }, "adv-3"), "42505");
  const n = w.details.correctFollow(f.id, { text: "客户改约下周三。", note: "客户时间冲突" }, "adv-3");
  assert.equal(n.correctedOf, f.id);
  const old = w.details.listFollows("c-3").find((x) => x.id === f.id)!;
  assert.equal(old.corrected, true);
  assert.equal(w.details.listFollows("c-3").length, 2); // 旧条仍在
});

test("越权：其他顾问查看详情/写跟进被拒；对客视图过滤 internal 跟进", () => {
  const w = world();
  effectiveOrder(w, "c-4", "adv-4");
  expectError(() => w.details.detail("c-4", "adv-other"), "42507");
  expectError(() => w.details.addFollow("c-4", { text: "x" }, "adv-other"), "42120");
  // internal 不对客，fact 对客
  w.details.addFollow("c-4", { text: "客户偏好上午联系。", kind: "internal" }, "adv-4");
  w.details.addFollow("c-4", { text: "材料清单已发送。", kind: "fact" }, "adv-4");
  const mine = w.details.customerFollows("c-4");
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.text, "材料清单已发送。");
});
