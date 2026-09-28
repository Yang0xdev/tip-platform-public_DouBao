import { HttpException, Injectable } from "@nestjs/common";
import { authorizationMachine, type AuthzState, type AuthzContext } from "@tip/core";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService } from "./onboarding.service.js";

/**
 * 项目授权五步（PRD-M1 M1-10 / S-02..04,S-10 / A03-learn）
 * unstarted(applied) → reading(learning，三份必读逐项确认) → pending(grant_pending)
 * → granted(authorized，带有效期) → expiring/expired；驳回回 reading 可重申；
 * 项目规则版本更新 → reconfirm_required，重确认前不可展业。
 * 未授权：报价/方案/佣金接口不下发（由 assertCanPitch 在后续切片统一守门）。
 */

export const LEARNING_MATERIALS = [
  { key: "project_rules", label: "项目规则（对客可表述口径）" },
  { key: "banned_words", label: "禁表述清单（锁词库版本）" },
  { key: "fee_script", label: "费用说明（对客口径，不含佣金）" }
] as const;
export type MaterialKey = (typeof LEARNING_MATERIALS)[number]["key"];

/** 必读资料当前版本（M1 常量；A12 发布新版本后升版并触发重确认） */
export const MATERIAL_VERSIONS: Record<MaterialKey, string> = {
  project_rules: "rules-v1",
  banned_words: "baseline-v1",
  fee_script: "fee-v1"
};

export interface MaterialConfirmation {
  version: string;
  confirmedAt: string;
}

export interface GrantRecord {
  id: string;
  advisorUserId: string;
  projectCode: string;
  state: AuthzState;
  confirmations: Partial<Record<MaterialKey, MaterialConfirmation>>;
  reviewerId: string | null;
  rejectReason: string | null;
  requestedDays: number | null;
  grantedDays: number | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class GrantError extends HttpException {
  constructor(status: number, bizCode: string, message: string, details?: unknown) {
    super({ code: bizCode, message, details }, status);
  }
}

const MAX_GRANT_DAYS = 365 * 2; // 不允许永久授权，初始上限 2 年
const DEFAULT_GRANT_DAYS = 365;

@Injectable()
export class AuthorizationService {
  private grants = new Map<string, GrantRecord>(); // key advisor|project
  private seq = 0;
  /** 合规/投诉线索：新增授权冻结（停新接旧） */
  private frozenNew = new Set<string>();

  /** M4-03：冻结被投诉顾问的新增授权（在办接旧） */
  freezeNewAuthorization(advisorId: string, reason: string, actor: string): void {
    this.frozenNew.add(advisorId);
    for (const g of this.grants.values()) {
      if (g.advisorUserId === advisorId && g.state === "authorized") {
        g.state = "reconfirm_required";
        g.updatedAt = new Date().toISOString();
      }
    }
  }

  isFrozenNew(advisorId: string): boolean {
    return this.frozenNew.has(advisorId);
  }

  constructor(
    private readonly onboarding: OnboardingService,
    private readonly entities: EntityService
  ) {}

  private key(advisorUserId: string, projectCode: string) {
    return `${advisorUserId}|${projectCode}`;
  }

