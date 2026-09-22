import { describe, it, expect } from "vitest";
import { evaluate, OUTCOME_LABEL, type AssessmentRuleSet } from "../src/assessment.js";

const ruleSet: AssessmentRuleSet = {
  version: "rules-v1",
  projectCode: "A_TECH",
  requiredQuestions: ["age", "degree", "language"],
  dimensions: [
    {
      code: "age",
      label: "年龄",
      all: [{ questionCode: "age", op: "gte", value: 18 }]
    },
    {
      code: "edu",
      label: "学历",
      all: [{ questionCode: "degree", op: "in", value: ["bachelor", "master"] }]
    },
    {
      code: "lang",
      label: "语言",
      all: [{ questionCode: "language", op: "answered" }]
    }
  ]
};

describe("初评四结果引擎", () => {
  it("全部满足 → 符合", () => {
    const r = evaluate(ruleSet, { age: 30, degree: "master", language: "B2" }, "q-v3");
    expect(r.outcome).toBe("eligible");
    expect(OUTCOME_LABEL[r.outcome]).toBe("符合");
    expect(r.disclaimer).toContain("不代表获批承诺");
  });

  it("硬条件不满足 → 差距", () => {
    const r = evaluate(ruleSet, { age: 17, degree: "master", language: "B2" }, "q-v3");
    expect(r.outcome).toBe("gap");
  });

  it("关键题已答但维度信息待确认 → 待确认", () => {
    const r = evaluate(ruleSet, { age: 30, degree: "master", language: undefined }, "q-v3");
    // language 是 requiredQuestions，缺失会先判 not_committed；改为非关键题缺失场景
    const rs2: AssessmentRuleSet = { ...ruleSet, requiredQuestions: ["age", "degree"] };
    const r2 = evaluate(rs2, { age: 30, degree: "master", language: undefined }, "q-v3");
    expect(r2.outcome).toBe("unconfirmed");
    expect(r.outcome).toBe("not_committed");
  });

  it("关键题缺失 → 未承诺（不输出结论）", () => {
    const r = evaluate(ruleSet, { age: 30 }, "q-v3");
    expect(r.outcome).toBe("not_committed");
  });

  it("结果可追溯规则与问卷版本", () => {
    const r = evaluate(ruleSet, { age: 30, degree: "bachelor", language: "B2" }, "q-v3");
    expect(r.ruleVersion).toBe("rules-v1");
    expect(r.questionnaireVersion).toBe("q-v3");
  });
});
