import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelRegistry } from "./model.registry.js";
import { ModelRouter } from "./model.router.js";

function router() {
  return new ModelRouter(new ModelRegistry());
}

test("路由：embed/vision 固定档位，其余按任务类型", () => {
  const r = router();
  assert.equal(r.route({ task: "embed" }).tier, "embed");
  assert.equal(r.route({ task: "vision" }).tier, "vision");
  assert.equal(r.route({ task: "classify" }).tier, "fast");
  assert.equal(r.route({ task: "chat" }).tier, "fast");
  assert.equal(r.route({ task: "extract_simple" }).tier, "fast");
  assert.equal(r.route({ task: "draft" }).tier, "standard");
  assert.equal(r.route({ task: "extract_complex" }).tier, "standard");
});

test("路由：reason 按复杂度选 standard/large", () => {
  const r = router();
  assert.equal(r.route({ task: "reason", complexity: 0.3 }).tier, "standard");
  assert.equal(r.route({ task: "reason", complexity: 0.8 }).tier, "large");
});

test("路由：复杂度自动评分随多步标记与长度上升", () => {
  const r = router();
  const simple = r.scoreComplexity("多少钱");
  const complex = r.scoreComplexity(
    "我想先了解项目，然后对比费用，同时还要考虑孩子教育，另外周期多久？并且需要哪些材料？"
  );
  assert.ok(complex > simple);
  assert.ok(complex >= 0.6);
});

test("路由：默认云档关闭；敏感任务即使开启也不允许云", () => {
  const r = router();
  assert.equal(r.cloudEnabled, false);
  assert.equal(r.route({ task: "draft", sensitivity: "sensitive" }).cloudAllowed, false);
});

test("路由：候选标签来自目录，降级链正确", () => {
  const r = router();
  const large = r.route({ task: "reason", complexity: 0.9 });
  assert.ok(large.candidateTags.includes("qwen2.5:14b"));
  assert.equal(large.fallbackTier, "standard");
  assert.equal(r.route({ task: "vision" }).fallbackTier, "deterministic");
});
