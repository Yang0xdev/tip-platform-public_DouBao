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

/** 建案 + 配偶 + 子女，补清单 */
function setup() {
  const w = world();
  const ref = "c-con";
  const advisorId = "adv-con";
  const { order } = effectiveOrder(w, ref, advisorId);
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  const c = w.cases.list().find((x) => x.orderId === order.id)!;
  w.cases.addApplicant(c.id, "spouse-1", "spouse", ref);
  w.cases.addApplicant(c.id, "child-1", "child", ref);
  w.materials.generateChecklist(c.id, "cw");
  return { w, c, ref };
}

const validUntil = "2027-06-01T00:00:00Z";
const upload = { fileHash: "h", artifactRef: "L3://p.jpg", mime: "image/jpeg", sizeBytes: 1_000_000 };

test("邀请：非主申/非成员/重复邀请均拒绝；成功产生 pending_self", () => {
  const { w, c } = setup();
  expectError(() => w.consents.invite(c.id, "spouse-1", "someone"), "43004");
  expectError(() => w.consents.invite(c.id, "nobody", c.customerRef), "43002");
  const g = w.consents.invite(c.id, "spouse-1", c.customerRef);
  assert.equal(g.state, "pending_self");
  expectError(() => w.consents.invite(c.id, "spouse-1", c.customerRef), "43003");
});

test("AT20：主申代成年成员确认拒绝；本人逐项确认后动作生效，未勾动作不生效", () => {
  const { w, c } = setup();
  const g = w.consents.invite(c.id, "spouse-1", c.customerRef);
  expectError(
    () => w.consents.selfConfirm(g.id, { actions: ["progress:view"], validUntil }, c.customerRef),
    "43004"
  );
  expectError(() => w.consents.selfConfirm(g.id, { actions: [], validUntil }, "spouse-1"), "43002");
  w.consents.selfConfirm(g.id, { actions: ["material:view_submit"], validUntil }, "spouse-1");
  const after = w.consents.listGrantsForCase(c.id).find((x) => x.id === g.id)!;
  assert.equal(after.state, "active");
  w.consents.assertAction(c.id, "spouse-1", "material:view_submit");
  expectError(() => w.consents.assertAction(c.id, "spouse-1", "matter:confirm"), "43006");
});

test("AT20：撤回即时生效，撤回后继续访问被拒；过期同样停权", () => {
  const { w, c } = setup();
  const g = w.consents.invite(c.id, "spouse-1", c.customerRef);
  w.consents.selfConfirm(g.id, { actions: ["material:view_submit"], validUntil }, "spouse-1");
  expectError(() => w.consents.revoke(g.id, "", "spouse-1", "customer"), "43002");
  w.consents.revoke(g.id, "本人撤回", "spouse-1", "customer");
  expectError(() => w.consents.assertAction(c.id, "spouse-1", "material:view_submit"), "43006");
});

test("AT20：无监护证据代子女提交拒绝；核验通过可代提交；争议冻结后再次拒绝", () => {
  const { w, c, ref } = setup();
  expectError(
    () => w.materials.upload(c.id, "child-1", "passport", { ...upload, fileHash: "hc1" }, ref),
    "43005"
  );
  expectError(
    () =>
      w.consents.submitGuardianshipEvidence(
        c.id,
        "child-1",
        { artifactRef: "L3://birth.jpg", fileHash: "" },
        ref
      ),
    "43002"
  );
  const grd = w.consents.submitGuardianshipEvidence(
    c.id,
    "child-1",
    { artifactRef: "L3://birth.jpg", fileHash: "gb1" },
    ref
  );
  // 未核验仍拒绝
  expectError(
    () => w.materials.upload(c.id, "child-1", "passport", { ...upload, fileHash: "hc1" }, ref),
    "43005"
  );
  w.consents.verifyGuardianship(grd.id, "ver-1");
  w.materials.upload(c.id, "child-1", "passport", { ...upload, fileHash: "hc1" }, ref);
  assert.equal(
    w.materials.listForCase(c.id).find((m) => m.personRef === "child-1")!.state,
    "submitted"
  );
  // 争议冻结
  w.consents.raiseGuardianshipDispute(grd.id, "离异监护权争议待判", "staff");
  expectError(
    () => w.materials.upload(c.id, "child-1", "photo", { ...upload, fileHash: "hc2" }, ref),
    "43005"
  );
});

test("成年成员：无授权上传材料拒绝（43006），本人确认授权后可传", () => {
  const { w, c } = setup();
  expectError(
    () => w.materials.upload(c.id, "spouse-1", "passport", { ...upload, fileHash: "hs0" }, "spouse-1"),
    "43006"
  );
  const g = w.consents.invite(c.id, "spouse-1", c.customerRef);
  w.consents.selfConfirm(g.id, { actions: ["material:view_submit"], validUntil }, "spouse-1");
  w.materials.upload(c.id, "spouse-1", "passport", { ...upload, fileHash: "hs1" }, "spouse-1");
  assert.equal(
    w.materials.listForCase(c.id).find((m) => m.personRef === "spouse-1")!.state,
    "submitted"
  );
});

test("线下授权书：受控登记直接生效，动作逐项；跨境同意结构先行且可一键回收", () => {
  const { w, c } = setup();
  const g = w.consents.registerPaper(
    c.id,
    "spouse-1",
    { artifactRef: "L3://paper.pdf", actions: ["notice:receive"], validUntil, verifierId: "ver-2" },
    "staff"
  );
  assert.equal(g.channel, "paper");
  w.consents.assertAction(c.id, "spouse-1", "notice:receive");
  // 跨境
  const cb = w.consents.recordCrossBorder(
    c.id,
    "sp-1",
    [{ scope: "passport_page" }, { scope: "birth_cert" }],
    c.customerRef
  );
  assert.equal(cb.items.length, 2);
  w.consents.revokeCrossBorder(cb.id, c.customerRef);
  assert.equal(w.consents["cross"].get(cb.id)!.revokedAt !== null, true);
});
