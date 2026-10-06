/* AI 数据工厂：主编排服务（V4 P1）
 * 七工段：ingest → classify → parse → extract → normalize → validate(lint+四眼) → publish
 * 全部确定性可运行；LLM 为可选增强（P2+ 经 AI 中枢接入）。
 */

import { HttpException, Injectable } from "@nestjs/common";
import { WordEngine } from "@tip/core";
import type {
  CanonicalRecord, DocType, RawSource, RefineryDashboard, RefineryStage, ValidationFinding
} from "./refinery.types.js";
import { LayoutParser } from "./parser.service.js";
import { ExtractionEngine } from "./extractor.service.js";
import { Normalizer } from "./normalizer.service.js";
import { WikiService } from "../wiki/wiki.service.js";
import { AuditService } from "../audit.service.js";
import { SAMPLE_DOCS } from "./sample.docs.js";

class RefineryError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

/* 分诊标记（权重表） */
const CLASSIFY_MARKERS: Array<{ type: DocType; markers: RegExp }> = [
  { type: "fee_schedule", markers: /(费表|服务费|官方费|律师费|费用明细|fee\s*schedule)/i },
  { type: "regulation", markers: /(条例|法规|通知|办法|法案|生效|施行|根据.*规定|regulation|act\b)/i },
  { type: "contract", markers: /(甲方|乙方|合同|协议|contract|agreement)/i },
  { type: "id_document", markers: /(护照|身份证|出生证|证件号码)/ },
  { type: "report", markers: /(报告|尽职调查|评估报告|report)/i },
  { type: "email", markers: /(发件人|收件人|主题：|from:|subject:)/i },
  { type: "project_doc", markers: /(项目介绍|办理周期|居住要求|申请条件|项目亮点|processing\s*time|residency)/i }
];

const REQUIRED_KEYS: Record<string, string[]> = {
  regulation: ["program_name"],
  project_doc: ["program_name"],
  contract: ["party_a", "party_b"]
};

const WIKI_KIND_MAP: Record<string, "regulation" | "document" | "fee" | "education"> = {
  regulation: "regulation",
  fee_schedule: "fee",
  project_doc: "document",
  contract: "document",
  report: "document",
  other: "document"
};

@Injectable()
export class RefineryService {
  private raws = new Map<string, RawSource>();
  private canonical = new Map<string, CanonicalRecord>();
  private rawSeq = 0;
  private canSeq = 0;
  private readonly words = new WordEngine("refinery-v1");

  constructor(
    private readonly audit: AuditService,
    private readonly parser: LayoutParser,
    private readonly extractor: ExtractionEngine,
    private readonly normalizer: Normalizer,
    private readonly wiki: WikiService
  ) {}

  /* ---------------- ① 采集 ---------------- */

