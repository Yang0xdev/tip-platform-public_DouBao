/* AI 数据工厂：两阶段抽取引擎（V4 P1）
 * 阶段1：字段存在性（found/absent/uncertain）
 * 阶段2：仅对 found 字段取值；值必须来自证据块（页码+原文片段）。
 * 无证据 → 空值；不调用模型也可全量运行（确定性）。
 */

import { Injectable } from "@nestjs/common";
import type { ExtractionField, LayoutBlock } from "./refinery.types.js";
import { GENERIC_FIELDS, IMMIGRATION_EXTRACTION, type FieldSchema } from "./extraction.schemas.js";

@Injectable()
export class ExtractionEngine {
  private schemaFor(docType: string): FieldSchema[] {
    const hit = IMMIGRATION_EXTRACTION.find((s) => s.docType === docType);
    return [...(hit?.fields ?? []), ...GENERIC_FIELDS];
  }

  extract(docType: string, blocks: LayoutBlock[]): ExtractionField[] {
    const schemas = this.schemaFor(docType);
    const out: ExtractionField[] = [];
    for (const schema of schemas) {
      // 阶段 1：存在性
      const presenceHits = blocks.filter((b) => schema.presence.test(b.text));
      if (presenceHits.length === 0) {
        out.push({ key: schema.key, label: schema.label, kind: schema.kind, value: null, state: "absent", conf: 0.9, evidence: null });
        continue;
      }

      if (schema.kind === "list") {
        const items: string[] = [];
        const evidenceBlock = presenceHits[0]!;
        for (const b of blocks) {
          const m = schema.item ? schema.item.exec(b.text) : null;
          if (m && m[1]) items.push(m[1].trim());
        }
        const state = items.length > 0 ? "found" : "uncertain";
        out.push({
          key: schema.key, label: schema.label, kind: "list",
          value: items.length ? items.join("；") : null,
          state,
          conf: items.length ? 0.82 : 0.4,
          evidence: { blockId: evidenceBlock.id, page: evidenceBlock.page, snippet: evidenceBlock.text.slice(0, 120) }
        });
        continue;
      }

      // 阶段 2：取值（在存在性命中块及其相邻块中尝试）
      let value: string | null = null;
      let evidenceBlock: LayoutBlock | null = null;
      if (schema.value) {
        for (const b of presenceHits) {
          const m = schema.value.exec(b.text);
          if (m) {
            const captured = this.composeValue(schema, m);
            if (captured) { value = captured; evidenceBlock = b; break; }
          }
        }
      }
      out.push({
        key: schema.key, label: schema.label, kind: schema.kind, value,
        state: value ? "found" : "uncertain",
        conf: value ? 0.86 : 0.45,
        evidence: evidenceBlock
          ? { blockId: evidenceBlock.id, page: evidenceBlock.page, snippet: evidenceBlock.text.slice(0, 120) }
          : { blockId: presenceHits[0]!.id, page: presenceHits[0]!.page, snippet: presenceHits[0]!.text.slice(0, 120) }
      });
    }
    return out;
  }

  private composeValue(schema: FieldSchema, m: RegExpExecArray): string | null {
    if (schema.kind === "money") {
      // 捕获组：币种可能在 [1]，金额在其后；适配 schemas 中 (币种)?(金额) 结构
      const groups = m.slice(1).filter(Boolean);
      const amount = groups.find((g) => /[\d,]+/.test(g));
      const cur = groups.find((g) => /^(人民币|美元|欧元|CNY|USD|EUR)$/i.test(g));
      if (!amount) return null;
      return cur ? `${cur} ${amount}` : amount;
    }
    return m[1] ? m[1].trim() : null;
  }
}
