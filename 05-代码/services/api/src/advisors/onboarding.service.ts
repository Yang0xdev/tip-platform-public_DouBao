import { HttpException, Injectable } from "@nestjs/common";
import { WordEngine, onboardingMachine, type OnboardingState } from "@tip/core";
import { EntityService } from "../entities/entity.service.js";

/**
 * 顾问入驻（PRD-M1 M1-09 / A03-roster）
 * 草稿→提交（机构有效门 + 四条承诺逐条签署 + 通识培训确认 + L3 材料引用 + 自述过词库）
 *      → 通过 / 驳回（终态）/ 补正；自述单独审核通过后才随名片可见。
 * L3 材料 M1 仅登记对象引用占位，KMS/对象存储在 M3 接入。
 */

export const COMMITMENT_KEYS = [
  "no_private_collection", // 不私收款
  "no_offplatform_promise", // 不平台外承诺
  "no_exaggeration", // 不夸大/不协助虚假材料
  "confidentiality" // 保密
] as const;
export type CommitmentKey = (typeof COMMITMENT_KEYS)[number];

export interface OnboardingDraftInput {
  phone: string;
  entityId: string;
  realName: string;
  filingNo?: string | null; // 人员备案信息（字段 A12/A03 可配，门 D2）
  materialRefs: string[]; // L3 身份与从业证明对象引用
  selfIntro: string; // 名片自述（pitch 生产点过词库）
  title?: string | null;
  yearsOfPractice?: number | null;
}

export interface OnboardingRecord extends OnboardingDraftInput {
  id: string;
  advisorUserId: string;
  state: OnboardingState;
  commitments: Record<CommitmentKey, string | null>; // 签署时间戳
  trainingConfirmedAt: string | null;
  selfIntroApproved: boolean;
  reviewerId: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export class OnboardingError extends HttpException {
  constructor(status: number, bizCode: string, message: string, details?: unknown) {
    super({ code: bizCode, message, details }, status);
  }
}

@Injectable()
export class OnboardingService {
  private records = new Map<string, OnboardingRecord>();
  private byAdvisor = new Map<string, string>();
  private seq = 0;
  private readonly words = new WordEngine("baseline-v1");

  constructor(private readonly entities: EntityService) {}

