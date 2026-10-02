/**
 * 生成后校验（OutputValidator）：
 *  1. WordEngine 词库扫描（与对客生产点同一规则）；
 *  2. 接地检查：回答中的关键数字/阶段/金额必须在上下文包中可匹配；
 *  3. 红线格式：百分比进度、成功率、承诺措辞。
 * 不通过：剔除无依据句子；无法剔除则整条判失败（由 Orchestrator 降级 D）。
 */
import { WordEngine } from "@tip/core";
import type { ContextEnvelope } from "./types";

const wordEngine = new WordEngine("v1");

const HARD_PATTERNS = [
  /成功率/,
  /获批率/,
  /\d{1,3}%(?!.*[Aa]postille)/,
  /包过|包成功|保证(获批|成功|通过)|肯定(能|可以)/,
  /承诺(时限|成功|通过)/
];

export interface ValidationResult {
  ok: boolean;
  text: string;
  reasons: string[];
}

export function validateAnswer(
  text: string,
  envelope: ContextEnvelope
): ValidationResult {
  const reasons: string[] = [];

  // 1. 词库
  const word = wordEngine.check(text, "proposal");
  if (word.blocked.length > 0) {
    reasons.push(`词库拦截：${word.blocked.map((b) => b.matched).join("、")}`);
  }

  // 2. 硬红线（承诺/成功率/百分比）
  for (const re of HARD_PATTERNS) {
    const m = text.match(re);
    if (m) reasons.push(`红线措辞：${m[0]}`);
  }

  // 3. 接地：逐句核对数字类陈述
  const ground = groundingText(envelope);
  const sentences = text
    .split(/\n|(?<=[。！？；])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept: string[] = [];
  for (const s of sentences) {
    const claims = s.match(/\d[\d,\.]*\s*(万|元|%|个月|天|岁)?/g);
    if (!claims || claims.length === 0) {
      kept.push(s);
      continue;
    }
    let allGrounded = true;
    for (const c of claims) {
      const norm = c.replace(/[\s,，]/g, "");
      if (!norm) continue;
      const num = norm.match(/\d+(\.\d+)?/)?.[0];
      if (!num) continue;
      // 金额/数量数字必须在接地文本中出现（归一化：去前导无关）
      const variants = [num, String(Number(num) * 10000), String(Number(num) / 10000)];
      if (!variants.some((v) => ground.includes(v))) {
        allGrounded = false;
      }
    }
    if (allGrounded) kept.push(s);
    else reasons.push(`无依据句子已剔除：${s.slice(0, 40)}`);
  }

  const cleaned = kept.join("\n");
  // 关键结论被剔空，或命中红线/词库 → 整条失败
  const hardFail = reasons.some((r) => r.startsWith("词库拦截") || r.startsWith("红线措辞"));
  const ok = !hardFail && cleaned.trim().length > 0 && /[。.！？]?$/.test(cleaned) && cleaned.length >= 6;

  return { ok, text: cleaned, reasons };
}

/** 把上下文包压成可匹配的接地文本（金额转主单位同时保留 minor） */
function groundingText(envelope: ContextEnvelope): string {
  const parts: string[] = [];
  for (const f of envelope.fragments) {
    if (typeof f.amountMinor === "string") {
      parts.push(f.amountMinor);
      const currency = typeof f.currency === "string" ? f.currency : "";
      const decimals = currency === "JPY" ? 0 : 2;
      const major = Number(f.amountMinor) / Math.pow(10, decimals);
      parts.push(String(major));
      if (major >= 1) parts.push(String(major * 10000));
    }
    for (const v of Object.values(f)) {
      if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    }
  }
  for (const k of envelope.knowledge) parts.push(k.excerpt);
  return parts.join("\n").replace(/[\s,，]/g, "");
}
