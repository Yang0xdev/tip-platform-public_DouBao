import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";
import type { MaterialItem } from "./material.service.js";

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

/** 完整付款链建案 + 生成清单，返回案件与主申 ref */
function setup() {
  const w = world();
  const ref = "c-mat";
  const { order } = effectiveOrder(w, ref, "adv-mat");
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  const c = w.cases.list().find((x) => x.orderId === order.id)!;
  w.materials.generateChecklist(c.id, "cw");
  return { w, c, ref };
}

function find(w: ReturnType<typeof world>, cId: string, code: string): MaterialItem {
  return w.materials.listForCase(cId).find((m) => m.itemCode === code)!;
}

const validUpload = {
  fileHash: "hash-1",
  artifactRef: "L3://passport.jpg",
  mime: "image/jpeg",
  sizeBytes: 1_000_000
};

test("清单生成：模板×申请人；重复生成幂等", () => {
  const { w, c } = setup();
  assert.equal(w.materials.listForCase(c.id).length, 8); // 默认模板 8 项 × 1 申请人
  const again = w.materials.generateChecklist(c.id, "cw");
  assert.equal(again.length, 0);
});

test("受控上传：非法 MIME/超限/缺凭据全部失败且不产生版本（不假成功）", () => {
  const { w, c, ref } = setup();
  const m = find(w, c.id, "passport");
  expectError(
    () => w.materials.upload(c.id, ref, "passport", { ...validUpload, mime: "image/png" }, ref),
    "42602"
  );
  expectError(
    () => w.materials.upload(c.id, ref, "passport", { ...validUpload, sizeBytes: 21 * 1024 * 1024 }, ref),
    "42602"
  );
  expectError(
    () => w.materials.upload(c.id, ref, "passport", { ...validUpload, fileHash: "" }, ref),
    "42602"
  );
  const after = find(w, c.id, "passport");
  assert.equal(after.versions.length, 0);
  assert.equal(after.state, "pending");
});

test("未授权代传：服务端拒绝（P-12a）并审计", () => {
  const { w, c, ref } = setup();
  expectError(() => w.materials.upload(c.id, ref, "passport", validUpload, "someone-else"), "42605");
});

test("上传成功→待审核；审核通过→已通过", () => {
  const { w, c, ref } = setup();
  w.materials.upload(c.id, ref, "passport", validUpload, ref);
  let m = find(w, c.id, "passport");
  assert.equal(m.state, "submitted");
  assert.equal(m.versions[0]!.reviewOutcome, "pending");
  w.materials.review(m.id, "approve", {}, "staff-1");
  m = find(w, c.id, "passport");
  assert.equal(m.state, "approved");
  assert.equal(m.versions[0]!.reviewOutcome, "approved");
});

test("退回：缺三要素拒绝；齐备则需补充并自动生成 T0 任务；重交恢复待审核", () => {
  const { w, c, ref } = setup();
  w.materials.upload(c.id, ref, "passport", validUpload, ref);
  const m = find(w, c.id, "passport");
  expectError(() => w.materials.review(m.id, "return", { reason: "不清楚" }, "staff-1"), "42603");
  const deadline = "2026-10-05T00:00:00Z";
  w.materials.review(
    m.id,
    "return",
    { reason: "四角裁切不完整", requirement: "重新拍摄完整信息页", deadlineAt: deadline },
    "staff-1"
  );
  const after = find(w, c.id, "passport");
  assert.equal(after.state, "supplement_needed");
  assert.equal(after.supplement!.requirement, "重新拍摄完整信息页");
  assert.equal(after.supplement!.deadlineAt, deadline);
  // 自动 T0 任务：截止=时限，责任人=客户
  const task = w.tasks.listForCase(c.id).find((t) => t.title.includes("护照"))!;
  assert.equal(task.dueAt, deadline);
  assert.equal(task.t0, true);
  // 重交
  w.materials.upload(c.id, ref, "passport", { ...validUpload, fileHash: "hash-2" }, ref);
  assert.equal(find(w, c.id, "passport").state, "submitted");
  assert.equal(find(w, c.id, "passport").versions.length, 2);
});

test("已审核文件不可就地替换：再传产生新版本，旧版标记被取代但留存", () => {
  const { w, c, ref } = setup();
  w.materials.upload(c.id, ref, "passport", validUpload, ref);
  const m0 = find(w, c.id, "passport");
  w.materials.review(m0.id, "approve", {}, "staff-1");
  w.materials.upload(c.id, ref, "passport", { ...validUpload, fileHash: "hash-new" }, ref);
  const m = find(w, c.id, "passport");
  assert.equal(m.versions.length, 2);
  assert.equal(m.versions[0]!.superseded, true);
  assert.equal(m.versions[1]!.superseded, false);
  assert.equal(m.versions[1]!.reviewOutcome, "pending");
  assert.equal(m.state, "submitted");
});

test("原件查看：本人访问留痕；顾问/他人直链 403 且审计", () => {
  const { w, c, ref } = setup();
  w.materials.upload(c.id, ref, "passport", validUpload, ref);
  const m = find(w, c.id, "passport");
  const art = w.materials.getArtifact(m.id, ref, "customer");
  assert.equal(art.artifactRef, "L3://passport.jpg");
  assert.equal(find(w, c.id, "passport").accessLog.length, 1);
  expectError(() => w.materials.getArtifact(m.id, "advisor-x", "staff"), "42605");
  expectError(() => w.materials.getArtifact(m.id, "other-customer", "customer"), "42605");
});

test("顾问只读视图不含原件引用", () => {
  const { w, c, ref } = setup();
  w.materials.upload(c.id, ref, "passport", validUpload, ref);
  const rows = w.materials.listForAdvisor(c.id);
  const row = rows.find((r) => r.itemCode === "passport")!;
  assert.equal("versions" in row, false);
  assert.equal(row.state, "submitted");
});
