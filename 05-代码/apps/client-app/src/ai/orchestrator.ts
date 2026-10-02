/**
 * AiOrchestrator（U1 编排层）：
 *  探测模式 → 分类 kind → 取上下文包 → L 模式流式生成+校验 → 失败降级 D。
 * 现有 D 模式端点与页面行为不变。
 */
import { api } from "../api";
import { OllamaLocalProvider } from "./ollama-provider";
import { SYSTEM_PROMPT } from "./prompts";
import type { AiMode, AiResult, ContextEnvelope } from "./types";
import { validateAnswer } from "./validator";

export type { AiMode, AiResult } from "./types";

interface AskOptions {
  onDelta?: (fullText: string) => void;
  signal?: AbortSignal;
}

function classifyKind(message: string): ContextEnvelope["kind"] {
  const q = message;
  if (/对比|比较|vs\.?/i.test(q)) return "compare";
  if (/需求|适合|去哪|目标|预算|规划|想了解/.test(q)) return "interview";
  if (/进度|到哪|阶段|进展/.test(q)) return "progress";
  if (/费用|多少钱|价格|收费|付款/.test(q)) return "fees";
  if (/材料|公证|认证|补件|文件/.test(q)) return "materials";
  if (/合同|条款|同意书|签署/.test(q)) return "contract";
  return "general";
}

export class AiOrchestrator {
  private provider = new OllamaLocalProvider();
  private mode: AiMode = "D";
  private model: string | null = null;

  /** 会话开始时调用；返回当前模式 */
  async probe(): Promise<{ mode: AiMode; model: string | null }> {
    const ok = await this.provider.detect().catch(() => false);
    this.mode = ok ? "L" : "D";
    this.model = ok ? this.provider.getModel() : null;
    return { mode: this.mode, model: this.model };
  }

  get currentMode(): AiMode {
    return this.mode;
  }

  async ask(message: string, opts: AskOptions = {}): Promise<AiResult> {
    const q = message.trim();
    const kind = classifyKind(q);

    // D 模式：直接走现有确定性端点
    if (this.mode !== "L") {
      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text,
        sources: d.sources ?? [],
        next: d.next,
        needConsent: d.needConsent,
        grounded: true
      };
    }

    // L 模式：取 grounded 上下文
    let envelope: ContextEnvelope;
    try {
      envelope = await api.aiContext(kind);
    } catch (e) {
      // 同意门等阻断：回退 D（D 端点会返回 needConsent）
      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text,
        sources: d.sources ?? [],
        next: d.next,
        needConsent: d.needConsent,
        grounded: true
      };
    }

    try {
      let acc = "";
      for await (const chunk of this.provider.chat({
        system: SYSTEM_PROMPT,
        envelope,
        question: q,
        signal: opts.signal
      })) {
        if (chunk.kind === "delta" && chunk.text) {
          acc += chunk.text;
          opts.onDelta?.(acc);
        }
      }

      const v = validateAnswer(acc, envelope);
      if (v.ok) {
        return {
          mode: "L",
          model: this.model ?? undefined,
          text: v.text,
          sources: extractSources(envelope),
          next: "由本地模型基于已核验记录生成；正式结论以人工复核为准。",
          grounded: true
        };
      }

      // 校验失败 → 降级 D
      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text || v.text,
        sources: d.sources ?? [],
        next: d.next ?? "本地生成未通过接地校验，已为你切换基础模式。",
        needConsent: d.needConsent,
        grounded: true
      };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text,
        sources: d.sources ?? [],
        next: d.next ?? "本地模型暂时不可用，已切换基础模式。",
        needConsent: d.needConsent,
        grounded: true
      };
    }
  }
}

function extractSources(envelope: ContextEnvelope): AiResult["sources"] {
  const out: AiResult["sources"] = [];
  for (const f of envelope.fragments) {
    if (f.type === "timeline") {
      out.push({
        level: String(f.level ?? "co"),
        title: String(f.title ?? "已核验记录"),
        ref: String(f.ref ?? "")
      });
    }
  }
  for (const k of envelope.knowledge.slice(0, 4)) {
    out.push({ level: "co", title: k.title, ref: k.id });
  }
  return dedupe(out);
}

function dedupe(srcs: AiResult["sources"]): AiResult["sources"] {
  const seen = new Set<string>();
  const out: AiResult["sources"] = [];
  for (const s of srcs) {
    const key = `${s.ref}|${s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