  ingestText(
    actorId: string,
    body: {
      title: string; content: string; sourceType?: RawSource["sourceType"];
      format?: "text/plain" | "text/html" | "text/markdown" | "spreadsheet";
      sensitivity?: "normal" | "sensitive"; sample?: boolean;
    }
  ): RawSource {
    if (!body.title?.trim() || !body.content?.trim())
      throw new RefineryError(400, "44401", "标题与正文内容必填");
    const content = body.content;
    const hash = this.sha256(content);
    for (const r of this.raws.values())
      if (r.hash === hash) throw new RefineryError(409, "44402", "相同内容已在 L0 库（去重）");

    this.rawSeq += 1;
    const id = `RAW-${String(this.rawSeq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const raw: RawSource = {
      id,
      sourceType: body.sourceType ?? "manual",
      title: body.title.trim(),
      contentType: body.format ?? "text/plain",
      hash,
      sensitivity: body.sensitivity ?? "normal",
      ingestedAt: now,
      stage: "ingested",
      history: [{ stage: "ingested", at: now, actorId, note: body.sourceType ?? "manual" }],
      sample: body.sample,
      text: content
    };
    this.raws.set(id, raw);
    this.audit.record({ actor: actorId, realm: "staff", action: "refinery.ingest", resource: id, result: "allow" });
    return this.get(id);
  }

  /** PDF（base64）：数字 PDF 直接解析；疑似扫描件标记 needsVision */
  async ingestPdf(
    actorId: string,
    body: { title: string; base64: string; sensitivity?: "normal" | "sensitive"; sample?: boolean }
  ): Promise<RawSource> {
    if (!body.title?.trim() || !body.base64?.trim())
      throw new RefineryError(400, "44401", "标题与文件必填");
    const bytes = Buffer.from(body.base64, "base64");
    const hash = this.sha256(bytes.toString("binary"));
    for (const r of this.raws.values())
      if (r.hash === hash) throw new RefineryError(409, "44402", "相同文件已在 L0 库（去重）");

    const { blocks, tool, needsVision } = await this.parser.parsePdf(bytes);
    this.rawSeq += 1;
    const id = `RAW-${String(this.rawSeq).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const raw: RawSource = {
      id, sourceType: "scan", title: body.title.trim(), contentType: "application/pdf",
      hash, sensitivity: body.sensitivity ?? "normal", ingestedAt: now,
      stage: "parsed", blocks, parseTool: needsVision ? `${tool}（待视觉模型）` : tool,
      history: [
        { stage: "ingested", at: now, actorId, note: "pdf" },
        { stage: "parsed", at: now, actorId, note: tool }
      ],
      sample: body.sample
    };
    this.raws.set(id, raw);
    this.audit.record({ actor: actorId, realm: "staff", action: "refinery.ingest.pdf", resource: id, result: "allow" });
    return this.get(id);
  }

  /* ---------------- ② 分类分诊 ---------------- */

  classify(actorId: string, id: string, override?: DocType): RawSource {
    const raw = this.must(id);
    if (override) {
      raw.docType = override; raw.classifyConf = 1; raw.classifyModel = "manual";
    } else {
      const text = this.fullText(raw);
      const scores = new Map<DocType, number>();
      for (const c of CLASSIFY_MARKERS) {
        const m = text.match(new RegExp(c.markers.source, c.markers.flags));
        if (m) scores.set(c.type, (scores.get(c.type) ?? 0) + m.length);
      }
      let best: DocType = "other"; let bestN = 0;
      for (const [t, n] of scores) if (n > bestN) { best = t; bestN = n; }
      raw.docType = best;
      raw.classifyConf = bestN === 0 ? 0.4 : Math.min(0.96, 0.62 + bestN * 0.12);
      raw.classifyModel = "deterministic";
    }
    this.advance(raw, "classified", actorId, raw.docType);
    return this.get(id);
  }

  /* ---------------- ③ 版面解析 ---------------- */

  parse(actorId: string, id: string): RawSource {
    const raw = this.must(id);
    if (raw.contentType === "application/pdf") {
      if (!raw.blocks) throw new RefineryError(422, "44403", "PDF 未解析");
    } else {
      const content = this.rawContent(raw);
      const { blocks, tool } = this.parser.parseText(content, raw.contentType);
      raw.blocks = blocks; raw.parseTool = tool;
    }
    this.advance(raw, "parsed", actorId, raw.parseTool);
    return this.get(id);
  }

  /* ---------------- ④ 结构化抽取（两阶段） ---------------- */

  extract(actorId: string, id: string): RawSource {
    const raw = this.must(id);
    if (!raw.blocks) throw new RefineryError(422, "44404", "请先完成版面解析");
    raw.fields = this.extractor.extract(raw.docType ?? "other", raw.blocks);
    raw.extractModel = "deterministic-schema";
    this.advance(raw, "extracted", actorId, `${raw.fields.length} 字段`);
    return this.get(id);
  }

  /** 人工修正字段值（证据仍保留；标记 manual） */
  correctField(actorId: string, id: string, key: string, value: string): RawSource {
    const raw = this.must(id);
    const f = raw.fields?.find((x) => x.key === key);
    if (!f) throw new RefineryError(404, "44405", "字段不存在");
    f.value = value; f.state = "found"; f.manual = true; f.conf = 1;
    this.audit.record({ actor: actorId, realm: "staff", action: "refinery.field.correct", resource: `${id}:${key}`, result: "allow" });
    return this.get(id);
  }

  /* ---------------- ⑤ 清洗归一 ---------------- */

  normalize(actorId: string, id: string): RawSource {
    const raw = this.must(id);
    if (!raw.fields) throw new RefineryError(422, "44404", "请先完成抽取");
    raw.normalization = [];
    for (const f of raw.fields) {
      const r = this.normalizer.normalizeField(f);
      if (r) { f.value = r.to; raw.normalization.push({ fieldKey: f.key, from: f.value, to: r.to, rule: r.rule }); }
    }
    this.advance(raw, "normalized", actorId, `${raw.normalization.length} 项归一`);
    return this.get(id);
  }

  /* ---------------- ⑥ 校验（lint + 四眼） ---------------- */

  lint(id: string): { findings: ValidationFinding[] } {
    const raw = this.must(id);
    const findings: ValidationFinding[] = [];
    const fields = raw.fields ?? [];

    for (const key of REQUIRED_KEYS[raw.docType ?? ""] ?? []) {
      const f = fields.find((x) => x.key === key);
      if (!f || f.state !== "found")
        findings.push({ code: "L-REQ", level: "block", message: `必填字段「${f?.label ?? key}」未取得`, fieldKey: key });
    }
    for (const f of fields) {
      if (f.state === "found" && f.kind === "money" && f.value && !/^(CNY|USD|EUR)/.test(f.value))
        findings.push({ code: "L-CUR", level: "warn", message: `字段「${f.label}」缺币种，需人工确认`, fieldKey: f.key });
      if (f.state === "found" && !f.evidence)
        findings.push({ code: "L-EVI", level: "block", message: `字段「${f.label}」无证据锚定`, fieldKey: f.key });
    }
    // 红线措辞（对字段值与标题）
    const parts = [raw.title, ...fields.map((f) => f.value ?? "")];
    for (const p of parts) {
      const r = this.words.check(p, "asset");
      for (const v of r.blocked)
        findings.push({ code: "L-WORD", level: "block", message: `红线措辞：${v.matched}（${v.reason}）` });
    }
    raw.findings = findings;
    return { findings };
  }

  submitForReview(actorId: string, id: string): RawSource {
    const raw = this.must(id);
    const { findings } = this.lint(id);
    if (findings.some((f) => f.level === "block"))
      throw new RefineryError(422, "44406", "Lint 存在阻断项，不能提交复核");
    this.advance(raw, "awaiting_review", actorId, "待四眼");
    return this.get(id);
  }

  review(actorId: string, id: string, decision: "approve" | "reject", reason?: string): RawSource {
    const raw = this.must(id);
    if (raw.stage !== "awaiting_review")
      throw new RefineryError(422, "44407", "仅待复核状态可评审");
    const submitter = [...raw.history].reverse().find((h) => h.stage === "awaiting_review")?.actorId;
    if (submitter && submitter === actorId)
      throw new RefineryError(403, "44408", "四眼原则：复核人不能是提交人本人");
    if (decision === "reject") {
      if (!reason?.trim()) throw new RefineryError(400, "44409", "驳回必须填写原因");
      this.advance(raw, "rejected", actorId, reason);
    } else {
      raw.reviewerId = actorId;
      raw.history.push({ stage: raw.stage, at: new Date().toISOString(), actorId, note: "approved" });
      this.audit.record({ actor: actorId, realm: "staff", action: "refinery.review.approve", resource: id, result: "allow" });
    }
    return this.get(id);
  }

  /* ---------------- ⑦ 发布联动 ---------------- */

  publish(actorId: string, id: string): { raw: RawSource; canonical: CanonicalRecord } {
    const raw = this.must(id);
    if (raw.stage !== "awaiting_review" || !raw.reviewerId)
      throw new RefineryError(422, "44410", "须经四眼批准后才能发布");

    const payload: Record<string, unknown> = {};
    for (const f of raw.fields ?? []) if (f.state === "found") payload[f.key] = f.value;

    this.canSeq += 1;
    const canId = `CAN-${String(this.canSeq).padStart(4, "0")}`;
    // 同类型同标题新版本（supersede 旧版）
    for (const c of this.canonical.values())
      if (c.type === (raw.docType ?? "other") && c.title === raw.title && c.status === "published")
        c.status = "superseded";

    // 联动 K1：登记 Wiki 原始来源（后续在 K1 编译/四眼/发布）
    let wikiSourceId: string | undefined;
    try {
      const ws = this.wiki.ingestSource(actorId, {
        kind: WIKI_KIND_MAP[raw.docType ?? "other"] ?? "document",
        title: raw.title,
        body: this.fullText(raw).slice(0, 8000),
        sourceRef: raw.id
      });
      wikiSourceId = ws.id;
    } catch {
      /* K1 联动失败不阻断规范数据发布，仅缺 wikiSourceId */
    }

    const record: CanonicalRecord = {
      id: canId, type: raw.docType ?? "other", title: raw.title, payload,
      sourceIds: [id], version: 1, status: "published",
      publishedAt: new Date().toISOString(), publisherId: actorId, wikiSourceId
    };
    this.canonical.set(canId, record);
    raw.publishedId = canId;
    this.advance(raw, "published", actorId, canId);
    return { raw: this.get(id), canonical: record };
  }

  /** 自动跑到待复核（classify→…→submit），供批量处理与示例包 */
  autoRun(actorId: string, id: string): RawSource {
    let raw = this.get(id);
    if (raw.stage === "ingested") raw = this.classify(actorId, id);
    if (raw.stage === "classified") raw = this.parse(actorId, id);
    if (raw.stage === "parsed") raw = this.extract(actorId, id);
    if (raw.stage === "extracted") raw = this.normalize(actorId, id);
    if (raw.stage === "normalized") raw = this.submitForReview(actorId, id);
    return raw;
  }

  /* ---------------- 查询 / 血缘 / 看板 ---------------- */

  list(): { records: RawSource[] } {
    return { records: [...this.raws.values()] };
  }

  listCanonical(): { records: CanonicalRecord[] } {
    return { records: [...this.canonical.values()] };
  }

  get(id: string): RawSource {
    const r = this.raws.get(id);
    if (!r) throw new RefineryError(404, "44411", "原始资料不存在");
    return JSON.parse(JSON.stringify(r)) as RawSource;
  }

  /** 血缘：L0 → 版面块 → 字段 → 规范记录 */
  lineage(id: string) {
    const raw = this.must(id);
    const nodes: Array<{ id: string; label: string; kind: string }> = [
      { id: raw.id, label: `L0 ${raw.title}`, kind: "raw" },
      { id: `${raw.id}/blocks`, label: `版面块 ×${raw.blocks?.length ?? 0}`, kind: "blocks" }
    ];
    const links: Array<{ from: string; to: string; label: string }> = [
      { from: raw.id, to: `${raw.id}/blocks`, label: raw.parseTool ?? "解析" }
    ];
    for (const f of raw.fields ?? []) {
      const fid = `${raw.id}/${f.key}`;
      nodes.push({ id: fid, label: `${f.label}: ${f.value ?? "—"}`, kind: "field" });
      links.push({ from: `${raw.id}/blocks`, to: fid, label: `证据 p${f.evidence?.page ?? "?"}` });
    }
    if (raw.publishedId) {
      nodes.push({ id: raw.publishedId, label: `L1 ${raw.publishedId}`, kind: "canonical" });
      links.push({ from: `${raw.id}/blocks`, to: raw.publishedId, label: "发布" });
    }
    return { nodes, links };
  }

  dashboard(): RefineryDashboard {
    const stageOrder: RefineryStage[] = [
      "ingested", "classified", "parsed", "extracted", "normalized",
      "awaiting_review", "rejected", "published"
    ];
    const totals = Object.fromEntries(stageOrder.map((s) => [s, 0])) as Record<RefineryStage, number>;
    const typeCount = new Map<DocType, number>();
    let confSum = 0; let confN = 0; let manual = 0;
    const gapMap = new Map<string, { count: number; lastAt: string }>();

    for (const r of this.raws.values()) {
      totals[r.stage] += 1;
      if (r.docType) typeCount.set(r.docType, (typeCount.get(r.docType) ?? 0) + 1);
      for (const f of r.fields ?? []) {
        confSum += f.conf; confN += 1;
        if (f.manual) manual += 1;
        const required = REQUIRED_KEYS[r.docType ?? ""]?.includes(f.key);
        if (required && f.state !== "found") {
          const g = gapMap.get(f.key) ?? { count: 0, lastAt: r.ingestedAt };
          g.count += 1; g.lastAt = r.ingestedAt; gapMap.set(f.key, g);
        }
      }
    }

    return {
      totals,
      byDocType: [...typeCount.entries()].map(([type, count]) => ({ type, count })),
      metrics: {
        ingested: this.raws.size,
        published: this.canonical.size,
        autoClassified: [...this.raws.values()].filter((r) => r.classifyModel === "deterministic").length,
        manualInterventions: manual,
        avgFieldConf: confN ? Number((confSum / confN).toFixed(2)) : 0
      },
      gaps: [...gapMap.entries()].map(([key, v]) => ({ key, ...v }))
    };
  }

  /* ---------------- 示例包（移民高频资料，全部【示例】） ---------------- */

  loadSamplePack(actorId: string): { ingested: string[] } {
    const ids: string[] = [];
    for (const s of SAMPLE_DOCS) {
      // 幂等：标题已存在则跳过
      if ([...this.raws.values()].some((r) => r.title === s.title)) continue;
      const raw = this.ingestText(actorId, {
        title: s.title, content: s.content, sourceType: "export", sample: true
      });
      this.autoRun(actorId, raw.id);
      ids.push(raw.id);
    }
    return { ingested: ids };
  }

  /* ---------------- 内部工具 ---------------- */

  private must(id: string): RawSource {
    const r = this.raws.get(id);
    if (!r) throw new RefineryError(404, "44411", "原始资料不存在");
    return r;
  }

  private advance(raw: RawSource, stage: RefineryStage, actorId: string, note?: string) {
    raw.stage = stage;
    raw.history.push({ stage, at: new Date().toISOString(), actorId, note });
    this.audit.record({ actor: actorId, realm: "staff", action: `refinery.${stage}`, resource: raw.id, result: "allow" });
  }

  private rawContent(raw: RawSource): string {
    return raw.text ?? "";
  }

  private fullText(raw: RawSource): string {
    if (raw.blocks?.length) return raw.blocks.map((b) => b.text).join("\n");
    return this.rawContent(raw);
  }

  private sha256(text: string): string {
    // 轻量 FNV 风格 64 位 hex（非加密用途：去重指纹；标注为内容指纹）
    let h1 = 0xdeadbeef ^ text.length; let h2 = 0x41c6ce57 ^ text.length;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hex = (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
    return `fp:${hex}`;
  }
}
