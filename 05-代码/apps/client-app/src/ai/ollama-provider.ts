/**
 * Ollama 本机 Provider（L 模式）：
 *  - 探测 GET {base}/api/tags；
 *  - 流式 POST {base}/v1/chat/completions（OpenAI 兼容），解析 NDJSON/SSE；
 *  - 数据只在浏览器与本机 Ollama 间流动。
 */
import { ENVELOPE_PREAMBLE, PROMPT_VERSION } from "./prompts";
import type { ChatChunk, ChatProvider, ChatRequest } from "./types";

declare const process: { env: Record<string, string | undefined> };

const DEFAULT_BASE = "http://localhost:11434";
const MODEL_PREFIXES = ["qwen3", "qwen2.5"];

export class OllamaLocalProvider implements ChatProvider {
  readonly mode = "L" as const;
  private model: string | null = null;

  private get base(): string {
    return process.env.EXPO_PUBLIC_AI_BASE?.replace(/\/v1\/?$/, "") ?? DEFAULT_BASE;
  }

  async detect(): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const res = await fetch(`${this.base}/api/tags`, {
        signal: ctrl.signal
      });
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

  async *chat(req: ChatRequest): AsyncIterable<ChatChunk> {
    const payload = {
      model: req.model ?? this.model ?? "qwen3:7b",
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      messages: [
        { role: "system", content: `${req.system}\n（prompt 版本：${PROMPT_VERSION}）` },
        {
          role: "user",
          content: `${ENVELOPE_PREAMBLE}\n${JSON.stringify(
            {
              fragments: req.envelope.fragments,
              knowledge: req.envelope.knowledge,
              disallowed: req.envelope.disallowed
            }
          )}\n\n问题：${req.question}`
        }
      ]
    };

    const res = await fetch(`${this.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: req.signal
    });
    if (!res.ok || !res.body) {
      throw new Error(`本地模型请求失败（${res.status}）`);
    }

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
        if (!line || !line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          yield { kind: "done" };
          return;
        }
        try {
          const json = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = json.choices?.[0]?.delta?.content ?? "";
          if (text) yield { kind: "delta", text };
        } catch {
          // 忽略半行/心跳
        }
      }
    }
    yield { kind: "done" };
  }
}
