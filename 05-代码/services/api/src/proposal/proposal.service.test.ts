import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditService } from "../audit.service.js";
import { VerificationService } from "../catalog/verification.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService, COMMITMENT_KEYS } from "../advisors/onboarding.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { ProposalService, type ProposalDraftInput } from "./proposal.service.js";

/** M2-04/05/06/13 方案版本化、A05 复核、客户确认、规则快照 */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    assert.equal(body?.code, bizCode, `期望 ${bizCode}，实际 ${body?.code}：${(e as Error).message}`);
  }
}

function world() {
  const audit = new AuditService();
  const vr = new VerificationService();
  const cat = new CatalogService(vr);
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const grants = new AuthorizationService(ob, ent);
  const engagements = new EngagementService(audit);
  const proposals = new ProposalService(cat, grants, engagements, audit);

  // 已发布费表 + 已核验项目
  const fee = cat.createFeeDraft(
    {
      code: "F-A",
      title: "F-A 收费 v1",
      body: "分项",
      feeItems: [
        { code: "platform_fee", label: "平台服务费", nature: "platform_service", collector: "境内主体", currency: "CNY", amountMinor: 8_800_000n, certainty: "confirmed", timing: "签约时" },
        { code: "official_fee", label: "官方费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52_500n, certainty: "estimated", timing: "递交时" }
      ]
    },
    "editor-1"
  );
  cat.submitFee(fee.id, "editor-1");
  cat.reviewFee(fee.id, "approve", "reviewer-2");
  const fact = vr.register({ fact: "本科以上学历", factType: "condition", sourceType: "official_url", sourceRef: "https://gov.example/a" }, "verifier-3");
  const proj = cat.createProjectDraft({ code: "A-TECH", title: "A国技术居留", body: "透明收费", keyFactIds: [fact.id], feeScheduleId: fee.id }, "editor-1");
  cat.submitProjectForVerification(proj.id, "editor-1");
  cat.passVerification(proj.id, "verifier-3");
  cat.approvePublication(proj.id, "boss-4");

  return { audit, vr, cat, ent, ob, grants, engagements, proposals };
}

function onboardAndGrant(w: ReturnType<typeof world>, advisor: string, code = "A-TECH") {
  const e = w.ent.create({ name: "示例出入境咨询（北京）有限公司", creditCode: `C-${Math.random()}` }, "admin");
  w.ent.update(e.id, { filingNo: "BJ-2026-018", filingExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString() }, "admin");
  w.ent.markActive(e.id, "admin");
  const draft = w.ob.createDraft(
    { phone: `138${Math.floor(Math.random() * 1e8)}`, entityId: e.id, realName: "陈某", materialRefs: ["m1", "m2"], selfIntro: "专注技术居留。", title: "资深顾问", yearsOfPractice: 6, filingNo: "BJ-2026-018" },
    advisor
  );
  for (const k of COMMITMENT_KEYS) w.ob.signCommitment(draft.id, k, advisor);
  w.ob.confirmTraining(draft.id, advisor);
  w.ob.submit(draft.id, advisor);
  w.ob.approve(draft.id, "admin2");
  w.grants.start(advisor, code);
  for (const m of ["project_rules", "banned_words", "fee_script"] as const) w.grants.confirmMaterial(advisor, code, m);
  w.grants.submit(advisor, code, 500);
  w.grants.approve("admin2", advisor, code);
}

function activeRelationship(w: ReturnType<typeof world>, customer: string, advisor: string) {
  const cap = w.engagements.capture({ source: "card_request", customerRef: customer, advisorId: advisor, actor: customer });
  w.engagements.accept(cap.consultation.id, advisor);
}

function baseDraft(customer: string): ProposalDraftInput {
  return {
    customerRef: customer,
    projectCode: "A-TECH",
    advice: [{ text: "学历条件与该项目公开路径匹配，建议准备学位认证。", sourceRef: "A-TECH@v1#education" }],
    responsibilities: "平台负责材料清单与进度提醒，官方审核以当局为准。",
    nonCommitments: ["不承诺获批结果", "官方费以递交时为准"]
  };
}

test("全链路：草稿→复核→客户确认，确认固化规则快照", () => {
  const w = world();
  onboardAndGrant(w, "adv-1");
  activeRelationship(w, "c-1", "adv-1");
  const p = w.proposals.draft(baseDraft("c-1"), "adv-1");
  assert.equal(p.state, "advisor_draft");
  w.proposals.submitReview(p.id, "adv-1");
  // 编制人不能自审
  expectError(() => w.proposals.approve(p.id, "adv-1"), "42314");
  w.proposals.approve(p.id, "rev-2");
  const approved = w.proposals.getById(p.id, { realm: "staff", ref: "rev-2" });
  assert.equal(approved.state, "pending_customer");
  assert.ok(approved.validUntil);
  const confirmed = w.proposals.confirm(p.id, "c-1");
  assert.equal(confirmed.state, "customer_confirmed");
  assert.equal(confirmed.confirmSnapshot?.wordVersion, "baseline-v1");
  assert.equal((confirmed.confirmSnapshot as never as { projectVersion: number }).projectVersion, 1);
});

test("关系未 active 不可编制方案", () => {
  const w = world();
  onboardAndGrant(w, "adv-2");
  expectError(() => w.proposals.draft(baseDraft("c-x"), "adv-2"), "42119");
});

test("方案文案命中禁用词（第四生产点）强拦截", () => {
  const w = world();
  onboardAndGrant(w, "adv-3");
  activeRelationship(w, "c-3", "adv-3");
  const d = baseDraft("c-3");
  d.advice = [{ text: "我们有内部渠道，成功率行业第一", sourceRef: "x" }];
  expectError(() => w.proposals.draft(d, "adv-3"), "42310");
});

test("超模板个性化结论无人工署名不可提交", () => {
  const w = world();
  onboardAndGrant(w, "adv-4");
  activeRelationship(w, "c-4", "adv-4");
  const d = baseDraft("c-4");
  d.advice = [{ text: "结合你的家庭情况，建议先走随行子女路径。" }]; // 无 sourceRef、无署名
  expectError(() => w.proposals.draft(d, "adv-4"), "42311");
  d.advice[0]!.manualSignature = { name: "顾问林某", signedAt: new Date().toISOString() };
  const p = w.proposals.draft(d, "adv-4");
  assert.equal(p.state, "advisor_draft");
});

test("费表只读：偏离只能减免且不得新增收费项", () => {
  const w = world();
  onboardAndGrant(w, "adv-5");
  activeRelationship(w, "c-5", "adv-5");
  const d = baseDraft("c-5");
  d.deviations = [{ type: "discount", itemCode: "not_exist", note: "随便减" }];
  expectError(() => w.proposals.draft(d, "adv-5"), "42305");
  const d2 = baseDraft("c-5");
  d2.deviations = [{ type: "discount", itemCode: "platform_fee", adjustedAmountMinor: "99999999999", note: "高于原价" }];
  expectError(() => w.proposals.draft(d2, "adv-5"), "42307");
});

test("大额减免需第二复核人（独立第三人）", () => {
  const w = world();
  onboardAndGrant(w, "adv-6");
  activeRelationship(w, "c-6", "adv-6");
  const d = baseDraft("c-6");
  d.deviations = [{ type: "discount", itemCode: "platform_fee", adjustedAmountMinor: "1000000", note: "影子期帮扶减免" }];
  const p = w.proposals.draft(d, "adv-6");
  w.proposals.submitReview(p.id, "adv-6");
  expectError(() => w.proposals.approve(p.id, "rev-1"), "42315");
  expectError(() => w.proposals.approve(p.id, "rev-1", "adv-6"), "42316");
  w.proposals.approve(p.id, "rev-1", "rev-2");
  assert.equal(w.proposals.getById(p.id, { realm: "staff", ref: "x" }).state, "pending_customer");
});

test("驳回必填原因并回草稿；客户修改出新版本，旧版不可确认", () => {
  const w = world();
  onboardAndGrant(w, "adv-7");
  activeRelationship(w, "c-7", "adv-7");
  const p = w.proposals.draft(baseDraft("c-7"), "adv-7");
  w.proposals.submitReview(p.id, "adv-7");
  expectError(() => w.proposals.reject(p.id, "rev-1", []), "42317");
  w.proposals.reject(p.id, "rev-1", ["责任分工过粗，请细化"]);
  assert.equal(w.proposals.getById(p.id, { realm: "staff", ref: "x" }).state, "advisor_draft");

  // 重新走到待客户确认
  w.proposals.submitReview(p.id, "adv-7");
  w.proposals.approve(p.id, "rev-1");
  const next = w.proposals.requestRevision(p.id, "c-7", "希望增加随行子女说明");
  assert.equal(next.revision, 2);
  assert.equal(next.supersedesId, p.id);
  // 旧版已不在客户最新列表，且直接调确认被拒
  expectError(() => w.proposals.confirm(p.id, "c-7"), "42319");
  const mine = w.proposals.customerList("c-7");
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.revision, 2);
});

test("越权：顾问/客户查看他人方案 → 403", () => {
  const w = world();
  onboardAndGrant(w, "adv-8");
  activeRelationship(w, "c-8", "adv-8");
  const p = w.proposals.draft(baseDraft("c-8"), "adv-8");
  expectError(() => w.proposals.getById(p.id, { realm: "customer", ref: "c-other" }), "42323");
  expectError(() => w.proposals.getById(p.id, { realm: "advisor", ref: "adv-other" }), "42323");
});
