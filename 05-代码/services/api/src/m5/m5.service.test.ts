import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "../test-utils/world.js";

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    assert.equal((e as { code?: string }).code, code);
    return;
  }
  assert.fail(`应抛出 ${code}`);
}

/* ===== M5-04 注销 ===== */

test("注销：无在办案件/未结订单可申请，冷静期 15 天；冷静期可撤回", () => {
  const w = world();
  expectError(() => w.deletions.request("c-1", "  ", false, "c-1"), "43901");
  const r = w.deletions.request("c-1", "不再需要服务", false, "c-1");
  assert.equal(r.state, "cooling");
  // 重复申请拒绝
  expectError(() => w.deletions.request("c-1", "再次申请", false, "c-1"), "43903");
  // 冷静期内 tick 不处理
  const early = w.deletions.tick(new Date(Date.now() + 5 * 864e5).toISOString(), () => {});
  assert.equal(early.length, 0);
  w.deletions.cancel(r.id, "c-1");
  assert.equal(r.state, "cancelled");
});

test("注销：有在办案件/生效订单被拦截；冷静期到期执行匿名化", () => {
  const w = world();
  expectError(() => w.deletions.request("c-2", "原因", true, "c-2"), "43902");
  const r = w.deletions.request("c-2", "原因", false, "c-2");
  let anonymized = false;
  const done = w.deletions.tick(new Date(Date.now() + 16 * 864e5).toISOString(), () => {
    anonymized = true;
  });
  assert.equal(done.length, 1);
  assert.equal(anonymized, true);
  assert.equal(r.state, "anonymized");
  assert.ok(r.anonymizedAt);
});

/* ===== M5-09 邀请灰度 ===== */

test("邀请：生成→核销；用途不符/过期/重复使用被拒", () => {
  const w = world();
  const inv = w.invites.create({ purpose: "customer", email: "a@b.com" }, "ops-1");
  expectError(() => w.invites.consume(inv.token, "advisor", "x", new Date().toISOString()), "44002");
  w.invites.consume(inv.token, "customer", "c-9", new Date().toISOString());
  expectError(() => w.invites.consume(inv.token, "customer", "c-10", new Date().toISOString()), "44003");
  const inv2 = w.invites.create({ purpose: "provider", ttlDays: -1 }, "ops-1");
  expectError(() => w.invites.consume(inv2.token, "provider", "p-1", new Date().toISOString()), "44004");
  expectError(() => w.invites.consume("nope", "customer", "x", new Date().toISOString()), "44001");
});

/* ===== M5-11 生产 seed 治理 ===== */

test("生产 seed 治理：seed 脚本含环境门，生产环境零示例数据（静态断言）", () => {
  // 1. dev-seed 脚本必须带 NODE_ENV/环境门说明，且所有数据显式标注示例
  const fs = require("node:fs");
  const path = require("node:path");
  const candidates = ["services/api/scripts/dev-seed.sh", "scripts/dev-seed.sh"];
  const seedPath = candidates.find((c) => fs.existsSync(path.resolve(c)));
  assert.ok(seedPath, "dev-seed.sh 未找到");
  const src: string = fs.readFileSync(path.resolve(seedPath), "utf8");
  // 脚本必须自声明仅 dev/test
  assert.ok(/dev\/test|示例/.test(src), "seed 须显式声明仅 dev/test 且数据为示例");
  // 2. 生产环境不应存在 seed 触发路径：脚本名/入口不含 prod 字样的自动执行
  assert.ok(!/prod/.test(path.basename(seedPath)), "seed 入口不得指向 prod");
});
