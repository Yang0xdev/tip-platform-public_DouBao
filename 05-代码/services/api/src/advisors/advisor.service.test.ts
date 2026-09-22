import { test } from "node:test";
import assert from "node:assert/strict";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService, COMMITMENT_KEYS } from "./onboarding.service.js";
import { AuthorizationService } from "./authorization.service.js";
import { AdvisorCardService } from "./advisor-card.service.js";

/** M1 切片 3：顾问入驻 + 授权五步 + 名片白名单（PRD-M1 M1-09/10/11） */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    assert.equal(body?.code, bizCode, `期望 ${bizCode}，实际 ${body?.code}：${(e as Error).message}`);
  }
}

function activeEntity(ent: EntityService, days = 400) {
  const e = ent.create({ name: "示例出入境咨询（北京）有限公司", creditCode: `C-${Math.random()}` }, "admin");
  ent.update(e.id, { filingNo: "BJ-2026-001", filingExpiresAt: new Date(Date.now() + days * 86_400_000).toISOString() }, "admin");
  ent.markActive(e.id, "admin");
  return e;
}

function fullOnboarding(ob: OnboardingService, ent: EntityService, advisor = "adv1") {
  const e = activeEntity(ent);
  const draft = ob.createDraft(
    { phone: "13800000001", entityId: e.id, realName: "陈某", materialRefs: ["l3://id-card-1", "l3://cert-1"], selfIntro: "专注技术居留，材料透明。", title: "资深顾问", yearsOfPractice: 6, filingNo: "BJ-2026-018" },
    advisor
  );
  for (const k of COMMITMENT_KEYS) ob.signCommitment(draft.id, k, advisor);
  ob.confirmTraining(draft.id, advisor);
  ob.submit(draft.id, advisor);
  return draft;
}

test("入驻：承诺未逐条签署/材料缺失/机构无效/自述违禁，均不可提交", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const e = activeEntity(ent);

  const d1 = ob.createDraft({ phone: "1", entityId: e.id, realName: "甲", materialRefs: ["m"], selfIntro: "x" }, "a1");
  ob.confirmTraining(d1.id, "a1");
  expectError(() => ob.submit(d1.id, "a1"), "42241"); // 承诺未签

  const d2 = ob.createDraft({ phone: "2", entityId: e.id, realName: "乙", materialRefs: [], selfIntro: "x" }, "a2");
  for (const k of COMMITMENT_KEYS) ob.signCommitment(d2.id, k, "a2");
  ob.confirmTraining(d2.id, "a2");
  expectError(() => ob.submit(d2.id, "a2"), "42240"); // 无材料

  const pending = ent.create({ name: "待备案机构", creditCode: "P1" }, "admin");
  const d3 = ob.createDraft({ phone: "3", entityId: pending.id, realName: "丙", materialRefs: ["m"], selfIntro: "x" }, "a3");
  for (const k of COMMITMENT_KEYS) ob.signCommitment(d3.id, k, "a3");
  ob.confirmTraining(d3.id, "a3");
  expectError(() => ob.submit(d3.id, "a3"), "42231"); // 机构无效

  const d4 = ob.createDraft({ phone: "4", entityId: e.id, realName: "丁", materialRefs: ["m"], selfIntro: "我有内部渠道，包过" }, "a4");
  for (const k of COMMITMENT_KEYS) ob.signCommitment(d4.id, k, "a4");
  ob.confirmTraining(d4.id, "a4");
  expectError(() => ob.submit(d4.id, "a4"), "42201"); // 自述违禁
});

test("入驻通过前业务区锁定；审核通过后解锁", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  expectError(() => g.start("adv1", "A-TECH"), "40330");
  const draft = fullOnboarding(ob, ent);
  expectError(() => g.start("adv1", "A-TECH"), "40331"); // 待审核
  ob.approve(draft.id, "admin2");
  g.start("adv1", "A-TECH"); // 不抛错即通过
});

test("授权五步不可跳步：未逐项确认必读资料，直接申请被拒", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  const draft = fullOnboarding(ob, ent);
  ob.approve(draft.id, "admin2");
  g.start("adv1", "A-TECH");
  g.confirmMaterial("adv1", "A-TECH", "project_rules");
  expectError(() => g.submit("adv1", "A-TECH"), "42250"); // 仍缺两份
});

