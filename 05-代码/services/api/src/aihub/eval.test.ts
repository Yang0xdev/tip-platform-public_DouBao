import { test } from "node:test";
import assert from "node:assert/strict";
import { AiEvalService } from "./eval.service.js";

test("评测/红队：红线 100% 拦截、质量全过，门禁通过", () => {
  const report = new AiEvalService().run();
  if (!report.gatePassed) {
    for (const c of report.cases)
      if (!c.pass) console.error(`FAIL ${c.id} ${c.name}\n expected: ${c.expected}\n observed: ${c.observed}`);
  }
  assert.equal(report.failed, 0);
  assert.equal(report.redlinePassRate, 1);
  assert.equal(report.gatePassed, true);
});
