import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";
import { AiService } from "./ai.service.js";

/** 全链：生效订单 + 首付核验 → 自动建案 */
function setup(customerRef: string) {
  const w = world();
  const { order } = effectiveOrder(w, customerRef, "adv-1");
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://voucher.jpg", amountMinor: "8800000", currency: "CNY" },
    customerRef
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  const ai = new AiService(w.cases, w.orders, w.timeline, w.audit);
  return { w, ai };
}

test("AI：未同意时案件类问题需先授权；防骗/问候无需授权", () => {
  const { ai } = setup("c-1980");
  assert.equal(ai.ask("c-1980", "案件进度").needConsent, true);
  const safe = ai.ask("c-1980", "怎样防骗");
  assert.ok(safe.text.includes("对公账户"));
  assert.equal(safe.sources[0]!.ref, "EDU-SAFE");
  assert.ok(ai.ask("c-1980", "你好").text.length > 0);
});

test("AI：同意后进度/费用回答 grounded 带来源，无依据不编造", () => {
  const { ai } = setup("c-1980");
  ai.setConsent("c-1980", true, "c-1980");
  const progress = ai.ask("c-1980", "我的案件到哪一步了");
  assert.ok(progress.text.includes("材料准备"));
  const fees = ai.ask("c-1980", "我还有哪些费用");
  assert.ok(fees.text.includes("平台服务费"));
  assert.ok(fees.text.includes("异币种不相加"));
  assert.ok(fees.sources.length >= 1);
  const fallback = ai.ask("c-1980", "火星上有多少移民");
  assert.ok(fallback.text.includes("联系你的顾问"));
  assert.equal(fallback.sources.length, 0);
});
