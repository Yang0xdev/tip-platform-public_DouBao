/**
 * 顾问端 AiOrchestrator（U2）：
 * 探测 → 分类 → 顾问上下文 → L 流式生成+草稿解析+校验 → 失败降级 D。
 */
import { api } from "../api";
import { OllamaLocalProvider } from "./ollama-provider";
import { SYSTEM_PROMPT } from "./prompts";
import type { AdvisorAiResult, AiMode, Draft } from "./types";
import { validateAnswer } from "./validator";

export type { AdvisorAiResult, AiMode, Draft } from "./types";

interface AskOptions {
  customerRef?: string;
  onDelta?: (full: string) => void;
  signal?: AbortSignal;
}

function classifyKind(message: string): string {
  const q = message;
  if (/晨间|今天|今日|简报|overview/i.test(q)) return "morning";
  if (/会前|会面|准备/.test(q)) return "premeet";
  if (/管线|机会|漏斗|pipeline/i.test(q)) return "pipeline";
  if (/综合|组合|诉求/.test(q)) return "compsolution";
  if (/会后|收口|记录|跟进|任务|提醒|发消息|电话/.test(q)) return "postmeeting";
  if (/进展|进度|动态/.test(q)) return "progress";
  if (/查|资料|政策|费表|搜索/.test(q)) return "lookup";
  return "general";
}

export class AdvisorAiOrchestrator {
  private provider = new OllamaLocalProvider();
  private mode: AiMode = "D";
  private model: string | null = null;

  async probe(): Promise<{ mode: AiMode; model: string | null }> {
    const ok = await this.provider.detect().catch(() => false);
    this.mode = ok ? "L" : "D";
    this.model = ok ? this.provider.getModel() : null;
    return { mode: this.mode, model: this.model };
  }

  get currentMode(): AiMode {
    return this.mode;
  }

  async ask(message: string, opts: AskOptions = {}): Promise<AdvisorAiResult> {
    const q = message.trim();
    const kind = classifyKind(q);

    if (this.mode !== "L") {
      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text,
        sources: d.sources ?? [],
        next: d.next,
        drafts: [],
        grounded: true
      };
    }

    let envelope;
    try {
      envelope = await api.aiContext(kind, opts.customerRef);
    } catch {
      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text,
        sources: d.sources ?? [],
        next: d.next,
        drafts: [],
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
          // 流式阶段先隐藏草稿块
          opts.onDelta?.(stripDrafts(acc).visible);
        }
      }

      const { visible, draftsRaw } = stripDrafts(acc);
      const v = validateAnswer(visible, envelope);
      const drafts = parseDrafts(draftsRaw);

      if (v.ok) {
        return {
          mode: "L",
          model: this.model ?? undefined,
          text: v.text,
          sources: extractSources(envelope),
          next: "由本地模型基于已核验记录生成；草稿确认后才入库。",
          drafts,
          grounded: true
        };
      }

      const d = await api.aiAsk(q);
      return {
        mode: "D",
        text: d.text || v.text,
        sources: d.sources ?? [],
        next: d.next ?? "本地生成未通过接地校验，已切换基础模式。",
        drafts: [],
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
        drafts: [],
        grounded: true
      };
    }
  }
}

/* ---------------- 草稿解析 ---------------- */

function stripDrafts(text: string): { visible: string; draftsRaw: string | null } {
  const m = text.match(/```drafts\s*([\s\S]*?)```/);
  if (!m) {
    // 模型可能正在输出未闭合草稿块
    const open = text.indexOf("```drafts");
    return { visible: open >= 0 ? text.slice(0, open) : text, draftsRaw: null };
  }
  return {
    visible: text.replace(m[0], "").trim(),
    draftsRaw: (m[1] ?? "").trim()
  };
}

function parseDrafts(raw: string | null): Draft[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as Draft[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((d) => d && ["follow", "task", "message"].includes(d.kind));
  } catch {
    return [];
  }
}

function extractSources(envelope: {
  fragments: Array<Record<string, unknown>>;
  knowledge: Array<{ id: string; title: string }>;
}): AdvisorAiResult["sources"] {
  const out: AdvisorAiResult["sources"] = [];
  for (const f of envelope.fragments) {
    if (f.type === "timeline") {
      out.push({ level: String(f.level ?? "co"), title: String(f.title ?? "已核验记录"), ref: String(f.ref ?? "") });
    }
  }
  for (const k of envelope.knowledge.slice(0, 4)) {
    out.push({ level: "co", title: k.title, ref: k.id });
  }
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${s.ref}|${s.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
