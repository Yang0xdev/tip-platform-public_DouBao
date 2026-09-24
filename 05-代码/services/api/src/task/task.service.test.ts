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

/** 走完整付款链建案 */
function makeCase(w: ReturnType<typeof world>, ref = "c-x") {
  const advisorId = `adv-${ref}`;
  const { order } = effectiveOrder(w, ref, advisorId);
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  return w.cases.list().find((x) => x.orderId === order.id)!;
}

/** 建案并返回一个 T0 任务（dueAt 由调用方给） */
function seededTask(w: ReturnType<typeof world>, dueAt: string, ref = "c-x") {
  const c = makeCase(w, ref);
  const advisorId = `adv-${ref}`;
  const t = w.tasks.create(
    c.id,
    { type: "supplement", title: "补充学历认证材料", ownerId: advisorId, dueAt, source: "official", t0: true },
    "cw"
  );
  return { c, t };
}

test("创建：案件不存在/字段缺失/T0 来源非法均拒绝", () => {
  const w = world();
  const c = makeCase(w);
  expectError(
    () => w.tasks.create("CASE-999", { type: "x", title: "t", ownerId: "o", dueAt: "2026-10-01T00:00:00Z", source: "sla", t0: false }, "cw"),
    "42801"
  );
  expectError(
    () => w.tasks.create(c.id, { type: "x", title: "", ownerId: "o", dueAt: "2026-10-01T00:00:00Z", source: "sla", t0: false }, "cw"),
    "42802"
  );
  expectError(
    () => w.tasks.create(c.id, { type: "x", title: "t", ownerId: "o", dueAt: "bad", source: "sla", t0: false }, "cw"),
    "42802"
  );
  expectError(
    () => w.tasks.create(c.id, { type: "x", title: "t", ownerId: "o", dueAt: "2026-10-01T00:00:00Z", source: "sla", t0: true }, "cw"),
    "42802"
  );
});

test("生命周期与时钟：start/complete；tick 到期转 overdue 且幂等", () => {
  const w = world();
  const { t } = seededTask(w, "2026-09-20T00:00:00Z");
  w.tasks.start(t.id, "adv-1");
  assert.equal(w.tasks.list().find((x) => x.id === t.id)!.state, "doing");
  const hit1 = w.tasks.tick("2026-09-21T00:00:00Z");
  assert.deepEqual(hit1, [t.id]);
  const hit2 = w.tasks.tick("2026-09-22T00:00:00Z");
  assert.deepEqual(hit2, []); // 幂等
  assert.equal(w.tasks.list().find((x) => x.id === t.id)!.state, "overdue");
  // 逾期仍可完成
  w.tasks.complete(t.id, "cw");
  assert.equal(w.tasks.list().find((x) => x.id === t.id)!.state, "done");
});

test("AT19：升级逐级记录，但截止时间字段始终不变", () => {
  const w = world();
  const { t } = seededTask(w, "2026-09-20T00:00:00Z");
  w.tasks.tick("2026-09-21T00:00:00Z");
  expectError(() => w.tasks.escalate(t.id, "", "cw"), "42803");
  w.tasks.escalate(t.id, "App/短信未读，转人工", "cw");
  w.tasks.escalate(t.id, "家属代接本人未确认，继续升级", "cw");
  const after = w.tasks.list().find((x) => x.id === t.id)!;
  assert.equal(after.state, "escalated");
  assert.equal(after.escalations.length, 2);
  assert.equal(after.dueAt, "2026-09-20T00:00:00Z"); // 截止不变
  assert.equal(after.reschedules.length, 0);
});

test("改期：非逾期态不可改；缺凭据/核验人=发起人拒绝；凭据齐备才改并保留原截止", () => {
  const w = world();
  const future = seededTask(w, "2026-10-20T00:00:00Z","c-f");
  // open 态不能 reschedule（白名单仅 overdue→open）
  expectError(
    () => w.tasks.reschedule(future.t.id, { newDueAt: "2026-11-01T00:00:00Z", reason: "官方改期", evidenceRef: "L3://e.pdf", verifierId: "v9" }, "cw"),
    "42210"
  );
  const past = seededTask(w, "2026-09-20T00:00:00Z","c-p");
  w.tasks.tick("2026-09-21T00:00:00Z");
  expectError(
    () => w.tasks.reschedule(past.t.id, { newDueAt: "2026-10-01T00:00:00Z", reason: "", evidenceRef: "L3://e.pdf", verifierId: "v9" }, "cw"),
    "42803"
  );
  // 核验人 = 发起人（adv-c-p）
  expectError(
    () => w.tasks.reschedule(past.t.id, { newDueAt: "2026-10-01T00:00:00Z", reason: "官方改期", evidenceRef: "L3://e.pdf", verifierId: "adv-c-p" }, "cw"),
    "42211"
  );
  const r = w.tasks.reschedule(
    past.t.id,
    { newDueAt: "2026-10-01T00:00:00Z", reason: "官方通知补件截止延后", evidenceRef: "L3://e.pdf", verifierId: "v9" },
    "cw"
  );
  assert.equal(r.state, "open");
  assert.equal(r.dueAt, "2026-10-01T00:00:00Z");
  assert.equal(r.reschedules[0]!.oldDueAt, "2026-09-20T00:00:00Z");
});

test("查询：责任人视图排除已完成；逾期清单含升级中", () => {
  const w = world();
  const a = seededTask(w, "2026-10-01T00:00:00Z", "c-a");
  const b = seededTask(w, "2026-09-20T00:00:00Z", "c-b");
  w.tasks.complete(a.t.id, "cw");
  w.tasks.tick("2026-09-21T00:00:00Z");
  assert.equal(w.tasks.listForOwner("adv-c-a").some((t) => t.id === a.t.id), false);
  assert.deepEqual(w.tasks.overdue().map((t) => t.id), [b.t.id]);
});
