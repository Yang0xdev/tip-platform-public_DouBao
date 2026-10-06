/* AI 数据工厂：清洗归一（V4 P1，确定性规则，可回滚）
 * - 日期 → ISO（YYYY-MM-DD）
 * - 币种与金额 → 标准三字母币种 + 千分位；处理“万”
 * - 术语别名映射；空白整理
 */

import { Injectable } from "@nestjs/common";
import type { ExtractionField } from "./refinery.types.js";

const CURRENCY_MAP: Record<string, string> = {
  人民币: "CNY", 元: "CNY",
  美元: "USD", 美金: "USD",
  欧元: "EUR"
};

/** 术语别名（可在行业包扩展；仅统一表述，不改变含义） */
const TERM_ALIASES: Array<[RegExp, string]> = [
  [/永居/g, "永久居留"],
  [/入籍/g, "取得公民身份"],
  [/\s+/g, " "]
];

@Injectable()
export class Normalizer {
  normalizeField(field: ExtractionField): { to: string; rule: string } | null {
    if (!field.value) return null;
    const v = field.value;

    if (field.kind === "date" || /\d{4}\s*[年/.-]\s*\d{1,2}/.test(v)) {
      const iso = this.toIsoDate(v);
      if (iso && iso !== v) return { to: iso, rule: "date-iso" };
    }

    if (field.kind === "money" || /(人民币|美元|欧元|CNY|USD|EUR)\s*[\d,]|[\d,]+\s*(元|美元|欧元)/.test(v)) {
      const std = this.normalizeMoney(v);
      if (std && std !== v) return { to: std, rule: "money-standard" };
    }

    let t = v.trim();
    for (const [re, rep] of TERM_ALIASES) t = t.replace(re, rep);
    if (t !== v) return { to: t, rule: "term-alias" };
    return null;
  }

  toIsoDate(text: string): string | null {
    const m = /(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/.exec(text);
    if (!m) return null;
    const [, y, mo, d] = m;
    const pad = (x: string) => x.padStart(2, "0");
    return `${y}-${pad(mo!)}-${pad(d!)}`;
  }

  normalizeMoney(text: string): string | null {
    const m = /(人民币|美元|欧元|美金|元|CNY|USD|EUR)?\s*([\d,]+(?:\.\d+)?)\s*(万)?\s*(元|美元|欧元)?/.exec(text);
    if (!m || !m[2]) return null;
    const curRaw = m[1] ?? m[4] ?? "";
    const cur = CURRENCY_MAP[curRaw] ?? (["CNY", "USD", "EUR"].includes(curRaw) ? curRaw : "");
    let num = Number(m[2].replace(/,/g, ""));
    if (m[3] === "万") num *= 10000;
    const amount = num.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return cur ? `${cur} ${amount}` : amount;
  }
}
