import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "../test-utils/world.js";
import { KnowledgeService } from "./knowledge.service.js";
import { AiService } from "./ai.service.js";

function setup() {
  const w = world();
  const knowledge = new KnowledgeService(w.audit);
  const ai = new AiService(w.cases, w.orders, w.timeline, w.audit);
  return { w, knowledge, ai };
}

test("知识中心：四眼发布，复核人≠编制人；失效立即下架", () => {
  const { knowledge } = setup();
  const item = knowledge.ingest("admin01", {
    title: "识别包成功话术", kind: "education", body: "包成功是违规话术", sourceRef: "EDU-001"
  });
  assert.equal(item.state, "draft");
  knowledge.submit(item.id, "admin01");
  // 编制人自审 → 拒绝
  assert.throws(() => knowledge.review(item.id, "admin01", "approve"), /不可与编制人/);
  knowledge.review(item.id, "admin02", "approve");
  assert.equal(knowledge.published().records.length, 1);
  knowledge.invalidate(item.id, "admin01", "内容过期");
  assert.equal(knowledge.published().records.length, 0);
  assert.equal(knowledge.list("invalidated").records[0]!.state, "invalidated");
});

test("知识中心：驳回回草稿且必填原因；缺字段拒绝入库", () => {
  const { knowledge } = setup();
  const item = knowledge.ingest("admin01", { title: "t", kind: "faq", body: "b", sourceRef: "s" });
  knowledge.submit(item.id, "admin01");
  knowledge.review(item.id, "admin02", "reject", "来源不足");
  assert.equal(item.state, "draft");
  assert.equal(item.reason, "来源不足");
  assert.throws(
    () => knowledge.ingest("admin01", { title: "", kind: "faq", body: "b", sourceRef: "s" }),
    /必填/
  );
});

test("运营指标：提问/兜底/授权计数真实", () => {
  const { w, ai, knowledge } = setup();
  ai.ask("c-1980", "你好");
  ai.ask("c-1980", "火星移民"); // 无同意且非防骗 → needConsent，非兜底
  ai.setConsent("c-1980", true, "c-1980");
  ai.ask("c-1980", "火星上有多少城市"); // 同意后无依据 → fallback
  const metrics = {
    asks: w.audit.countAction("ai.ask"),
    fallback: w.audit.countAction("ai.ask", "fallback"),
    consents: ai.consentCount(),
    published: knowledge.published().records.length
  };
  assert.equal(metrics.asks, 4); // 第3问在顶部与兜底各记一次
  assert.equal(metrics.fallback, 1);
  assert.equal(metrics.consents, 1);
});
