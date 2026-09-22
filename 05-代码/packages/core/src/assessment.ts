/**
 * 初步评估规则引擎（PRD-M1 M1-08、红线①）
 * 输出只有四类：eligible 符合 / gap 差距 / unconfirmed 待确认 / not_committed 未承诺
 * 不输出分数、概率、成功率；结论必须可追溯到规则版本与问卷版本。
 */

export type AssessmentOutcome = "eligible" | "gap" | "unconfirmed" | "not_committed";

export type ConditionOperator = "eq" | "neq" | "in" | "gte" | "lte" | "answered";

export interface RuleCondition {
  /** 问卷题目 code */
  questionCode: string;
  op: ConditionOperator;
  value?: string | number | (string | number)[];
}

export interface DimensionRule {
  code: string;
  label: string;
  /** 全部满足才算符合 */
  all?: RuleCondition[];
  /** 任一满足即判差距（硬门槛不满足） */
  anyGap?: RuleCondition[];
}

export interface AssessmentRuleSet {
  version: string;
  projectCode: string;
  /** 进入评估前必须回答的关键题；缺失则 not_committed */
  requiredQuestions: string[];
  dimensions: DimensionRule[];
}

export type AnswerValue = string | number | undefined;
export type Answers = Record<string, AnswerValue>;

export interface DimensionResult {
  code: string;
  label: string;
  status: "met" | "gap" | "unconfirmed";
  reasons: string[];
}

export interface AssessmentResult {
  outcome: AssessmentOutcome;
  ruleVersion: string;
  questionnaireVersion: string;
  dimensions: DimensionResult[];
  /** 不构成承诺的固定声明（对客展示） */
  disclaimer: "本结果仅为条件匹配，不代表获批承诺";
}

function evalCondition(c: RuleCondition, answers: Answers): boolean {
  const v = answers[c.questionCode];
  switch (c.op) {
    case "answered":
      return v !== undefined && String(v).trim() !== "";
    case "eq":
      return v === c.value;
    case "neq":
      return v !== c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(v as string | number);
    case "gte":
      return typeof v === "number" && typeof c.value === "number" && v >= c.value;
    case "lte":
      return typeof v === "number" && typeof c.value === "number" && v <= c.value;
  }
}

export function evaluate(
  ruleSet: AssessmentRuleSet,
  answers: Answers,
  questionnaireVersion: string
): AssessmentResult {
  // 关键题缺失 → 未承诺（信息不足以给出任何结论）
  const missing = ruleSet.requiredQuestions.filter(
    (q) => answers[q] === undefined || String(answers[q] ?? "").trim() === ""
  );
  const dimensions: DimensionResult[] = ruleSet.dimensions.map((d) => {
    const reasons: string[] = [];
    // 硬门槛差距
    if (d.anyGap?.some((c) => evalCondition(c, answers))) {
      return { code: d.code, label: d.label, status: "gap", reasons: [`${d.label}存在明确不满足项`] };
    }
    const all = d.all ?? [];
    const unconfirmed = all.filter((c) => c.op === "answered" ? !evalCondition(c, answers) : answers[c.questionCode] === undefined);
    if (unconfirmed.length > 0) {
      return { code: d.code, label: d.label, status: "unconfirmed", reasons: [`${d.label}有待确认信息`] };
    }
    if (all.some((c) => !evalCondition(c, answers))) {
      return { code: d.code, label: d.label, status: "gap", reasons: [`${d.label}条件不完全满足`] };
    }
    return { code: d.code, label: d.label, status: "met", reasons: [] };
  });

  let outcome: AssessmentOutcome;
  if (missing.length > 0) {
    outcome = "not_committed";
  } else if (dimensions.some((d) => d.status === "gap")) {
    outcome = "gap";
  } else if (dimensions.some((d) => d.status === "unconfirmed")) {
    outcome = "unconfirmed";
  } else {
    outcome = "eligible";
  }

  return {
    outcome,
    ruleVersion: ruleSet.version,
    questionnaireVersion,
    dimensions,
    disclaimer: "本结果仅为条件匹配，不代表获批承诺"
  };
}

export const OUTCOME_LABEL: Record<AssessmentOutcome, string> = {
  eligible: "符合",
  gap: "差距",
  unconfirmed: "待确认",
  not_committed: "未承诺"
};
