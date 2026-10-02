/**
 * 顾问端生成后校验：WordEngine + 红线 + 数字接地（同 U1 机制）。
 */
import { WordEngine } from "@tip/core";
import type { AdvisorContextEnvelope } from "./types";

const wordEngine = new WordEngine("v1");

const HARD_PATTERNS = [
  /成功率/,
  /获批率/,
  /包过|包成功|保证(获批|成功|通过)|肯定(能|可以)/,
  /承诺(时限|成功|通过)/
];

export interface ValidationResult {
  ok: boolean;
  text: string;
  reasons: string[];
}

export function validateAnswer(text: string, envelope: AdvisorContextEnvelope): ValidationResult {
  const reasons: string[] = [];

  const word = wordEngine.check(text, "proposal");
  if (word.blocked.length > 0) {
    reasons.push(`词库拦截：${word.blocked.map((b) => b.matched).join("、")}`);
  }
  for (const re of HARD_PATTERNS) {
    const m = text.match(re);
    if (m) reasons.push(`红线措辞：${m[0]}`);
  }

  const ground = groundingText(envelope);
  const sentences = text
    .split(/\n|(?<=[。！？；])/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("```"));

  const kept: string[] = [];
  for (const s of sentences) {
    const claims = s.match(/\d[\d,\.]*\s*(万|元|%|个月|天|岁)?/g);
    if (!claims) {
      kept.push(s);
      continue;
    }
    let allGrounded = true;
    for (const c of claims) {
      const num = c.match(/\d+(\.\d+)?/)?.[0];
      if (!num) continue;
      const variants = [num, String(Number(num) * 10000), String(Number(num) / 10000)];
      if (!variants.some((v) => ground.includes(v))) allGrounded = false;
    }
    if (allGrounded) kept.push(s);
    else reasons.push(`无依据句子已剔除：${s.slice(0, 36)}`);
  }

  const cleaned = kept.join("\n");
  const hardFail = reasons.some((r) => r.startsWith("词库拦截") || r.startsWith("红线措辞"));
  return { ok: !hardFail && cleaned.trim().length >= 6, text: cleaned, reasons };
}

function groundingText(envelope: AdvisorContextEnvelope): string {
  const parts: string[] = [];
  for (const f of envelope.fragments) {
    if (typeof f.amountMinor === "string") {
      parts.push(f.amountMinor);
      const currency = typeof f.currency === "string" ? f.currency : "";
      const major = Number(f.amountMinor) / Math.pow(10, currency === "JPY" ? 0 : 2);
      parts.push(String(major));
    }
    for (const v of Object.values(f)) {
      if (typeof v === "string" || typeof v === "number") parts.push(String(v));
    }
  }
  for (const k of envelope.knowledge) parts.push(k.excerpt);
  return parts.join("\n").replace(/[\s,，]/g, "");
}
