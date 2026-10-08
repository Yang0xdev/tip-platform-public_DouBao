/* AI 数据工厂：LLM 混合抽取（V4 P2）
 * 流程：本地 LLM 两阶段抽取（存在性→取值）→ 证据逐字校验并锚定版面块
 *       → 与确定性引擎结果交叉验证；不一致降级 uncertain；LLM 不可用回退确定性。
 */

import { Injectable } from "@nestjs/common";
import type { ExtractionField, LayoutBlock } from "./refinery.types.js";
import { IMMIGRATION_EXTRACTION } from "./extraction.schemas.js";
import { Normalizer } from "./normalizer.service.js";

const MODEL_PREFERENCE = [
  "qwen2.5:7b", "qwen3:7b", "qwen2.5:3b", "qwen3:3b", "qwen2.5:0.5b"
];

interface LlmAnswer {
  fields: Array<{ key: string; state: "found" | "absent" | "uncertain"; value: string; evidence: string }>;
}

@Injectable()
export class LlmExtractor {
  constructor(private readonly normalizer: Normalizer) {}

  /** 探测可用模型（超时短，避免拖慢流水线） */
  private async pickModel(base: string): Promise<string | null> {
    try {
      const ctrl = AbortSignal.timeout(1500);
      const res = await fetch(`${base}/api/tags`, { signal: ctrl });
      if (!res.ok) return null;
      const json = (await res.json()) as { models: Array<{ name: string }> };
      const names = json.models.map((m) => m.name);
      for (const pref of MODEL_PREFERENCE) if (names.includes(pref)) return pref;
      return names.find((n) => /qwen/.test(n)) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * @returns fields 合并后字段；modelUsed 实际模型；llmUnavailable 时为 null
   */
  async extractHybrid(
    docType: string,
    blocks: LayoutBlock[],
    deterministic: ExtractionField[],
    ollamaBase: string
  ): Promise<{ fields: ExtractionField[]; modelUsed: string | null; disagreements: string[] }> {
    const model = await this.pickModel(ollamaBase);
    if (!model) return { fields: deterministic, modelUsed: null, disagreements: [] };

    const schema = IMMIGRATION_EXTRACTION.find((s) => s.docType === docType);
    const fieldDefs = schema?.fields ?? [];
    const fieldList = fieldDefs
      .map((f) => `- key=${f.key} | ${f.label} | 类型=${f.kind}`)
      .join("\n");

    const docText = blocks
      .map((b) => `[${b.id}|p${b.page}] ${b.text}`)
      .join("\n")
      .slice(0, 12000);

    const system =
      "你是资料结构化抽取器。只能依据给定资料逐字段抽取，不得推断、不得使用资料外知识。";
    const user = `字段清单：
${fieldList}

资料：
${docText}

请输出 JSON（不要输出其他内容）：
{"fields":[{"key":"字段key","state":"found|absent|uncertain","value":"取值","evidence":"资料中逐字复制的原文片段"}]
规则：1) evidence 必须逐字来自资料；2) 资料中没有的字段 state=absent；3) 金额保留币种与原文数字；4) 日期保留原文。`;

    let parsed: LlmAnswer | null = null;
    try {
      const res = await fetch(`${ollamaBase}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ],
          format: "json",
          stream: false,
          options: { temperature: 0 }
        })
      });
      if (!res.ok) return { fields: deterministic, modelUsed: null, disagreements: [] };
      const json = (await res.json()) as { message: { content: string } };
      parsed = JSON.parse(json.message.content) as LlmAnswer;
    } catch {
      return { fields: deterministic, modelUsed: null, disagreements: [] };
    }

    // 锚定 LLM 字段证据
    const llmMap = new Map<string, ExtractionField>();
    for (const lf of parsed.fields ?? []) {
      let anchored: ExtractionField["evidence"] = null;
      let value = lf.value?.trim() || null;
      if (lf.state === "found" && value) {
        const hit = this.findEvidenceBlock(blocks, lf.evidence ?? value);
        if (hit) anchored = { blockId: hit.id, page: hit.page, snippet: hit.text.slice(0, 120) };
        // 证据无法逐字锚定 → 不采信取值
        if (!anchored) value = null;
      }
      llmMap.set(lf.key, {
        key: lf.key, label: lf.key,
        value, state: value ? "found" : "uncertain",
        conf: value ? 0.82 : 0.4, evidence: anchored
      });
    }

    // 交叉验证合并（保守：确定性已锚定结果为底线，LLM 只能确认或补缺口，分歧只告警）
    const disagreements: string[] = [];
    const merged = deterministic.map((d) => {
      const l = llmMap.get(d.key);
      if (!l || l.state !== "found") return d;
      if (d.state === "found" && d.value) {
        if (this.valuesAgree(d, l.value!)) {
          return { ...d, conf: Math.min(0.98, Math.max(d.conf, l.conf) + 0.04) };
        }
        // 分歧：保留确定性取值，记录告警（不降级）
        disagreements.push(`${d.label}：确定性「${d.value}」/ LLM「${l.value}」`);
        return d;
      }
      // 确定性未取得、LLM 有锚定取值与证据 → 采信
      if (l.evidence)
        return { ...d, state: "found" as const, value: l.value, evidence: l.evidence, conf: 0.8 };
      return d;
    });

    return { fields: merged, modelUsed: model, disagreements };
  }

  /** 在版面块中查找证据（归一空白后包含匹配；evidence 可被模型截断） */
  private findEvidenceBlock(blocks: LayoutBlock[], evidence: string): LayoutBlock | null {
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();
    const e = norm(evidence).slice(0, 60);
    if (e.length < 4) return null;
    for (const b of blocks) {
      const t = norm(b.text);
      if (t.includes(e)) return b;
    }
    // 反向：块文本前 40 字出现在 evidence 中
    for (const b of blocks) {
      const frag = norm(b.text).slice(0, 40);
      if (frag.length >= 10 && norm(evidence).includes(frag)) return b;
    }
    return null;
  }

  private valuesAgree(d: ExtractionField, otherValue: string): boolean {
    const normV = (v: string, kind?: string) => {
      const r = this.normalizer.normalizeField({ value: v, kind } as ExtractionField);
      return (r?.to ?? v).replace(/\s+/g, " ").trim().toLowerCase();
    };
    return normV(d.value!, d.kind) === normV(otherValue, d.kind);
  }
}
