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

/** 建案（含清单）并上传一份护照材料 */
function setup() {
  const w = world();
  const ref = "c-tl";
  const advisorId = "adv-tl";
  const { order } = effectiveOrder(w, ref, advisorId);
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  const c = w.cases.list().find((x) => x.orderId === order.id)!;
  w.materials.generateChecklist(c.id, "cw");
  w.materials.upload(
    c.id,
    ref,
    "passport",
    { fileHash: "h1", artifactRef: "L3://p.jpg", mime: "image/jpeg", sizeBytes: 1_000_000 },
    ref
  );
  return { w, c, ref, advisorId };
}

test("材料提交/审核自动产生 cu/co 事件", () => {
  const { w, c } = setup();
  const feed = w.timeline.listForCase(c.id);
  assert.equal(feed.some((e) => e.level === "cu"), true);
  const passport = w.materials.listForCase(c.id).find((m) => m.itemCode === "passport")!;
  w.materials.review(passport.id, "approve", {}, "staff-9");
  const after = w.timeline.listForCase(c.id);
  assert.equal(after.some((e) => e.level === "co"), true);
});

test("sp：服务方报告进待核验队列；对客视图带固定后缀且无 off 字段", () => {
  const { w, c } = setup();
  const sp = w.timeline.reportFromProvider(
    c.id,
    "sp-1",
    { kind: "report", title: "律师评估报告", detail: "附件见 L3" },
    "sp-user"
  );
  assert.equal(w.timeline.verificationQueue().some((e) => e.id === sp.id), true);
  const customerView = w.timeline.viewForCase(c.id, { internal: false });
  const row = customerView.find((e) => e.id === sp.id)!;
  assert.match(row.title, /未经官方核验/);
  assert.equal(row.evidenceRef, null);
  assert.equal(row.verifierId, null);
});

test("核验门：发起人自核验 409 拒绝；缺凭据拒绝；驳回保持 sp", () => {
  const { w, c, advisorId } = setup();
  const sp = w.timeline.reportFromProvider(c.id, "sp-1", { title: "报告" }, "sp-user");
  expectError(
    () => w.timeline.verify(sp.id, { decision: "verified", evidenceRef: "L3://off.pdf" }, advisorId),
    "42903"
  );
  expectError(() => w.timeline.verify(sp.id, { decision: "verified" }, "staff-1"), "42902");
  const kept = w.timeline.verify(sp.id, { decision: "rejected", note: "渠道查无此件" }, "staff-1")[0]!;
  assert.equal(kept.level, "sp");
  assert.equal(kept.verification!.state, "rejected");
  assert.equal(w.timeline.listForCase(c.id).some((e) => e.level === "off"), false);
  // 已核验事件不可重复核验
  expectError(() => w.timeline.verify(sp.id, { decision: "verified", evidenceRef: "x" }, "staff-1"), "42904");
});

test("核验通过：另发 off 事件（含凭据/核验人），sp 永久保留来源级别", () => {
  const { w, c } = setup();
  const sp = w.timeline.reportFromProvider(c.id, "sp-1", { kind: "accepted", title: "受理通知" }, "sp-user");
  const out = w.timeline.verify(
    sp.id,
    { decision: "verified", evidenceRef: "L3://acceptance.pdf", note: "官网可查" },
    "staff-1"
  );
  assert.equal(out.length, 2);
  const spAfter = w.timeline.listForCase(c.id).find((e) => e.id === sp.id)!;
  assert.equal(spAfter.level, "sp"); // sp 没有被改写成 off
  const off = w.timeline.listForCase(c.id).find((e) => e.level === "off")!;
  assert.equal(off.title, "官方已受理"); // 固定措辞
  assert.equal(off.evidenceRef, "L3://acceptance.pdf");
  assert.equal(off.verifierId, "staff-1");
});

test("固定措辞：公司“已递交”不可改写", () => {
  const { w, c } = setup();
  const ev = w.timeline.recordCompany(c.id, "submitted", "cw");
  assert.equal(ev.title, "已递交");
});