  private getOrCreate(advisorUserId: string, projectCode: string): GrantRecord {
    const k = this.key(advisorUserId, projectCode);
    let rec = this.grants.get(k);
    if (rec) return rec;
    this.seq += 1;
    const now = new Date().toISOString();
    rec = {
      id: `GR-${String(this.seq).padStart(4, "0")}`,
      advisorUserId,
      projectCode,
      state: "applied",
      confirmations: {},
      reviewerId: null,
      rejectReason: null,
      requestedDays: null,
      grantedDays: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.grants.set(k, rec);
    return rec;
  }

  /** 开始学习：入驻通过 + 机构有效 */
  start(advisorUserId: string, projectCode: string): GrantRecord {
    const ob = this.onboarding.assertApproved(advisorUserId);
    this.entities.assertUsable(ob.entityId);
    const rec = this.getOrCreate(advisorUserId, projectCode);
    if (rec.state !== "applied" && rec.state !== "rejected" && rec.state !== "expired" && rec.state !== "reconfirm_required") {
      throw new GrantError(409, "40901", `当前状态（${rec.state}）不可开始学习`);
    }
    const event = rec.state === "reconfirm_required" ? "start_reconfirm" : "start_learning";
    if (rec.state === "reconfirm_required") rec.confirmations = {}; // 旧确认失效
    return this.move(rec, event, this.ctx(rec));
  }

  /** 逐项确认必读资料（记录版本与时间） */
  confirmMaterial(advisorUserId: string, projectCode: string, materialKey: MaterialKey): GrantRecord {
    const rec = this.requireMine(advisorUserId, projectCode);
    if (rec.state !== "learning") throw new GrantError(409, "40901", "请先进入学习状态");
    if (!LEARNING_MATERIALS.some((m) => m.key === materialKey)) throw new GrantError(400, "40050", "未知必读资料");
    rec.confirmations[materialKey] = { version: MATERIAL_VERSIONS[materialKey], confirmedAt: new Date().toISOString() };
    rec.updatedAt = new Date().toISOString();
    this.grants.set(this.key(advisorUserId, projectCode), { ...rec });
    return { ...rec };
  }

  /** 提交授权申请：三份必读全部确认，不可跳步 */
  submit(advisorUserId: string, projectCode: string, requestedDays = DEFAULT_GRANT_DAYS): GrantRecord {
    const rec = this.requireMine(advisorUserId, projectCode);
    const missing = LEARNING_MATERIALS.map((m) => m.key).filter((k) => !rec.confirmations[k]);
    if (missing.length) throw new GrantError(422, "42250", "必读资料未逐项确认", missing);
    if (requestedDays <= 0 || requestedDays > MAX_GRANT_DAYS) throw new GrantError(400, "40051", "申请时长非法（不允许永久授权）");
    rec.requestedDays = requestedDays;
    return this.move(rec, "submit_grant", this.ctx(rec));
  }

  /** A03 审批：审批人≠申请人；授权有效期 = min(申请时长, 机构备案有效期) */
  approve(reviewerId: string, advisorUserId: string, projectCode: string, now = new Date()): GrantRecord {
    const rec = this.require(advisorUserId, projectCode);
    if (reviewerId === advisorUserId) throw new GrantError(422, "REVIEWER_IS_AUTHOR", "审批人不得为申请人本人");
    const ob = this.onboarding.getByAdvisor(advisorUserId);
    if (!ob) throw new GrantError(403, "40330", "顾问未入驻");
    const entityList = this.entities.list(now);
    const ent = entityList.find((e) => e.id === ob.entityId);
    if (!ent?.usable) throw new GrantError(422, "42231", "所属机构无效，不可批准授权");
    // 有效期取 min(申请, 备案剩余天数)
    const daysByEntity = ent.daysToExpiry === null ? rec.requestedDays ?? DEFAULT_GRANT_DAYS : Math.max(0, ent.daysToExpiry);
    const grantedDays = Math.min(rec.requestedDays ?? DEFAULT_GRANT_DAYS, daysByEntity);
    if (grantedDays <= 0) throw new GrantError(422, "42251", "备案有效期已不足，无法授权");
    const ctx = { ...this.ctx(rec), reviewerId, grantedScopes: [projectCode] };
    const moved = this.move(rec, "approve", ctx);
    moved.reviewerId = reviewerId;
    moved.grantedDays = grantedDays;
    moved.expiresAt = new Date(now.getTime() + grantedDays * 86_400_000).toISOString();
    this.grants.set(this.key(advisorUserId, projectCode), { ...moved });
    return { ...moved };
  }

  reject(reviewerId: string, advisorUserId: string, projectCode: string, reason: string): GrantRecord {
    const rec = this.require(advisorUserId, projectCode);
    if (!reason?.trim()) throw new GrantError(400, "40052", "驳回必须填写原因");
    const moved = this.move(rec, "reject", { ...this.ctx(rec), reviewerId });
    moved.rejectReason = reason;
    this.grants.set(this.key(advisorUserId, projectCode), { ...moved });
    return { ...moved };
  }

  /** 项目规则版本更新：该项目全部授权转待重确认（M1-05 事件） */
  markReconfirm(projectCode: string): number {
    let n = 0;
    for (const rec of this.grants.values()) {
      if (rec.projectCode !== projectCode) continue;
      if (rec.state === "authorized" || rec.state === "expiring") {
        const moved = this.move(rec, "require_reconfirm", this.ctx(rec));
        moved.confirmations = {};
        this.grants.set(this.key(rec.advisorUserId, projectCode), { ...moved });
        n += 1;
      }
    }
    return n;
  }

  /** 定时节拍：60/30/7 临期、到期 expired（停新接旧） */
  refreshExpiry(now = new Date()): { expiring: string[]; expired: string[] } {
    const expiring: string[] = [];
    const expired: string[] = [];
    for (const rec of this.grants.values()) {
      if (!rec.expiresAt) continue;
      const days = (new Date(rec.expiresAt).getTime() - now.getTime()) / 86_400_000;
      if (rec.state === "authorized" && days <= 60 && days > 0) {
        this.move(rec, "mark_expiring", this.ctx(rec));
        expiring.push(rec.id);
      } else if ((rec.state === "authorized" || rec.state === "expiring") && days <= 0) {
        this.move(rec, "expire", this.ctx(rec));
        expired.push(rec.id);
      }
    }
    return { expiring, expired };
  }

  /** 展业门（报价/方案/佣金端点在后续切片统一调用） */
  assertCanPitch(advisorUserId: string, projectCode: string): GrantRecord {
    const ob = this.onboarding.assertApproved(advisorUserId);
    this.entities.assertUsable(ob.entityId);
    const rec = this.grants.get(this.key(advisorUserId, projectCode));
    if (!rec || rec.state !== "authorized") {
      throw new GrantError(403, "40350", rec ? `授权状态（${rec.state}）不可展业` : "项目未授权，仅可见公开介绍");
    }
    if (rec.expiresAt && new Date(rec.expiresAt) <= new Date()) {
      this.move(rec, "expire", this.ctx(rec));
      throw new GrantError(403, "40351", "授权已过期，停新接旧");
    }
    return { ...rec };
  }

  list(advisorUserId?: string): GrantRecord[] {
    return [...this.grants.values()].filter((g) => !advisorUserId || g.advisorUserId === advisorUserId).map((g) => ({ ...g }));
  }

  /** 名片用：某项目当前可展示的已授权顾问 */
  listAuthorized(projectCode: string, now = new Date()): GrantRecord[] {
    this.refreshExpiry(now);
    return this.list().filter((g) => g.projectCode === projectCode && (g.state === "authorized" || g.state === "expiring"));
  }

  private requireMine(advisorUserId: string, projectCode: string): GrantRecord {
    const rec = this.grants.get(this.key(advisorUserId, projectCode));
    if (!rec) throw new GrantError(404, "40450", "请先开始学习");
    if (rec.advisorUserId !== advisorUserId) throw new GrantError(403, "40302", "仅本人可操作");
    return rec;
  }

  private require(advisorUserId: string, projectCode: string): GrantRecord {
    const rec = this.grants.get(this.key(advisorUserId, projectCode));
    if (!rec) throw new GrantError(404, "40450", "授权申请不存在");
    return rec;
  }

  private ctx(rec: GrantRecord): AuthzContext {
    return { authorId: rec.advisorUserId, reviewerId: rec.reviewerId, scope: [], projectCode: rec.projectCode, grantedScopes: [] };
  }

  private move(rec: GrantRecord, event: Parameters<typeof authorizationMachine.transition>[2], ctx: ReturnType<AuthorizationService["ctx"]>): GrantRecord {
    const out = authorizationMachine.transition(ctx, rec.state, event);
    if (!out.ok || !out.to) throw new GrantError(409, out.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (out.code ?? "40901"), out.reason ?? "状态迁移被拒绝");
    rec.state = out.to;
    rec.updatedAt = new Date().toISOString();
    this.grants.set(this.key(rec.advisorUserId, rec.projectCode), { ...rec });
    return rec;
  }
}
