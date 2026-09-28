import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder, ENTITY_NAME } from "../test-utils/world.js";

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

/** 建一个可用境内主体（不经过完整订单链） */
function usableEntity(w: ReturnType<typeof world>) {
  const e = w.ent.create({ name: ENTITY_NAME, creditCode: "C-X1" }, "admin");
  w.ent.update(e.id, { filingNo: "BJ-2026-019", filingExpiresAt: "2027-03-01T00:00:00Z" }, "admin");
  w.ent.markActive(e.id, "admin");
  return e;
}

test("ext 准入：缺件逐项列明（境内主体/持牌/协议四件）", () => {
  const w = world();
  const sp = w.providers.create({ type: "overseas_licensee", mode: "ext", name: "境外律所A" }, "op");
  expectError(() => w.providers.submit(sp.id, "op"), "43202");
});

test("ext 全链路：关联主体+持牌核验+协议四件+双人复核 → active，assertUsable 通过", () => {
  const w = world();
  const ent = usableEntity(w);
  const sp = w.providers.create({ type: "overseas_licensee", mode: "ext", name: "境外律所A" }, "op");
  w.providers.linkDomesticEntity(sp.id, ent.id, "op");
  w.providers.attachLicense(
    sp.id,
    { credentialNo: "RCIC-1", country: "CA", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-01-01T00:00:00Z" },
    "op"
  );
  expectError(() => w.providers.submit(sp.id, "op"), "43202"); // 持牌未核验+协议缺
  w.providers.verifyLicense(sp.id, "ver-1");
  for (const key of ["framework", "dataProcessing", "confidentiality", "serviceLevel"] as const)
    w.providers.setAgreement(sp.id, key, "op");
  w.providers.submit(sp.id, "op");
  expectError(() => w.providers.review(sp.id, "active", "op"), "43204"); // 提交人自审拒
  w.providers.review(sp.id, "active", "rev-2");
  assert.equal(w.providers.list().find((x) => x.id === sp.id)!.state, "active");
  w.providers.assertUsable(sp.id);
});

test("in 模式（自营交付部门）不豁免：持牌登记+协议四件同样必查", () => {
  const w = world();
  const sp = w.providers.create({ type: "inhouse_delivery", mode: "in", name: "自营交付中心" }, "op");
  expectError(() => w.providers.submit(sp.id, "op"), "43202");
  w.providers.attachLicense(sp.id, { credentialNo: "REG-2", country: "PT", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-06-01T00:00:00Z" }, "op");
  w.providers.verifyLicense(sp.id, "ver-1");
  for (const key of ["framework", "dataProcessing", "confidentiality", "serviceLevel"] as const)
    w.providers.setAgreement(sp.id, key, "op");
  w.providers.submit(sp.id, "op");
  w.providers.review(sp.id, "active", "rev-2");
  assert.ok(w.providers.findUsableOverseas());
});

test("时钟：临期 expiring；过期 suspended（门户停权/停派案读状态）", () => {
  const w = world();
  const sp = w.providers.create({ type: "inhouse_delivery", mode: "in", name: "自营" }, "op");
  w.providers.attachLicense(
    sp.id,
    { credentialNo: "L-1", country: "PT", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-10-20T00:00:00Z" },
    "op"
  );
  w.providers.verifyLicense(sp.id, "ver-1");
  for (const key of ["framework", "dataProcessing", "confidentiality", "serviceLevel"] as const)
    w.providers.setAgreement(sp.id, key, "op");
  w.providers.submit(sp.id, "op");
  w.providers.review(sp.id, "active", "rev-2");
  w.providers.tick("2026-09-28T00:00:00Z");
  assert.equal(w.providers.list().find((x) => x.id === sp.id)!.state, "expiring");
  w.providers.tick("2026-10-21T00:00:00Z");
  assert.equal(w.providers.list().find((x) => x.id === sp.id)!.state, "suspended");
  expectError(() => w.providers.assertUsable(sp.id), "43205");
});