test("授权审批：申请人自批拒绝；有效期取申请时长与备案有效期的较小值", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  const draft = fullOnboarding(ob, ent, "adv9");
  ob.approve(draft.id, "admin2");
  g.start("adv9", "A-TECH");
  for (const k of ["project_rules", "banned_words", "fee_script"] as const) g.confirmMaterial("adv9", "A-TECH", k);
  g.submit("adv9", "A-TECH", 500);
  expectError(() => g.approve("adv9", "adv9", "A-TECH"), "REVIEWER_IS_AUTHOR");
  // 申请 500 天但机构备案仅剩 400 天 → 授权有效期取 min=400
  const rec = g.approve("admin2", "adv9", "A-TECH");
  assert.equal(rec.state, "authorized");
  assert.ok((rec.grantedDays ?? 0) <= 400 && (rec.grantedDays ?? 0) > 395, `grantedDays=${rec.grantedDays}`);
  g.assertCanPitch("adv9", "A-TECH");
  // 未授权项目不可展业
  expectError(() => g.assertCanPitch("adv9", "B-INV"), "40350");
});

test("项目规则更新：授权转待重确认，重确认前不可展业，重走阅读审批后恢复", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  const draft = fullOnboarding(ob, ent, "adv8");
  ob.approve(draft.id, "admin2");
  g.start("adv8", "A-TECH");
  for (const k of ["project_rules", "banned_words", "fee_script"] as const) g.confirmMaterial("adv8", "A-TECH", k);
  g.submit("adv8", "A-TECH");
  g.approve("admin2", "adv8", "A-TECH");
  assert.equal(g.markReconfirm("A-TECH"), 1);
  expectError(() => g.assertCanPitch("adv8", "A-TECH"), "40350");
  g.start("adv8", "A-TECH");
  for (const k of ["project_rules", "banned_words", "fee_script"] as const) g.confirmMaterial("adv8", "A-TECH", k);
  g.submit("adv8", "A-TECH");
  g.approve("admin2", "adv8", "A-TECH");
  g.assertCanPitch("adv8", "A-TECH");
});

test("到期定时任务：授权转 expired 停新", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  const draft = fullOnboarding(ob, ent, "adv7");
  ob.approve(draft.id, "admin2");
  g.start("adv7", "A-TECH");
  for (const k of ["project_rules", "banned_words", "fee_script"] as const) g.confirmMaterial("adv7", "A-TECH", k);
  g.submit("adv7", "A-TECH");
  const rec = g.approve("admin2", "adv7", "A-TECH", new Date(Date.now() - 401 * 86_400_000));
  assert.ok(rec.expiresAt);
  const r = g.refreshExpiry();
  assert.ok(r.expired.includes(rec.id));
  expectError(() => g.assertCanPitch("adv7", "A-TECH"), "40350");
});

test("名片只返回白名单字段；自述未单独审核不展示；统计字段为样本积累中", () => {
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  const cards = new AdvisorCardService(ob, g, ent);
  const draft = fullOnboarding(ob, ent, "adv6");
  ob.approve(draft.id, "admin2");
  g.start("adv6", "A-TECH");
  for (const k of ["project_rules", "banned_words", "fee_script"] as const) g.confirmMaterial("adv6", "A-TECH", k);
  g.submit("adv6", "A-TECH");
  g.approve("admin2", "adv6", "A-TECH");
  const list = cards.listForProject("A-TECH");
  assert.equal(list.length, 1);
  const card = list[0] as Record<string, unknown>;
  assert.equal(card.name, "陈某");
  assert.equal(card.selfIntro, null); // 自述未单独审核
  assert.ok(!("phone" in card) && !("materialRefs" in card) && !("commitments" in card));
  assert.deepEqual((card.stats as Record<string, unknown>).caseCount, null);
  ob.reviewSelfIntro(draft.id, "admin2", "approve");
  const card2 = cards.listForProject("A-TECH")[0] as Record<string, unknown>;
  assert.ok(card2.selfIntro);
});
