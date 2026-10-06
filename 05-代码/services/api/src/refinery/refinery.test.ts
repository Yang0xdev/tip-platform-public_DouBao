import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditService } from "../audit.service.js";
import { WikiService } from "../wiki/wiki.service.js";
import { LayoutParser } from "./parser.service.js";
import { ExtractionEngine } from "./extractor.service.js";
import { Normalizer } from "./normalizer.service.js";
import { RefineryService } from "./refinery.service.js";

function make() {
  const audit = new AuditService();
  const wiki = new WikiService(audit);
  const parser = new LayoutParser();
  const extractor = new ExtractionEngine();
  const normalizer = new Normalizer();
  const refinery = new RefineryService(audit, parser, extractor, normalizer, wiki);
  return { refinery, wiki };
}

test("数据工厂：示例包采集并自动跑到待复核", () => {
  const { refinery } = make();
  const r = refinery.loadSamplePack("admin");
  assert.equal(r.ingested.length, 4);
  const { records } = refinery.list();
  assert.ok(records.every((x) => x.stage === "awaiting_review"));
  // 幂等：再跑一次不新增
  const r2 = refinery.loadSamplePack("admin");
  assert.equal(r2.ingested.length, 0);
});

test("数据工厂：去重拦截相同内容", () => {
  const { refinery } = make();
  refinery.ingestText("admin", { title: "T", content: "内容A" });
  assert.throws(
    () => refinery.ingestText("admin", { title: "T2", content: "内容A" }),
    (e: any) => e.getResponse?.().code === "44402"
  );
});

test("数据工厂：四眼原则——本人不能复核自己", () => {
  const { refinery } = make();
  const raw = refinery.ingestText("admin", {
    title: "【示例】身份规划服务协议（测试）",
    content: "甲方：某公司\n乙方：某人\n签署日期：2026年1月2日"
  });
  refinery.autoRun("admin", raw.id);
  assert.throws(
    () => refinery.review("admin", raw.id, "approve"),
    (e: any) => e.getResponse?.().code === "44408"
  );
});

test("数据工厂：他人复核通过后发布，规范记录与 K1 联动", () => {
  const { refinery, wiki } = make();
  const raw = refinery.ingestText("admin", {
    title: "【示例】身份规划服务协议（发布测试）",
    content: "甲方：某公司\n乙方：某人\n签署日期：2026年1月2日"
  });
  refinery.autoRun("admin", raw.id);
  const reviewed = refinery.review("reviewer1", raw.id, "approve");
  assert.equal(reviewed.reviewerId, "reviewer1");
  const out = refinery.publish("reviewer1", raw.id);
  assert.equal(out.canonical.status, "published");
  assert.ok(out.canonical.wikiSourceId);
  assert.equal(out.raw.stage, "published");
  // K1 侧来源已登记
  assert.ok(wiki.listSources().records.some((s) => s.sourceRef === raw.id));
});

test("数据工厂：清洗归一（日期 ISO、币种标准）", () => {
  const { refinery } = make();
  const raw = refinery.ingestText("admin", {
    title: "【示例】A国科技居留计划条例（归一测试）",
    content:
      "A国移民局发布本条例，自2026年3月1日起施行。\n申请条件：\n- 年龄须年满18周岁\n- 无犯罪记录证明"
  });
  refinery.classify("admin", raw.id);
  refinery.parse("admin", raw.id);
  refinery.extract("admin", raw.id);
  const n = refinery.normalize("admin", raw.id);
  const dateField = n.fields?.find((f) => f.key === "effective_date");
  assert.equal(dateField?.value, "2026-03-01");
});

test("数据工厂：血缘与看板", () => {
  const { refinery } = make();
  refinery.loadSamplePack("admin");
  const id = refinery.list().records[0]!.id;
  const lineage = refinery.lineage(id);
  assert.ok(lineage.nodes.length >= 2);
  assert.ok(lineage.links.some((l) => l.label.includes("证据")));
  const dash = refinery.dashboard();
  assert.equal(dash.metrics.ingested, 4);
  assert.ok(dash.metrics.avgFieldConf > 0);
});
