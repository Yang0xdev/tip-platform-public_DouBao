import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";
import { AiService } from "./ai.service.js";
import { WikiService } from "../wiki/wiki.service.js";

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
  const wiki = new WikiService(w.audit);
  const ai = new AiService(w.cases, w.orders, w.timeline, w.audit, wiki);
  return { w, ai, wiki };
}

/** 发布一页 K1 知识页（编译→提交→复核，四眼） */
function publishAtgPage(wiki: WikiService) {
  const ws = wiki.ingestSource("eng-1", {
    kind: "document",
    title: "安提瓜和巴布达投资入籍 · 申请材料清单",
    body: "1 护照公证：彩色复印件，中英文公证书，所有申请人\n2 身份证公证：所有申请人\n3 出生公证：所有申请人\n4 无犯罪记录公证：所有申请人",
    sourceRef: "CAN-T-001"
  });
  const p = wiki.compileDraft("eng-1", {
    title: "安提瓜和巴布达投资入籍 · 申请材料清单",
    slug: "atg-materials",
    sourceIds: [ws.id]
  });
  wiki.lint("eng-1", p.id);
  wiki.submit("eng-1", p.id);
  wiki.review("rev-1", p.id, true);
  return p.id;
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

test("AI：项目通用问题命中 K1 已发布知识页且无需个人授权；个人材料问题仍走案件", () => {
  const { ai, wiki } = setup("c-1980");
  // 未发布知识页时：通用问题无据可依（不编造）
  const before = ai.ask("c-1980", "安提瓜投资入籍需要哪些公证材料？");
  assert.equal(before.sources.length, 0);
  // 发布 K1 知识页
  publishAtgPage(wiki);
  const after = ai.ask("c-1980", "安提瓜投资入籍需要哪些公证材料？");
  assert.ok(after.text.includes("护照公证"), after.text);
  assert.ok(after.sources.some((s) => s.ref === "WP-0001"));
  assert.ok(after.text.includes("不承诺办理结果"));
});
