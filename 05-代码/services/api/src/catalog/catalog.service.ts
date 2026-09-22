import { HttpException, Injectable } from "@nestjs/common";
import {
  WordEngine,
  validateFeeItems,
  projectVersionMachine,
  feeScheduleMachine,
  type FeeItem,
  type ContentVersionState,
  type ContentVersionEvent,
  type CheckResult
} from "@tip/core";

/**
 * 内容目录服务（PRD-M1：M1-02 项目库版本 / M1-04 收费方案版本 / M1-05 四眼发布 / M1-06 词库）
 * M0/M1 内存实现（dev 种子为空，生产零示例）；M1 后期换 Prisma 仓储，状态迁移仍走 @tip/core。
 */

export type CatalogKind = "project" | "fee_schedule";

export interface CatalogRecord {
  id: string;
  kind: CatalogKind;
  code: string;
  version: number;
  title: string;
  body: string;
  feeItems: FeeItem[];
  state: ContentVersionState;
  authorId: string;
  reviewerId: string | null;
  wordVersion: string;
  warnings: CheckResult["warnings"];
  createdAt: string;
  updatedAt: string;
}

export interface DraftInput {
  code: string;
  title: string;
  body: string;
  feeItems?: FeeItem[];
}

export class CatalogError extends HttpException {
  constructor(
    public readonly httpStatus: number,
    public readonly bizCode: string,
    message: string,
    public readonly details?: unknown
  ) {
    super({ code: bizCode, message, details }, httpStatus);
  }
}

@Injectable()
export class CatalogService {
  private readonly records = new Map<string, CatalogRecord>();
  private seq = 0;
  private readonly words = new WordEngine("baseline-v1");

  /** 员工编制草稿：展示文案在"素材"生产点过词库；费用项过金额铁律 */
  createDraft(kind: CatalogKind, input: DraftInput, actor: string): CatalogRecord {
    if (!input.code?.trim() || !input.title?.trim()) {
      throw new CatalogError(400, "40001", "缺少项目编码或标题");
    }
    const wordCheck = this.words.checkAll([
      { text: `${input.title}\n${input.body}`, point: "asset" }
    ]);
    if (!wordCheck.ok) {
      throw new CatalogError(422, "42201", "文案命中禁用词，禁止进入发布流程", wordCheck.blocked);
    }
    const feeItems = input.feeItems ?? [];
    if (kind === "fee_schedule") {
      const v = validateFeeItems(feeItems);
      if (!v.valid) throw new CatalogError(422, v.code, v.reason);
    } else if (feeItems.length > 0) {
      throw new CatalogError(400, "40002", "费用项仅允许挂在收费方案版本上");
    }
    this.seq += 1;
    const now = new Date().toISOString();
    const prefix = kind === "project" ? "PRJ" : "FEE";
    const rec: CatalogRecord = {
      id: `${prefix}-${String(this.seq).padStart(4, "0")}`,
      kind,
      code: input.code.trim(),
      version: 1,
      title: input.title.trim(),
      body: input.body,
      feeItems,
      state: "draft",
      authorId: actor,
      reviewerId: null,
      wordVersion: wordCheck.wordVersion,
      warnings: wordCheck.warnings,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(rec.id, rec);
    return rec;
  }

  /** 编制人提交复核 */
  submit(id: string, actor: string): CatalogRecord {
    const rec = this.require(id);
    if (rec.authorId !== actor) {
      throw new CatalogError(403, "40302", "仅编制人可提交自己的版本");
    }
    return this.move(rec, "submit", actor, false);
  }

  /** 复核人决定：approve / reject / suspend；warn 级词需显式知情确认 */
  review(id: string, event: Extract<ContentVersionEvent, "approve" | "reject" | "suspend">, actor: string, ackWarnings: boolean): CatalogRecord {
    const rec = this.require(id);
    if (rec.authorId === actor) {
      // 直接给出四眼原则错误，与状态机守卫口径一致
      throw new CatalogError(422, "REVIEWER_IS_AUTHOR", "编制人与复核人不得为同一人（四眼原则）");
    }
    if (event === "approve" && rec.warnings.length > 0 && !ackWarnings) {
      throw new CatalogError(422, "42202", "存在需人工署名审核的警示词，确认知情后方可通过", rec.warnings);
    }
    return this.move(rec, event, actor, true);
  }

  /** 驳回后修订 / 发布后修订：回到草稿，复核人清空（修订后必须重新走四眼） */
  revise(id: string, actor: string): CatalogRecord {
    const rec = this.require(id);
    if (rec.authorId !== actor) throw new CatalogError(403, "40302", "仅编制人可修订自己的版本");
    const moved = this.move(rec, "revise", actor, false);
    moved.reviewerId = null;
    moved.warnings = this.words.check(`${moved.title}\n${moved.body}`, "asset").warnings;
    return this.persist(moved);
  }

  adminList(kind: CatalogKind): CatalogRecord[] {
    return [...this.records.values()].filter((r) => r.kind === kind);
  }

  listPublished(kind: CatalogKind): CatalogRecord[] {
    return this.adminList(kind).filter((r) => r.state === "published");
  }

  getPublished(id: string): CatalogRecord {
    const rec = this.require(id);
    if (rec.state !== "published") throw new CatalogError(404, "40401", "内容不存在或未发布");
    return rec;
  }

  /* ---- 内部 ---- */

  private require(id: string): CatalogRecord {
    const rec = this.records.get(id);
    if (!rec) throw new CatalogError(404, "40401", "版本不存在");
    return rec;
  }

  private move(rec: CatalogRecord, event: ContentVersionEvent, actor: string, isReview: boolean): CatalogRecord {
    const machine = rec.kind === "project" ? projectVersionMachine : feeScheduleMachine;
    const outcome = machine.transition(
      { authorId: rec.authorId, reviewerId: isReview ? actor : rec.reviewerId },
      rec.state,
      event
    );
    if (!outcome.ok || !outcome.to) throw new CatalogError(409, outcome.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (outcome.code ?? "40901"), outcome.reason ?? "状态迁移被拒绝");
    rec.state = outcome.to;
    if (isReview) rec.reviewerId = actor;
    rec.updatedAt = new Date().toISOString();
    return this.persist(rec);
  }

  private persist(rec: CatalogRecord): CatalogRecord {
    this.records.set(rec.id, { ...rec });
    return { ...rec };
  }
}

/** API 出参：bigint 转字符串，避免 JSON 序列化异常；永不输出总价字段 */
export function toPublicView(rec: CatalogRecord) {
  return {
    id: rec.id,
    kind: rec.kind,
    code: rec.code,
    version: rec.version,
    title: rec.title,
    body: rec.body,
    feeItems: rec.feeItems.map((f) => ({ ...f, amountMinor: f.amountMinor === null ? null : f.amountMinor.toString() })),
    state: rec.state,
    updatedAt: rec.updatedAt
  };
}
