/**
 * 禁表述词库引擎（PRD-M1 M1-06、红线①/⑭、AT23）
 * 四个生产点统一校验：assessment 初评 / proposal 方案 / pitch 讲解(iPad) / asset 分享素材
 * - block：强拦截，不允许提交/发布/确认；
 * - warn：需人工署名或转人工审核；
 * - 词库版本化，命中结果带版本号，随快照留痕。
 * 词表初始集来自 V2/GP3，运营在 A12 后台维护；本文件只提供引擎与内置基线。
 */

export type ProductionPoint = "assessment" | "proposal" | "pitch" | "asset";

export type WordLevel = "block" | "warn";

export interface WordRule {
  id: string;
  level: WordLevel;
  /** 匹配方式：literal 包含 / regex 正则 */
  mode: "literal" | "regex";
  pattern: string;
  /** 适用生产点；空数组=全部 */
  points: ProductionPoint[];
  reason: string;
}

export interface Violation {
  ruleId: string;
  level: WordLevel;
  point: ProductionPoint;
  matched: string;
  reason: string;
}

export interface CheckResult {
  ok: boolean;
  blocked: Violation[];
  warnings: Violation[];
  wordVersion: string;
}

/** 内置基线词表（初始参数，A12 可扩；不承诺成功率类） */
export const BASELINE_WORDS: WordRule[] = [
  { id: "B001", level: "block", mode: "literal", pattern: "包过", points: [], reason: "不得承诺办理结果" },
  { id: "B002", level: "block", mode: "literal", pattern: "不成功全额退款", points: [], reason: "不得承诺不成功全退" },
  { id: "B003", level: "block", mode: "literal", pattern: "不成功全退", points: [], reason: "不得承诺不成功全退" },
  { id: "B004", level: "block", mode: "literal", pattern: "100%成功", points: [], reason: "不得宣称成功率" },
  { id: "B005", level: "block", mode: "literal", pattern: "成功率", points: ["proposal", "asset", "pitch"], reason: "不得宣称成功率/获批率" },
  { id: "B006", level: "block", mode: "literal", pattern: "获批率", points: ["proposal", "asset", "pitch"], reason: "不得宣称成功率/获批率" },
  { id: "B007", level: "block", mode: "literal", pattern: "内部渠道", points: [], reason: "不得宣称内部渠道" },
  { id: "B008", level: "block", mode: "literal", pattern: "特殊关系", points: [], reason: "不得宣称特殊关系" },
  { id: "B009", level: "block", mode: "regex", pattern: "(保证|担保).{0,6}(获批|批准|通过|下签|拿到身份)", points: [], reason: "不得保证官方结果" },
  { id: "B010", level: "block", mode: "literal", pattern: "官方有人", points: [], reason: "不得暗示官方关系" },
  { id: "B011", level: "block", mode: "literal", pattern: "私转", points: ["proposal", "pitch", "asset"], reason: "不得引导平台外收款" },
  { id: "B012", level: "block", mode: "literal", pattern: "转我个人账户", points: ["proposal", "pitch", "asset"], reason: "不得引导个人账户收款" },
  { id: "W001", level: "warn", mode: "literal", pattern: "最快", points: [], reason: "绝对化时限需人工署名审核" },
  { id: "W002", level: "warn", mode: "literal", pattern: "一定", points: ["proposal", "pitch"], reason: "绝对化表述需人工署名审核" },
  { id: "W003", level: "warn", mode: "literal", pattern: "最优惠", points: ["proposal", "asset"], reason: "绝对化价格表述需审核" }
];

export class WordEngine {
  private readonly rules: WordRule[];
  constructor(
    public readonly version: string,
    rules: WordRule[] = BASELINE_WORDS
  ) {
    this.rules = rules;
  }

  check(text: string, point: ProductionPoint): CheckResult {
    const blocked: Violation[] = [];
    const warnings: Violation[] = [];
    for (const rule of this.rules) {
      if (rule.points.length > 0 && !rule.points.includes(point)) continue;
      const matched = match(rule, text);
      if (matched) {
        const v: Violation = { ruleId: rule.id, level: rule.level, point, matched, reason: rule.reason };
        (rule.level === "block" ? blocked : warnings).push(v);
      }
    }
    return { ok: blocked.length === 0, blocked, warnings, wordVersion: this.version };
  }

  /** 批量生产点校验（如发布动作同时校验标题+正文+素材备注） */
  checkAll(parts: { text: string; point: ProductionPoint }[]): CheckResult {
    const merged: CheckResult = { ok: true, blocked: [], warnings: [], wordVersion: this.version };
    for (const p of parts) {
      const r = this.check(p.text, p.point);
      merged.ok = merged.ok && r.ok;
      merged.blocked.push(...r.blocked);
      merged.warnings.push(...r.warnings);
    }
    return merged;
  }
}

function match(rule: WordRule, text: string): string | null {
  if (rule.mode === "literal") return text.includes(rule.pattern) ? rule.pattern : null;
  const re = new RegExp(rule.pattern, "u");
  const m = text.match(re);
  return m ? m[0] : null;
}
