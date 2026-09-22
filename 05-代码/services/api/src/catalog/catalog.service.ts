import { HttpException, Injectable } from "@nestjs/common";
import {
  WordEngine,
  validateFeeItems,
  projectVersionMachine,
  feeScheduleMachine,
  type FeeItem,
  type ProjectVersionState,
  type FeeScheduleState
} from "@tip/core";
import { VerificationService } from "./verification.service.js";

/**
 * 内容目录（PRD-M1：M1-02 项目版本 / M1-04 收费方案 / M1-05 四眼发布 / M1-06 词库）
 * 状态机与闸门在 @tip/core；本服务负责编排、词库/金额/核验门与（M1 内存）仓储。
 */

export class CatalogError extends HttpException {
  constructor(status: number, bizCode: string, message: string, details?: unknown) {
    super({ code: bizCode, message, details }, status);
  }
}

interface ProjectRecord {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  state: ProjectVersionState;
  editorId: string;
  verifierId: string | null;
  publisherId: string | null;
  keyFactIds: string[];
  feeScheduleId: string | null;
  suspendReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FeeRecord {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  feeItems: FeeItem[];
  state: FeeScheduleState;
  authorId: string;
  reviewerId: string | null;
  wordVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDraftInput {
  code: string;
  title: string;
  body: string;
  keyFactIds?: string[];
  feeScheduleId?: string | null;
}

export interface FeeDraftInput {
  code: string;
  title: string;
  body: string;
  feeItems: FeeItem[];
}

@Injectable()
export class CatalogService {
  private projects = new Map<string, ProjectRecord>();
  private fees = new Map<string, FeeRecord>();
  private pSeq = 0;
  private fSeq = 0;
  private readonly words = new WordEngine("baseline-v1");

  constructor(private readonly verifications: VerificationService) {}

  /* ---------------- 项目版本 ---------------- */

  createProjectDraft(input: ProjectDraftInput, editor: string): ProjectRecord {
    if (!input.code?.trim() || !input.title?.trim()) throw new CatalogError(400, "40001", "缺少项目编码或标题");
    this.assertCleanText(`${input.title}\n${input.body}`);
    this.pSeq += 1;
    const now = new Date().toISOString();
    const rec: ProjectRecord = {
      id: `PRJ-${String(this.pSeq).padStart(4, "0")}`,
      code: input.code.trim(),
      version: 1,
      title: input.title.trim(),
      body: input.body,
      state: "draft",
      editorId: editor,
      verifierId: null,
      publisherId: null,
      keyFactIds: input.keyFactIds ?? [],
      feeScheduleId: input.feeScheduleId ?? null,
      suspendReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.projects.set(rec.id, rec);
    return { ...rec };
  }

  /** 已发布版本的修订 = 新版本草稿，旧版归档只读 */
  newProjectVersion(id: string, editor: string): ProjectRecord {
    const base = this.requireProject(id);
    if (base.state !== "published" && base.state !== "suspended") {
      throw new CatalogError(409, "40901", "仅已发布/暂停版本可派生新版本");
    }
    this.pSeq += 1;
    const now = new Date().toISOString();
    const rec: ProjectRecord = {
      ...base,
      id: `PRJ-${String(this.pSeq).padStart(4, "0")}`,
      version: base.version + 1,
      state: "draft",
      editorId: editor,
      verifierId: null,
      publisherId: null,
      suspendReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.projects.set(rec.id, rec);
    return { ...rec };
  }

  updateProjectDraft(id: string, patch: Partial<Pick<ProjectRecord, "title" | "body" | "keyFactIds" | "feeScheduleId">>, editor: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (rec.state !== "draft") throw new CatalogError(409, "40901", "仅草稿可编辑");
    if (rec.editorId !== editor) throw new CatalogError(403, "40302", "仅编辑人可修改自己的草稿");
    if (patch.title || patch.body) this.assertCleanText(`${patch.title ?? rec.title}\n${patch.body ?? rec.body}`);
    Object.assign(rec, patch);
    rec.updatedAt = new Date().toISOString();
    return { ...rec };
  }

  submitProjectForVerification(id: string, editor: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (rec.editorId !== editor) throw new CatalogError(403, "40302", "仅编辑人可提交自己的版本");
    this.assertCleanText(`${rec.title}\n${rec.body}`);
    return this.moveProject(rec, "submit_verification", { actor: editor });
  }

  passVerification(id: string, verifier: string): ProjectRecord {
    const rec = this.requireProject(id);
    // 服务端事实门：核验人≠编辑人，事实全部 verified（due 可见，invalid/缺失拒绝）
    this.verifications.assertPublishable(rec.keyFactIds, rec.editorId);
    if (verifier === rec.editorId) throw new CatalogError(422, "VERIFIER_IS_EDITOR", "核验人不得为该版本最后编辑人（职责分离）");
    const moved = this.moveProject(rec, "pass_verification", {
      ctx: { editorId: rec.editorId, verifierId: verifier, publisherId: null, keyFactsTotal: rec.keyFactIds.length, keyFactsVerified: rec.keyFactIds.length },
      actor: verifier
    });
    moved.verifierId = verifier;
    return this.saveProject(moved);
  }

  rejectVerification(id: string, verifier: string, reason: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (verifier === rec.editorId) throw new CatalogError(422, "VERIFIER_IS_EDITOR", "核验人不得为该版本最后编辑人（职责分离）");
    if (!reason?.trim()) throw new CatalogError(400, "40004", "驳回必须逐条填写原因");
    const moved = this.moveProject(rec, "reject_verification", {
      ctx: { editorId: rec.editorId, verifierId: verifier, publisherId: null, keyFactsTotal: rec.keyFactIds.length, keyFactsVerified: rec.keyFactIds.length },
      actor: verifier
    });
    moved.verifierId = verifier;
    return this.saveProject(moved);
  }

  approvePublication(id: string, publisher: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (publisher === rec.editorId) throw new CatalogError(422, "PUBLISHER_IS_EDITOR", "最后编辑人不得兼任发布人（四眼原则）");
    // 收费门：必须关联已发布收费方案版本
    if (!rec.feeScheduleId) throw new CatalogError(422, "FEE_NOT_LINKED", "发布前必须关联收费方案版本");
    const fee = this.fees.get(rec.feeScheduleId);
    if (!fee || fee.state !== "published") throw new CatalogError(422, "FEE_NOT_PUBLISHED", "关联的收费方案未发布");
    // 事实门二次校验（防止核验后被标记失效）
    this.verifications.assertPublishable(rec.keyFactIds, rec.editorId);
    const moved = this.moveProject(rec, "approve_publication", {
      ctx: { editorId: rec.editorId, verifierId: rec.verifierId, publisherId: publisher, keyFactsTotal: rec.keyFactIds.length, keyFactsVerified: rec.keyFactIds.length },
      actor: publisher
    });
    moved.publisherId = publisher;
    return this.saveProject(moved);
  }

  rejectPublication(id: string, publisher: string, reason: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (!reason?.trim()) throw new CatalogError(400, "40004", "驳回必须填写原因");
    const moved = this.moveProject(rec, "reject_publication", {
      ctx: { editorId: rec.editorId, verifierId: rec.verifierId, publisherId: publisher, keyFactsTotal: rec.keyFactIds.length, keyFactsVerified: rec.keyFactIds.length },
      actor: publisher
    });
    return this.saveProject(moved);
  }

  suspend(id: string, actor: string, reasonCategory: string, handlingNote: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (!reasonCategory?.trim() || !handlingNote?.trim()) {
      throw new CatalogError(400, "40005", "暂停必须填写原因类别与对在办客户的处置说明");
    }
    const moved = this.moveProject(rec, "suspend", { actor });
    moved.suspendReason = `${reasonCategory}｜${handlingNote}`;
    return this.saveProject(moved);
  }

  delist(id: string, actor: string): ProjectRecord {
    return this.moveProject(this.requireProject(id), "delist", { actor });
  }

  adminListProjects(): ProjectRecord[] {
    return [...this.projects.values()].map((r) => ({ ...r }));
  }

  /** 对客：仅 published 且关联事实当前无 invalid */
  listPublishedProjects(): ProjectRecord[] {
    return this.adminListProjects().filter((r) => r.state === "published" && this.verifications.allUsable(r.keyFactIds));
  }

  getPublishedProject(id: string): ProjectRecord {
    const rec = this.requireProject(id);
    if (rec.state !== "published" || !this.verifications.allUsable(rec.keyFactIds)) {
      throw new CatalogError(404, "40401", "内容不存在、未发布或内容复核中");
    }
    return { ...rec };
  }

  /* ---------------- 收费方案版本 ---------------- */

  createFeeDraft(input: FeeDraftInput, author: string): FeeRecord {
    if (!input.code?.trim() || !input.title?.trim()) throw new CatalogError(400, "40001", "缺少收费方案编码或标题");
    this.assertCleanText(`${input.title}\n${input.body}`);
    const v = validateFeeItems(input.feeItems ?? []);
    if (!v.valid) throw new CatalogError(422, v.code, v.reason);
    this.fSeq += 1;
    const now = new Date().toISOString();
    const rec: FeeRecord = {
      id: `FEE-${String(this.fSeq).padStart(4, "0")}`,
      code: input.code.trim(),
      version: this.nextFeeVersion(input.code),
      title: input.title.trim(),
      body: input.body,
      feeItems: input.feeItems,
      state: "draft",
      authorId: author,
      reviewerId: null,
      wordVersion: this.words.version,
      createdAt: now,
      updatedAt: now
    };
    this.fees.set(rec.id, rec);
    return { ...rec };
  }

  submitFee(id: string, actor: string): FeeRecord {
    const rec = this.requireFee(id);
    if (rec.authorId !== actor) throw new CatalogError(403, "40302", "仅编制人可提交自己的版本");
    return this.moveFee(rec, "submit", { actor, ctx: { authorId: rec.authorId, reviewerId: rec.reviewerId } });
  }

  reviewFee(id: string, event: "approve" | "reject", reviewer: string): FeeRecord {
    const rec = this.requireFee(id);
    const moved = this.moveFee(rec, event, { actor: reviewer, ctx: { authorId: rec.authorId, reviewerId: reviewer } });
    moved.reviewerId = reviewer;
    if (event === "approve") {
      // 同 code 旧发布版本自动 superseded（只读、可追溯）
      for (const other of this.fees.values()) {
        if (other.code === rec.code && other.id !== rec.id && other.state === "published") {
          const old = this.moveFee(other, "supersede", { actor: "system", ctx: { authorId: other.authorId, reviewerId: other.reviewerId } });
          this.fees.set(other.id, old);
        }
      }
    }
    return this.saveFee(moved);
  }

  adminListFees(): FeeRecord[] {
    return [...this.fees.values()].map((r) => ({ ...r }));
  }

  listPublishedFees(): FeeRecord[] {
    return this.adminListFees().filter((r) => r.state === "published");
  }

  getPublishedFee(id: string): FeeRecord {
    const rec = this.requireFee(id);
    if (rec.state !== "published") throw new CatalogError(404, "40401", "收费方案不存在或未发布");
    return { ...rec };
  }

  /* ---------------- 内部 ---------------- */

  private assertCleanText(text: string): void {
    const r = this.words.check(text, "asset");
    if (!r.ok) throw new CatalogError(422, "42201", "文案命中禁用词，禁止进入发布流程", r.blocked);
  }

  private nextFeeVersion(code: string): number {
    const same = this.adminListFees().filter((f) => f.code === code);
    return same.length === 0 ? 1 : Math.max(...same.map((f) => f.version)) + 1;
  }

  private requireProject(id: string): ProjectRecord {
    const rec = this.projects.get(id);
    if (!rec) throw new CatalogError(404, "40401", "项目版本不存在");
    return rec;
  }

  private requireFee(id: string): FeeRecord {
    const rec = this.fees.get(id);
    if (!rec) throw new CatalogError(404, "40401", "收费方案版本不存在");
    return rec;
  }

  private moveProject(rec: ProjectRecord, event: Parameters<typeof projectVersionMachine.transition>[2], opts: { actor: string; ctx?: Parameters<typeof projectVersionMachine.transition>[0] }): ProjectRecord {
    const ctx = opts.ctx ?? { editorId: rec.editorId, verifierId: rec.verifierId, publisherId: rec.publisherId, keyFactsTotal: rec.keyFactIds.length, keyFactsVerified: rec.keyFactIds.length };
    const out = projectVersionMachine.transition(ctx, rec.state, event);
    if (!out.ok || !out.to) throw new CatalogError(409, out.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (out.code ?? "40901"), out.reason ?? "状态迁移被拒绝");
    rec.state = out.to;
    rec.updatedAt = new Date().toISOString();
    return this.saveProject(rec);
  }

  private moveFee(rec: FeeRecord, event: Parameters<typeof feeScheduleMachine.transition>[2], opts: { actor: string; ctx: Parameters<typeof feeScheduleMachine.transition>[0] }): FeeRecord {
    const out = feeScheduleMachine.transition(opts.ctx, rec.state, event);
    if (!out.ok || !out.to) throw new CatalogError(409, out.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (out.code ?? "40901"), out.reason ?? "状态迁移被拒绝");
    rec.state = out.to;
    rec.updatedAt = new Date().toISOString();
    return this.saveFee(rec);
  }

  private saveProject(rec: ProjectRecord): ProjectRecord {
    this.projects.set(rec.id, { ...rec });
    return { ...rec };
  }

  private saveFee(rec: FeeRecord): FeeRecord {
    this.fees.set(rec.id, { ...rec });
    return { ...rec };
  }
}

/** API 出参：bigint 转字符串；永不输出总价 */
export function projectView(r: ProjectRecord) {
  return { ...r };
}
export function feeView(r: FeeRecord) {
  return { ...r, feeItems: r.feeItems.map((f) => ({ ...f, amountMinor: f.amountMinor === null ? null : f.amountMinor.toString() })) };
}
