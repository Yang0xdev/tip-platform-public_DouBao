import { HttpException, Injectable } from "@nestjs/common";
import { WordEngine, feeScheduleMachine, type FeeScheduleState, type FeeScheduleEvent } from "@tip/core";

/**
 * 初评问卷与结论模板版本（PRD-M1 M1-07 / A12-rev）
 * 草稿→合规复核中→已发布→被替代；复核人≠编辑人；
 * 全部文案在 assessment 生产点过词库；客户端只加载已发布版本并展示版本号。
 */

export type TemplateKind = "questionnaire" | "result_template";
export type TemplateState = FeeScheduleState; // draft|in_review|published|superseded

export interface QuestionnaireContent {
  /** 题组/题目：code、题面、题型、必填、选项、跳转 */
  questions: Array<{
    code: string;
    group: string;
    title: string;
    type: "single" | "multi" | "number" | "text" | "choice";
    required: boolean;
    options?: Array<{ value: string; label: string }>;
    skipTo?: string;
  }>;
}

export interface ResultTemplateContent {
  /** 四类结论的呈现模板，固定结构，不允许自由文本承诺 */
  blocks: Record<"eligible" | "gap" | "unconfirmed" | "not_committed", { title: string; body: string }>;
  needsManualNote: string;
  noMatchNote: string;
}

export interface TemplateRecord {
  id: string;
  kind: TemplateKind;
  code: string;
  version: number;
  title: string;
  content: QuestionnaireContent | ResultTemplateContent;
  state: TemplateState;
  authorId: string;
  reviewerId: string | null;
  wordVersion: string;
  createdAt: string;
  updatedAt: string;
}

export class TemplateError extends HttpException {
  constructor(status: number, bizCode: string, message: string, details?: unknown) {
    super({ code: bizCode, message, details }, status);
  }
}

@Injectable()
export class AssessmentTemplateService {
  private records = new Map<string, TemplateRecord>();
  private seq = 0;
  private readonly words = new WordEngine("baseline-v1");

  createDraft(kind: TemplateKind, code: string, title: string, content: TemplateRecord["content"], author: string): TemplateRecord {
    if (!code?.trim() || !title?.trim()) throw new TemplateError(400, "40060", "模板编码与标题必填");
    this.assertWords(kind, content);
    this.seq += 1;
    const now = new Date().toISOString();
    const rec: TemplateRecord = {
      id: `TPL-${kind.charAt(0).toUpperCase()}-${String(this.seq).padStart(4, "0")}`,
      kind,
      code: code.trim(),
      version: this.nextVersion(kind, code),
      title: title.trim(),
      content,
      state: "draft",
      authorId: author,
      reviewerId: null,
      wordVersion: this.words.version,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(rec.id, rec);
    return { ...rec };
  }

  submit(id: string, actor: string): TemplateRecord {
    const rec = this.require(id);
    if (rec.authorId !== actor) throw new TemplateError(403, "40302", "仅编辑人可提交");
    this.assertWords(rec.kind, rec.content); // 词库升级后按新词库重新校验
    return this.move(rec, "submit", { authorId: rec.authorId, reviewerId: rec.reviewerId });
  }

  review(id: string, event: "approve" | "reject", reviewer: string): TemplateRecord {
    const rec = this.require(id);
    const moved = this.move(rec, event, { authorId: rec.authorId, reviewerId: reviewer });
    moved.reviewerId = reviewer;
    if (event === "approve") {
      for (const other of this.records.values()) {
        if (other.id !== rec.id && other.kind === rec.kind && other.code === rec.code && other.state === "published") {
          this.move(other, "supersede", { authorId: other.authorId, reviewerId: other.reviewerId });
        }
      }
    }
    return { ...moved };
  }

  list(kind?: TemplateKind): TemplateRecord[] {
    return [...this.records.values()].filter((r) => !kind || r.kind === kind).map((r) => ({ ...r }));
  }

  published(kind: TemplateKind, code?: string): TemplateRecord | null {
    const found = [...this.records.values()]
      .filter((r) => r.kind === kind && r.state === "published" && (!code || r.code === code))
      .sort((a, b) => b.version - a.version)[0];
    return found ? { ...found } : null;
  }

  /** 客户端加载：仅已发布，带版本号 */
  requirePublished(kind: TemplateKind, code?: string): TemplateRecord {
    const rec = this.published(kind, code);
    if (!rec) throw new TemplateError(404, "40460", "模板未发布或已停用");
    return rec;
  }

  private assertWords(kind: TemplateKind, content: TemplateRecord["content"]): void {
    const text = kind === "questionnaire"
      ? (content as QuestionnaireContent).questions.map((q) => `${q.title} ${(q.options ?? []).map((o) => o.label).join(" ")}`).join("\n")
      : Object.values((content as ResultTemplateContent).blocks).map((b) => `${b.title} ${b.body}`).join("\n") +
        `\n${(content as ResultTemplateContent).needsManualNote}\n${(content as ResultTemplateContent).noMatchNote}`;
    const r = this.words.check(text, "assessment");
    if (!r.ok) throw new TemplateError(422, "42201", "模板文案命中禁用词", r.blocked);
  }

  private nextVersion(kind: TemplateKind, code: string): number {
    const same = this.list(kind).filter((r) => r.code === code);
    return same.length === 0 ? 1 : Math.max(...same.map((r) => r.version)) + 1;
  }

  private require(id: string): TemplateRecord {
    const rec = this.records.get(id);
    if (!rec) throw new TemplateError(404, "40460", "模板不存在");
    return rec;
  }

  private move(rec: TemplateRecord, event: FeeScheduleEvent, ctx: { authorId: string; reviewerId: string | null }): TemplateRecord {
    const out = feeScheduleMachine.transition(ctx, rec.state, event);
    if (!out.ok || !out.to) throw new TemplateError(409, out.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (out.code ?? "40901"), out.reason ?? "状态迁移被拒绝");
    rec.state = out.to;
    rec.updatedAt = new Date().toISOString();
    this.records.set(rec.id, { ...rec });
    return rec;
  }
}
