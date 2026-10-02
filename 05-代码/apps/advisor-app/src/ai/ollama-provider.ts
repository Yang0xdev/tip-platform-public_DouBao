/**
 * Ollama 本机 Provider（顾问端 L 模式）：探测 + OpenAI 兼容流式。
 */
import { ENVELOPE_PREAMBLE, PROMPT_VERSION } from "./prompts";
import type { AdvisorContextEnvelope, ChatChunk } from "./types";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_BASE = "http://localhost:11434";
const MODEL_PREFIXES = ["qwen3", "qwen2.5"];

export class OllamaLocalProvider {
  readonly mode = "L" as const;
  private model: string | null = null;

  private get base(): string {
    return process.env.EXPO_PUBLIC_AI_BASE?.replace(/\/v1\/?$/, "") ?? DEFAULT_BASE;
  }

  async detect(): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${this.base}/api/tags`, { signal: ctrl.signal });
      if (!res.ok) return false;
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const configured = process.env.EXPO_PUBLIC_AI_MODEL;
      const candidates = [
        ...(configured ? [configured] : []),
        ...(data.models ?? []).map((m) => m.name)
      ];
      const picked = candidates.find((n) => MODEL_PREFIXES.some((p) => n.startsWith(p)));
      this.model = picked ?? (data.models ?? [])[0]?.name ?? null;
      return !!this.model;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  getModel(): string | null {
    return this.model;
  }

  async *chat(opts: {
    system: string;
    envelope: AdvisorContextEnvelope;
    question: string;
    signal?: AbortSignal;
  }): AsyncIterable<ChatChunk> {
    const payload = {
      model: this.model ?? "qwen3:7b",
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      messages: [
        { role: "system", content: `${opts.system}\n（prompt 版本：${PROMPT_VERSION}）` },
        {
          role: "user",
          content: `${ENVELOPE_PREAMBLE}\n${JSON.stringify({
            anchor: opts.envelope.anchor,
            fragments: opts.envelope.fragments,
            knowledge: opts.envelope.knowledge,
            disallowed: opts.envelope.disallowed
          })}\n\n任务：${opts.question}`
        }
      ]
    };

    const res = await fetch(`${this.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: opts.signal
    });
    if (!res.ok || !res.body) throw new Error(`本地模型请求失败（${res.status}）`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          yield { kind: "done" };
          return;
        }
        try {
          const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const text = json.choices?.[0]?.delta?.content ?? "";
          if (text) yield { kind: "delta", text };
        } catch {
          // 心跳/半行
        }
      }
    }
    yield { kind: "done" };
  }
}
