import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";
import { AdvisorAiService } from "./advisor-ai.service.js";

/** 生效订单 + 首付核验 → 自动建案（adv-1 / c-1980） */
function setup(customerRef: string) {
  const w = world();
  const { order } = effectiveOrder(w, customerRef, "adv-1");
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://voucher.jpg", amountMinor: "8800000", currency: "CNY" },
    customerRef
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  const caseId = w.cases.list().find((c) => c.orderId === order.id)!.id;
  w.materials.generateChecklist(caseId, "admin");
  const ai = new AdvisorAiService(w.eng, w.cases, w.tasks, w.materials, w.timeline, w.cat, w.audit);
  return { ai };
}

test("顾问AI：晨间简报返回真实队列/客户计数", () => {
  const { ai } = setup("c-1980");
  const b = ai.ask("adv-1", "给我今天的晨间简报");
  assert.ok(b.text.includes("在服务客户：1 位"));
  assert.ok(b.sources.length >= 2);
});

test("顾问AI：会前简报 grounded，含阶段与未齐材料", () => {
  const { ai } = setup("c-1980");
  const b = ai.ask("adv-1", "帮我准备和 #1980 的会面");
  assert.ok(b.text.includes("材料准备"));
  assert.ok(b.text.includes("未齐材料"));
  assert.ok(b.text.includes("不承诺结果"));
});

test("顾问AI：资料查询仅返回已发布内容；非归属客户不可查", () => {
  const { ai } = setup("c-1980");
  const hit = ai.ask("adv-1", "查询已发布项目");
  assert.ok(hit.text.includes("v1"));
  const foreign = ai.ask("adv-1", "帮我准备和 #9999 的会面");
  assert.ok(foreign.text.includes("请指定客户"));
  const none = ai.ask("adv-1", "查询不存在的政策xyz");
  assert.ok(none.text.includes("没有匹配"));
});