  createDraft(input: OnboardingDraftInput, advisorUserId: string): OnboardingRecord {
    if (this.byAdvisor.has(advisorUserId)) throw new OnboardingError(409, "40930", "已存在入驻申请");
    if (!input.phone?.trim() || !input.realName?.trim()) throw new OnboardingError(400, "40030", "手机号与姓名必填");
    this.seq += 1;
    const now = new Date().toISOString();
    const rec: OnboardingRecord = {
      id: `ADV-${String(this.seq).padStart(4, "0")}`,
      advisorUserId,
      ...input,
      filingNo: input.filingNo ?? null,
      title: input.title ?? null,
      yearsOfPractice: input.yearsOfPractice ?? null,
      state: "draft",
      commitments: { no_private_collection: null, no_offplatform_promise: null, no_exaggeration: null, confidentiality: null },
      trainingConfirmedAt: null,
      selfIntroApproved: false,
      reviewerId: null,
      rejectReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(rec.id, rec);
    this.byAdvisor.set(advisorUserId, rec.id);
    return { ...rec };
  }

  signCommitment(id: string, key: CommitmentKey, advisorUserId: string): OnboardingRecord {
    const rec = this.requireMine(id, advisorUserId);
    if (rec.state !== "draft" && rec.state !== "correcting") throw new OnboardingError(409, "40901", "当前状态不可签署");
    if (!COMMITMENT_KEYS.includes(key)) throw new OnboardingError(400, "40031", "未知承诺条目");
    rec.commitments[key] = new Date().toISOString();
    rec.updatedAt = new Date().toISOString();
    return { ...rec };
  }

  confirmTraining(id: string, advisorUserId: string): OnboardingRecord {
    const rec = this.requireMine(id, advisorUserId);
    rec.trainingConfirmedAt = new Date().toISOString();
    rec.updatedAt = rec.trainingConfirmedAt;
    return { ...rec };
  }

  submit(id: string, advisorUserId: string): OnboardingRecord {
    const rec = this.requireMine(id, advisorUserId);
    // 机构门：仅有效/临期机构可提交（M1-01）
    this.entities.assertUsable(rec.entityId);
    if (!rec.materialRefs || rec.materialRefs.length === 0) throw new OnboardingError(422, "42240", "必须提交身份与从业证明");
    const unsigned = COMMITMENT_KEYS.filter((k) => !rec.commitments[k]);
    if (unsigned.length) throw new OnboardingError(422, "42241", "入驻承诺未逐条签署", unsigned);
    if (!rec.trainingConfirmedAt) throw new OnboardingError(422, "42242", "须完成通识培训阅读确认");
    const word = this.words.check(rec.selfIntro ?? "", "pitch");
    if (!word.ok) throw new OnboardingError(422, "42201", "自述命中禁用词", word.blocked);
    const event = rec.state === "correcting" ? "resubmit" : "submit";
    return this.move(rec, event, { authorId: rec.advisorUserId, reviewerId: rec.reviewerId });
  }

  approve(id: string, reviewerId: string): OnboardingRecord {
    const rec = this.require(id);
    return this.move(rec, "approve", { authorId: rec.advisorUserId, reviewerId });
  }

  reject(id: string, reviewerId: string, reason: string): OnboardingRecord {
    const rec = this.require(id);
    if (!reason?.trim()) throw new OnboardingError(400, "40032", "驳回必须填写原因（含申诉入口说明）");
    const moved = this.move(rec, "reject", { authorId: rec.advisorUserId, reviewerId });
    moved.rejectReason = reason;
    return { ...moved };
  }

  requestCorrection(id: string, reviewerId: string, reason: string): OnboardingRecord {
    const rec = this.require(id);
    if (!reason?.trim()) throw new OnboardingError(400, "40032", "补正要求必须指明材料与原因");
    const moved = this.move(rec, "request_correction", { authorId: rec.advisorUserId, reviewerId });
    moved.rejectReason = reason;
    return { ...moved };
  }

  /** 自述单独审核（M1-11）：通过后名片才展示自述并带"未经平台核验"标识 */
  reviewSelfIntro(id: string, reviewerId: string, decision: "approve" | "reject"): OnboardingRecord {
    const rec = this.require(id);
    if (rec.state !== "approved") throw new OnboardingError(409, "40901", "入驻通过后才审核名片自述");
    const word = this.words.check(rec.selfIntro ?? "", "pitch");
    if (!word.ok) throw new OnboardingError(422, "42201", "自述命中禁用词", word.blocked);
    rec.selfIntroApproved = decision === "approve";
    rec.reviewerId = reviewerId;
    rec.updatedAt = new Date().toISOString();
    return { ...rec };
  }

  list(): OnboardingRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  get(id: string): OnboardingRecord {
    return { ...this.require(id) };
  }

  getByAdvisor(advisorUserId: string): OnboardingRecord | null {
    const id = this.byAdvisor.get(advisorUserId);
    return id ? this.get(id) : null;
  }

  /** 授权/展业门：必须入驻通过 */
  assertApproved(advisorUserId: string): OnboardingRecord {
    const rec = this.getByAdvisor(advisorUserId);
    if (!rec) throw new OnboardingError(403, "40330", "未提交入驻申请");
    if (rec.state !== "approved") throw new OnboardingError(403, "40331", "入驻未通过，业务区锁定");
    return rec;
  }

  private requireMine(id: string, advisorUserId: string): OnboardingRecord {
    const rec = this.require(id);
    if (rec.advisorUserId !== advisorUserId) throw new OnboardingError(403, "40302", "仅本人可操作自己的入驻申请");
    return rec;
  }

  private require(id: string): OnboardingRecord {
    const rec = this.records.get(id);
    if (!rec) throw new OnboardingError(404, "40430", "入驻申请不存在");
    return rec;
  }

  private move(rec: OnboardingRecord, event: Parameters<typeof onboardingMachine.transition>[2], ctx: { authorId: string; reviewerId: string | null }): OnboardingRecord {
    const out = onboardingMachine.transition(ctx, rec.state, event);
    if (!out.ok || !out.to) throw new OnboardingError(409, out.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (out.code ?? "40901"), out.reason ?? "状态迁移被拒绝");
    rec.state = out.to;
    if (ctx.reviewerId) rec.reviewerId = ctx.reviewerId;
    rec.updatedAt = new Date().toISOString();
    this.records.set(rec.id, { ...rec });
    return { ...rec };
  }
}
