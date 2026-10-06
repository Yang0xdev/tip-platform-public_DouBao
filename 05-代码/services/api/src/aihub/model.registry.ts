/* AI 中枢：模型注册表 + Ollama 健康探测（V4 P0） */

import { Injectable } from "@nestjs/common";
import type { ModelRecord, ModelStatusView } from "./model.types.js";

/** 默认模型矩阵（与 V4 技术方案一致；标签以实际部署为准，可按需增删） */
export const DEFAULT_MODEL_CATALOG: ModelRecord[] = [
  {
    tag: "qwen2.5:3b",
    tier: "fast",
    capabilities: ["classify", "extract", "chat"],
    contextWindow: 32768,
    provider: "ollama",
    preferred: true,
    note: "分类分诊、简单抽取、快速改写"
  },
  {
    tag: "qwen2.5:7b",
    tier: "standard",
    capabilities: ["extract", "draft", "reason", "chat", "classify"],
    contextWindow: 32768,
    provider: "ollama",
    preferred: true,
    note: "结构化抽取、访谈、比较、导读、初稿（日常主力）"
  },
  {
    tag: "qwen2.5:14b",
    tier: "large",
    capabilities: ["reason", "draft", "extract", "chat"],
    contextWindow: 32768,
    provider: "ollama",
    preferred: true,
    note: "多步推理、复杂合并、疑难文书（建议 32GB+ 内存）"
  },
  {
    tag: "qwen2.5vl:7b",
    tier: "vision",
    capabilities: ["vision"],
    contextWindow: 32768,
    provider: "ollama",
    preferred: true,
    note: "扫描件、表格、印章、手写、材料拍照自检"
  },
  {
    tag: "bge-m3",
    tier: "embed",
    capabilities: ["embed"],
    provider: "ollama",
    preferred: true,
    note: "多语种本地向量化与检索"
  }
];

interface OllamaTag {
  name: string;
  size?: number;
  digest?: string;
  quantization?: string;
}

interface OllamaPsModel {
  name: string;
}

@Injectable()
export class ModelRegistry {
  private catalog: ModelRecord[] = DEFAULT_MODEL_CATALOG.map((m) => ({ ...m }));
  private statuses: ModelStatusView[] = [];
  private probedAt: string | null = null;
  private lastError: string | null = null;

  /** Ollama 地址：默认本机；可由 OLLAMA_BASE_URL 覆盖（局域网/远程工作站） */
  private get baseUrl(): string {
    return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  }

  getCatalog(): ModelRecord[] {
    return this.catalog.map((m) => ({ ...m }));
  }

  getStatuses(): ModelStatusView[] {
    return this.statuses.map((s) => ({ ...s }));
  }

  getLastProbeInfo() {
    return { baseUrl: this.baseUrl, probedAt: this.probedAt, error: this.lastError };
  }

  /** 按 tier 返回目录中的首选标签（供路由使用） */
  tagsByTier(tier: ModelRecord["tier"]): string[] {
    return this.catalog.filter((m) => m.tier === tier).map((m) => m.tag);
  }

  /**
   * 探测目标 Ollama：/api/tags（已安装）+ /api/ps（常驻）。
   * 不可达时所有模型 available=false（不伪装）。
   */
  async probe(fetchImpl: typeof fetch = fetch): Promise<ModelStatusView[]> {
    const now = new Date().toISOString();
    let installed: OllamaTag[] = [];
    let loadedNames = new Set<string>();
    try {
      const [tagsRes, psRes] = await Promise.all([
        fetchImpl(`${this.baseUrl}/api/tags`),
        fetchImpl(`${this.baseUrl}/api/ps`)
      ]);
      if (!tagsRes.ok) throw new Error(`tags http ${tagsRes.status}`);
      const tagsJson = (await tagsRes.json()) as { models?: OllamaTag[] };
      installed = tagsJson.models ?? [];
      if (psRes.ok) {
        const psJson = (await psRes.json()) as { models?: OllamaPsModel[] };
        loadedNames = new Set((psJson.models ?? []).map((m) => m.name));
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
    }
    this.probedAt = now;

    const installedMap = new Map<string, OllamaTag>();
    for (const t of installed) installedMap.set(t.name, t);

    this.statuses = this.catalog.map((m) => {
      // 精确匹配；兼容同 base 名（如 qwen2.5:7b 与 qwen2.5:7b-instruct）
      const hit =
        installedMap.get(m.tag) ??
        [...installedMap.values()].find((t) => t.name.startsWith(m.tag + "-"));
      return {
        ...m,
        available: Boolean(hit),
        loaded: hit ? loadedNames.has(hit.name) : false,
        sizeBytes: hit?.size,
        quantization: hit?.quantization,
        probedAt: now,
        error: hit ? undefined : this.lastError ?? undefined
      };
    });
    return this.getStatuses();
  }
}
