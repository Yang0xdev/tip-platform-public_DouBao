import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogService } from "../catalog/catalog.service.js";
import { VerificationService } from "../catalog/verification.service.js";
import { AssessmentTemplateService, type QuestionnaireContent, type ResultTemplateContent } from "./template.service.js";
import { RuleSetService } from "./ruleset.service.js";

/** M1 切片 4：问卷/结论模板四眼 + 规则集证据门 + 无状态初评（M1-07/08） */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    assert.equal(body?.code, bizCode, `期望 ${bizCode}，实际 ${body?.code}：${(e as Error).message}`);
  }
}

function setup() {
  const vr = new VerificationService();
  const cat = new CatalogService(vr);
  const tpl = new AssessmentTemplateService();
  const rules = new RuleSetService(vr, cat);
  return { vr, cat, tpl, rules };
}

const questionnaire: QuestionnaireContent = {
  questions: [
    { code: "destination", group: "意向", title: "意向目的地", type: "single", required: true, options: [{ value: "A", label: "A国" }] },
    { code: "degree", group: "背景", title: "学历", type: "choice", required: true, options: [{ value: "bachelor", label: "本科及以上" }, { value: "below", label: "本科以下" }] },
    { code: "age", group: "背景", title: "年龄", type: "number", required: true }
  ]
};
const resultTemplate: ResultTemplateContent = {
  blocks: {
    eligible: { title: "已知符合", body: "以下条件与公开政策匹配" },
    gap: { title: "明显差距", body: "存在当前不满足项，附可能方向，不承诺可弥补" },
    unconfirmed: { title: "待确认", body: "需官方或持牌方核实" },
    not_committed: { title: "信息未完成", body: "仅整理已完成部分" }
  },
  needsManualNote: "建议由顾问人工解读（即将开放）",
  noMatchNote: "当前试点暂无匹配路径"
};

/** 发布一个项目（收费+核验齐全），返回 code 与核验记录 */
function publishProject(s: ReturnType<typeof setup>) {
  const fee = s.cat.createFeeDraft({ code: "F-A", title: "收费", body: "", feeItems: [{ code: "p", label: "平台服务费", nature: "platform_service", collector: "境内主体", currency: "CNY", amountMinor: 8800000n, certainty: "confirmed", timing: "签约时" }] }, "e1");
  s.cat.submitFee(fee.id, "e1");
  s.cat.reviewFee(fee.id, "approve", "r2");
  const fact = s.vr.register({ fact: "本科以上学历", factType: "condition", sourceType: "official_url", sourceRef: "https://gov.example/a/edu" }, "v3");
  const p = s.cat.createProjectDraft({ code: "A-TECH", title: "A国技术居留", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "e1");
  s.cat.submitProjectForVerification(p.id, "e1");
  s.cat.passVerification(p.id, "v3");
  s.cat.approvePublication(p.id, "b4");
  return { fact };
}

test("问卷/结论模板：四眼发布，未发布客户端不可加载，词库在 assessment 生产点拦截", () => {
  const { tpl } = setup();
  const q = tpl.createDraft("questionnaire", "Q1", "标准问卷 v1", questionnaire, "e1");
  expectError(() => tpl.requirePublished("questionnaire"), "40460");
  tpl.submit(q.id, "e1");
  expectError(() => tpl.review(q.id, "approve", "e1"), "REVIEWER_IS_AUTHOR");
  tpl.review(q.id, "approve", "r2");
  const pub = tpl.requirePublished("questionnaire");
  assert.equal(pub.version, 1);

  const bad: QuestionnaireContent = { questions: [{ code: "x", group: "g", title: "我们包过", type: "text", required: false }] };
  expectError(() => tpl.createDraft("questionnaire", "QBAD", "违规问卷", bad, "e1"), "42201");

  const rt = tpl.createDraft("result_template", "R1", "结论模板 v1", resultTemplate, "e1");
  tpl.submit(rt.id, "e1");
  tpl.review(rt.id, "approve", "r2");
  assert.ok(tpl.requirePublished("result_template"));
});

test("规则集：项目未发布不可建；维度证据缺失/失效不可发布；发布后可无状态计算", () => {
  const s = setup();
  const rsBody = {
    projectCode: "A-TECH",
    requiredQuestions: ["destination", "degree", "age"],
    dimensions: [
      { code: "edu", label: "学历", all: [{ questionCode: "degree", op: "eq" as const, value: "bachelor" }], evidenceVerificationIds: [] }
    ]
  };
  expectError(() => s.rules.createDraft("A-TECH", rsBody, "e1"), "42270");

  const { fact } = publishProject(s);
  const d0 = rsBody.dimensions[0]!;
  const draft = s.rules.createDraft("A-TECH", { ...rsBody, dimensions: [{ ...d0, evidenceVerificationIds: [fact.id] }] }, "e1");
  s.rules.submit(draft.id, "e1");
  // 无证据版本反例
  const noEv = s.rules.createDraft("A-TECH", { ...rsBody, dimensions: [{ ...d0, evidenceVerificationIds: [] }] }, "e9");
  s.rules.submit(noEv.id, "e9");
  expectError(() => s.rules.review(noEv.id, "approve", "r2"), "RULE_EVIDENCE_REQUIRED");
  // 核验人=编辑人拒绝
  expectError(() => s.rules.review(draft.id, "approve", "e1"), "REVIEWER_IS_AUTHOR");
  s.rules.review(draft.id, "approve", "r2");

  // 发布问卷（计算需要）
  const q = s.tpl.createDraft("questionnaire", "Q1", "问卷", questionnaire, "e1");
  s.tpl.submit(q.id, "e1");
  s.tpl.review(q.id, "approve", "r2");

  const ok = s.rules.evaluate("A-TECH", { destination: "A", degree: "bachelor", age: 30 }, "q-v1");
  assert.equal(ok.outcome, "eligible");
  const gap = s.rules.evaluate("A-TECH", { destination: "A", degree: "below", age: 30 }, "q-v1");
  assert.equal(gap.outcome, "gap");
  const nc = s.rules.evaluate("A-TECH", { destination: "A" }, "q-v1");
  assert.equal(nc.outcome, "not_committed");
  // 幂等：相同输入相同输出
  assert.deepEqual(s.rules.evaluate("A-TECH", { destination: "A", degree: "bachelor", age: 30 }, "q-v1"), ok);
  // 无规则集项目
  expectError(() => s.rules.evaluate("NOPE", {}, "q-v1"), "40470");
});

test("核验证据失效后规则集仍可标记，项目侧对客已隐藏（联动由 catalog 门保证）", () => {
  const s = setup();
  const { fact } = publishProject(s);
  const dim = {
    code: "d",
    label: "目的地",
    all: [{ questionCode: "destination", op: "answered" as const }],
    evidenceVerificationIds: [fact.id]
  };
  const draft = s.rules.createDraft(
    "A-TECH",
    { projectCode: "A-TECH", requiredQuestions: ["destination"], dimensions: [dim] },
    "e1"
  );
  s.rules.submit(draft.id, "e1");
  s.vr.invalidate(fact.id, "页面失效");
  expectError(() => s.rules.review(draft.id, "approve", "r2"), "KEY_FACTS_UNVERIFIED");
});
