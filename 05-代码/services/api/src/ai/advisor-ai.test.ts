import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";
import { AdvisorAiService } from "./advisor-ai.service.js";
import { KnowledgeService } from "./knowledge.service.js";
import { WikiService } from "../wiki/wiki.service.js";
import { LayoutParser } from "../refinery/parser.service.js";
import { ExtractionEngine } from "../refinery/extractor.service.js";
import { Normalizer } from "../refinery/normalizer.service.js";
import { LlmExtractor } from "../refinery/llm-extractor.service.js";
import { RefineryService } from "../refinery/refinery.service.js";

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
  w.timeline.recordCompany(caseId, "material_submit", "admin");
  const knowledge = new KnowledgeService(w.audit);
  const wiki = new WikiService(w.audit);
  const refinery = new RefineryService(
    w.audit, new LayoutParser(), new ExtractionEngine(), new Normalizer(), new LlmExtractor(new Normalizer()), wiki
  );
  const ai = new AdvisorAiService(w.eng, w.cases, w.tasks, w.materials, w.timeline, w.cat, w.audit, knowledge, wiki, refinery);
  return { ai, w, knowledge, wiki, refinery };
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

test("顾问AI：材料清单问题命中数据工厂 L1 已发布规范资料", async () => {
  const { ai, refinery } = setup("c-1980");
  const raw = refinery.ingestText("eng-1", {
    title: "安提瓜材料清单",
    content: "1 护照公证：彩色复印件，中英文公证书，所有申请人\n2 身份证公证：所有申请人\n3 出生公证：所有申请人",
    sourceType: "manual"
  });
  await refinery.autoRun("eng-1", raw.id);
  refinery.review("rev-1", raw.id, "approve");
  refinery.publish("rev-1", raw.id);
  const b = ai.ask("adv-1", "安提瓜需要什么公证材料？");
  assert.ok(b.text.includes("安提瓜材料清单"), b.text);
  assert.ok(b.sources.some((s) => s.ref.startsWith("CAN-")));
});

test("U2 上下文：锚定非归属客户被拒；compsolution 只含已发布；无支付/投诉/L3 字段", () => {
  const { ai } = setup("c-1980");
  assert.throws(() => ai.context("adv-1", "c-9999", "progress"), /不在你的服务范围/);

  const ctx = ai.context("adv-1", "c-1980", "compsolution");
  assert.equal(ctx.anchor.customerRef, "c-1980");
  const projects = ctx.fragments.filter((f) => f.type === "published_project");
  assert.ok(projects.length >= 1);
  // 草稿项目 PROJ-DIGITAL-C 不出现
  assert.ok(!projects.some((p) => p.code === "PROJ-DIGITAL-C"));

  const blob = JSON.stringify({ fragments: ctx.fragments, knowledge: ctx.knowledge });
  for (const banned of ["payeeInfo", "accountNo", "L3://", "voucher", "amountMinor\":null,\"collector"]) {
    assert.ok(!blob.includes(banned), `上下文泄漏字段：${banned}`);
  }
});

test("U2 上下文：premeet 含 co/off 时间线与未齐材料，sp 不进包", () => {
  const { ai } = setup("c-1980");
  const ctx = ai.context("adv-1", "c-1980", "premeet");
  const types = ctx.fragments.map((f) => f.type);
  assert.ok(types.includes("case"));
  assert.ok(types.includes("timeline"));
  assert.ok(types.includes("materials"));
  const timeline = ctx.fragments.filter((f) => f.type === "timeline");
  assert.ok(!timeline.some((t) => t.level === "sp"));
});
