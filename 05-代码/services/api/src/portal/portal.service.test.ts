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

/** 建案 + 一个 active 服务方 + 门户账号（完成实名/MFA） */
function setup() {
  const w = world();
  const ref = "c-portal";
  const { order } = effectiveOrder(w, ref, "adv-portal");
  // 首付核验 → 自动建案
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  const c = w.cases.list().find((x) => x.orderId === order.id)!;
  const sp = w.providers.create({ type: "inhouse_delivery", mode: "in", name: "自营交付部门" }, "op");
  w.providers.attachLicense(sp.id, { credentialNo: "REG-1", country: "PT", issuedAt: "2026-01-01T00:00:00Z", expiresAt: "2027-06-01T00:00:00Z" }, "op");
  w.providers.verifyLicense(sp.id, "ver-1");
  for (const key of ["framework", "dataProcessing", "confidentiality", "serviceLevel"] as const)
    w.providers.setAgreement(sp.id, key, "op");
  w.providers.submit(sp.id, "op");
  w.providers.review(sp.id, "active", "rev-2");
  const acc = w.portal.openAccount(sp.id, { login: "PA-LOGIN", name: "王律师" }, "admin");
  return { w, c, sp, acc };
}

test("账号随主体；未完成实名/MFA 不可见批次；授权批准后可见（无全局列表）", () => {
  const { w, c, sp, acc } = setup();
  assert.deepEqual(w.portal.visibleCases(acc.id), []);
  w.portal.completeAccountSetup(acc.id, "realname", "admin");
  w.portal.completeAccountSetup(acc.id, "mfa", "admin");
  const g = w.portal.createGrant(
    sp.id,
    c.id,
    { materialScopes: ["passport", "birth_cert"], actions: ["material_view", "report_upload"] },
    "admin"
  );
  // 未批准前不可见
  assert.deepEqual(w.portal.visibleCases(acc.id), []);
  w.portal.approveView(g.id, "admin");
  const cases = w.portal.visibleCases(acc.id);
  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0]!.scopes.sort(), ["birth_cert", "passport"]);
});

test("越权访问冻结并审计（43405）", () => {
  const { w, acc } = setup();
  w.portal.completeAccountSetup(acc.id, "realname", "admin");
  w.portal.completeAccountSetup(acc.id, "mfa", "admin");
  expectError(() => w.portal.assertInScope(acc.id, "CASE-9999", "passport", "material_view"), "43405");
});

test("受控阅读器：打开带水印信息，翻页逐页审计，关闭即清", () => {
  const { w, c, sp, acc } = setup();
  w.portal.completeAccountSetup(acc.id, "realname", "admin");
  w.portal.completeAccountSetup(acc.id, "mfa", "admin");
  const g = w.portal.createGrant(
    sp.id,
    c.id,
    { materialScopes: ["passport"], actions: ["material_view"] },
    "admin"
  );
  w.portal.approveView(g.id, "admin");
  const { session, watermark } = w.portal.openReader(acc.id, c.id, "passport");
  assert.equal(watermark.name, "王律师");
  assert.match(watermark.org, /自营/);
  w.portal.viewPage(session.id, 1, "PA-LOGIN");
  w.portal.viewPage(session.id, 2, "PA-LOGIN");
  assert.equal(session.pageAudit.length, 2);
  w.portal.closeReader(session.id, "PA-LOGIN");
  assert.equal(session.closed, true);
});

test("原件单独审批：2h 窗口；窗口结束定时回收为 expired", () => {
  const { w, c, sp } = setup();
  const g = w.portal.createGrant(
    sp.id,
    c.id,
    { materialScopes: ["passport"], actions: ["material_view"] },
    "admin"
  );
  w.portal.approveView(g.id, "admin");
  w.portal.requestOriginal(g.id, "admin");
  w.portal.approveOriginal(g.id, "ver-1");
  assert.equal(g.state, "download_window");
  const end = g.original.windowEndsAt!;
  const after = new Date(Date.parse(end) + 1000).toISOString();
  w.portal.tick(after);
  assert.equal(w.portal.listGrants().find((x) => x.id === g.id)!.state, "expired");
});

test("影印件有效期到期回收；水印 PDF 是唯一下载形态（无裸文件端点）", () => {
  const { w, c, sp, acc } = setup();
  w.portal.completeAccountSetup(acc.id, "realname", "admin");
  w.portal.completeAccountSetup(acc.id, "mfa", "admin");
  const g = w.portal.createGrant(
    sp.id,
    c.id,
    {
      materialScopes: ["passport"],
      actions: ["material_view"],
      validUntil: "2026-10-10T00:00:00Z"
    },
    "admin"
  );
  w.portal.approveView(g.id, "admin");
  const pdf = w.portal.requestWatermarkedPdf(acc.id, c.id, "passport");
  assert.match(pdf.artifactRef, /watermarked/);
  assert.match(pdf.mark, /王律师/);
  w.portal.tick("2026-10-11T00:00:00Z");
  assert.equal(w.portal.listGrants().find((x) => x.id === g.id)!.state, "expired");
});

test("报告凭据提交 → sp 时间线事件进待核验队列（不直接成为官方节点）", () => {
  const { w, c, sp, acc } = setup();
  w.portal.completeAccountSetup(acc.id, "realname", "admin");
  w.portal.completeAccountSetup(acc.id, "mfa", "admin");
  const g = w.portal.createGrant(
    sp.id,
    c.id,
    { materialScopes: ["report"], actions: ["report_upload"] },
    "admin"
  );
  w.portal.approveView(g.id, "admin");
  const ev = w.portal.submitReport(
    acc.id,
    c.id,
    { kind: "report", title: "律师评估报告", detail: "见 L3" },
    "PA-LOGIN"
  );
  assert.equal(ev.level, "sp");
  assert.equal(w.timeline.verificationQueue().some((e) => e.id === ev.id), true);
});
