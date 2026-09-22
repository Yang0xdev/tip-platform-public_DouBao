import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogService, CatalogError } from "./catalog.service.js";
import { VerificationService } from "./verification.service.js";
import { EntityService } from "../entities/entity.service.js";

/** M1 切片 2 服务测试：项目核验门 + 收费四眼 + 失效阻断 + 机构台账（PRD-M1 M1-01..05） */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    assert.ok(e instanceof Error, "应当抛 Error");
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    const code = body?.code ?? (e as { bizCode?: string }).bizCode;
    assert.equal(code, bizCode, `期望 ${bizCode}，实际 ${code}：${(e as Error).message}`);
  }
}

function setup() {
  const vr = new VerificationService();
  return { vr, cat: new CatalogService(vr) };
}

/** 构造一条已发布收费方案（异人员工复核） */
function publishFee(cat: CatalogService, code: string) {
  const f = cat.createFeeDraft(
    {
      code,
      title: `${code} 收费 v1`,
      body: "分项列明",
      feeItems: [
        { code: "platform_fee", label: "平台服务费", nature: "platform_service", collector: "示例出入境咨询（北京）有限公司", currency: "CNY", amountMinor: 8800000n, certainty: "confirmed", timing: "签约时" },
        { code: "official_fee", label: "官方申请费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52500n, certainty: "estimated", timing: "递交时" }
      ]
    },
    "editor-1"
  );
  cat.submitFee(f.id, "editor-1");
  cat.reviewFee(f.id, "approve", "reviewer-2");
  return f;
}

test("项目发布全链路：核验人≠编辑人、事实齐全、收费已发布，方可对客可见", () => {
  const { vr, cat } = setup();
  const fee = publishFee(cat, "F-A");
  const fact = vr.register({ fact: "技术居留需本科以上学历", factType: "condition", sourceType: "official_url", sourceRef: "https://gov.example/a/tech" }, "verifier-3");
  const p = cat.createProjectDraft({ code: "A-TECH", title: "A国技术居留", body: "透明收费", keyFactIds: [fact.id], feeScheduleId: fee.id }, "editor-1");

  // 未核验通过前，发布复核不可达（状态白名单）
  expectError(() => cat.approvePublication(p.id, "boss-4"), "40901");

  cat.submitProjectForVerification(p.id, "editor-1");
  // 编辑人自己核验 → 拒绝
  expectError(() => cat.passVerification(p.id, "editor-1"), "VERIFIER_IS_EDITOR");
  cat.passVerification(p.id, "verifier-3");
  // 最后编辑人=发布人 → 拒绝
  expectError(() => cat.approvePublication(p.id, "editor-1"), "PUBLISHER_IS_EDITOR");
  cat.approvePublication(p.id, "boss-4");
  assert.equal(cat.listPublishedProjects().length, 1);
});

test("反例：关键事实无核验记录，核验通过被拒（逐条列出）", () => {
  const { cat } = setup();
  const p = cat.createProjectDraft({ code: "B-INV", title: "B地区投资居留 v0.9", body: "x", keyFactIds: ["VR-999"] }, "editor-1");
  cat.submitProjectForVerification(p.id, "editor-1");
  expectError(() => cat.passVerification(p.id, "verifier-3"), "KEY_FACTS_UNVERIFIED");
  assert.equal(cat.listPublishedProjects().length, 0);
});

test("零关键事实不可进入待发布", () => {
  const { cat } = setup();
  const p = cat.createProjectDraft({ code: "C", title: "C国数字游民", body: "x" }, "editor-1");
  cat.submitProjectForVerification(p.id, "editor-1");
  expectError(() => cat.passVerification(p.id, "verifier-3"), "KEY_FACTS_REQUIRED");
});

test("核验记录失效后，已发布项目自动停止对客展示", () => {
  const { vr, cat } = setup();
  const fee = publishFee(cat, "F-D");
  const fact = vr.register({ fact: "政策条款 X", factType: "policy", sourceType: "official_url", sourceRef: "https://gov.example/d/x" }, "verifier-3");
  const p = cat.createProjectDraft({ code: "D", title: "D国项目", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "editor-1");
  cat.submitProjectForVerification(p.id, "editor-1");
  cat.passVerification(p.id, "verifier-3");
  cat.approvePublication(p.id, "boss-4");
  assert.equal(cat.listPublishedProjects().length, 1);
  vr.invalidate(fact.id, "官方页面 404");
  assert.equal(cat.listPublishedProjects().length, 0);
  expectError(() => cat.getPublishedProject(p.id), "40401");
});

test("词库 block 拦截草稿；暂停需原因与处置说明；修订已发布版本产生新版本旧版归档", () => {
  const { vr, cat } = setup();
  expectError(() => cat.createProjectDraft({ code: "X", title: "包过项目", body: "x" }, "e1"), "42201");
  const fee = publishFee(cat, "F-E");
  const fact = vr.register({ fact: "f", factType: "policy", sourceType: "official_url", sourceRef: "https://g.example/e" }, "v3");
  const p = cat.createProjectDraft({ code: "E", title: "E项目", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "e1");
  cat.submitProjectForVerification(p.id, "e1");
  cat.passVerification(p.id, "v3");
  cat.approvePublication(p.id, "b4");
  expectError(() => cat.suspend(p.id, "b4", "", ""), "40005");
  cat.suspend(p.id, "b4", "政策调整", "在办客户继续交付，新客转说明页");
  const v2 = cat.newProjectVersion(p.id, "e9");
  assert.equal(v2.version, 2);
  assert.equal(v2.state, "draft");
  assert.equal(cat.adminListProjects().find((r) => r.id === p.id)?.state, "suspended");
});

test("收费方案：tbc 不得填金额；同 code 新版本发布后旧版自动 superseded", () => {
  const { cat } = setup();
  expectError(
    () =>
      cat.createFeeDraft(
        { code: "F-TBC", title: "待确认费", body: "", feeItems: [{ code: "u", label: "待补", nature: "third_party", collector: null, currency: null, amountMinor: 100n, certainty: "tbc", timing: "待定" }] },
        "e1"
      ),
    "MONEY_TBC_HAS_AMOUNT"
  );
  const v1 = publishFee(cat, "F-MULTI");
  const draft2 = cat.createFeeDraft({ code: "F-MULTI", title: "收费 v2", body: "", feeItems: [{ code: "p", label: "平台服务费", nature: "platform_service", collector: "境内主体", currency: "CNY", amountMinor: 9000000n, certainty: "confirmed", timing: "签约时" }] }, "e1");
  assert.equal(draft2.version, 2);
  cat.submitFee(draft2.id, "e1");
  cat.reviewFee(draft2.id, "approve", "reviewer-2");
  const old = cat.adminListFees().find((f) => f.id === v1.id);
  assert.equal(old?.state, "superseded");
  assert.equal(cat.listPublishedFees().filter((f) => f.code === "F-MULTI").length, 1);
});

test("境内机构台账：无有效机构时入驻门拒绝；到期机构停新", () => {
  const ent = new EntityService();
  const e = ent.create({ name: "示例出入境咨询（北京）有限公司", creditCode: "91110000MA0000000X" }, "admin-1");
  // 待备案不可入驻
  expectError(() => ent.assertUsable(e.id), "42231");
  expectError(() => ent.markActive(e.id, "admin-1"), "42230");
  ent.update(e.id, { filingNo: "BJ-2026-001", filingExpiresAt: new Date(Date.now() + 200 * 86_400_000).toISOString() }, "admin-1");
  ent.markActive(e.id, "admin-1");
  ent.assertUsable(e.id); // 有效可用
  // 到期机构
  const expired = ent.create({ name: "临期机构", creditCode: "91110000MA0000001Y" }, "admin-1");
  ent.update(expired.id, { filingNo: "BJ-2026-002", filingExpiresAt: new Date(Date.now() - 86_400_000).toISOString() }, "admin-1");
  ent.markActive(expired.id, "admin-1");
  expectError(() => ent.assertUsable(expired.id), "42231");
  // 临期（60 天内）仍可用并进看板
  const soon = ent.create({ name: "临期三十天机构", creditCode: "91110000MA0000002Z" }, "admin-1");
  ent.update(soon.id, { filingNo: "BJ-2026-003", filingExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() }, "admin-1");
  ent.markActive(soon.id, "admin-1");
  ent.assertUsable(soon.id);
  assert.equal(ent.list().find((x) => x.id === soon.id)?.displayStatus, "due_soon");
});
