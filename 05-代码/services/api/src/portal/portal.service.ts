import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { portalGrantMachine, type PortalGrantState } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { ProviderService } from "../provider/provider.service.js";
import { CaseService } from "../case/case.service.js";
import { TimelineService } from "../timeline/timeline.service.js";

/**
 * M3-08/09/10 服务方门户：账号、批次授权、受控阅读器、报告凭据。
 * 铁律：
 *  - 账号生命周期随服务方主体（实名 + MFA）；主体停用/终止账号同步停权；
 *  - 授权维度：服务方 × 案件 × 材料范围 × 动作 × 有效期；原件单独审批；
 *  - 可见范围 = 有效批次并集，无全局案件列表，越权冻结规则；
 *  - 受控阅读器：对角水印（姓名+机构+时间）、预签名 ≤2 分钟、无服务端下载端点、
 *    下载产物为带水印 PDF、页面级审计、会话超时离开即清；
 *  - 影印件默认 7–14 天、原件窗口 2h、审批 1 工作日，到期定时回收；
 *  - 报告/凭据提交只产生 sp 时间线事件，核验通过才转 off。
 */

export interface PortalAccount {
  id: string;
  providerId: string;
  login: string;
  name: string;
  realNameVerified: boolean;
  mfaEnabled: boolean;
  state: "active" | "suspended" | "terminated";
  createdAt: string;
}

export interface PortalGrant {
  id: string;
  providerId: string;
  caseId: string;
  materialScopes: string[];
  actions: Array<"roster" | "report_upload" | "material_view">;
  state: PortalGrantState;
  validUntil: string;
  original: { requested: boolean; approved: boolean; windowEndsAt: string | null; verifierId: string | null };
  createdBy: string;
  createdAt: string;
}

export interface ReaderSession {
  id: string;
  grantId: string;
  accountId: string;
  startedAt: string;
  presignExpiresAt: string;
  pageAudit: Array<{ page: number; at: string }>;
  closed: boolean;
}

class PortalError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

const PHOTOCOPY_DAYS = 14;
const ORIGINAL_WINDOW_MS = 2 * 3600_000;
const PRESIGN_MS = 2 * 60_000;
const APPROVAL_MS = 86_400_000;

@Injectable()
export class PortalService implements OnModuleInit {
  private accounts = new Map<string, PortalAccount>();
  private grants = new Map<string, PortalGrant>();
  private sessions = new Map<string, ReaderSession>();
  private aseq = 0;
  private gseq = 0;
  private sseq = 0;

  constructor(
    private readonly providers: ProviderService,
    private readonly cases: CaseService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    for (const [kind, prefix, map] of [
      ["portal_account", "PA-", this.accounts],
      ["portal_grant", "PG-", this.grants],
      ["reader_session", "RS-", this.sessions]
    ] as const) {
      const rows = await this.store.listAll<never>(kind);
      let maxSeq = 0;
      for (const r of rows) {
        const s = r.snapshot as { id: string };
        map.set(s.id, kind === "portal_grant"
          ? ({ ...(r.snapshot as object), state: r.state as PortalGrantState } as never)
          : r.snapshot as never);
        const n = Number(s.id.replace(prefix, ""));
        if (n > maxSeq) maxSeq = n;
      }
      if (kind === "portal_account") this.aseq = maxSeq;
      if (kind === "portal_grant") this.gseq = maxSeq;
      if (kind === "reader_session") this.sseq = maxSeq;
    }
  }

  /* ---------------- 账号 ---------------- */

  openAccount(
    providerId: string,
    body: { login: string; name: string },
    actor: string
  ): PortalAccount {
    const sp = this.providers.list().find((x) => x.id === providerId);
    if (!sp) throw new PortalError(404, "43401", "服务方不存在");
    if (sp.state === "suspended" || sp.state === "terminated")
      throw new PortalError(409, "43403", "主体已停权，不可开通门户账号");
    this.aseq += 1;
    const acc: PortalAccount = {
      id: `PA-${String(this.aseq).padStart(4, "0")}`,
      providerId,
      login: body.login,
      name: body.name,
      realNameVerified: false,
      mfaEnabled: false,
      state: "active",
      createdAt: new Date().toISOString()
    };
    this.accounts.set(acc.id, acc);
    this.persistAcc(acc, actor);
    this.audit.record({ actor, realm: "staff", action: "portal.account.open", resource: acc.id, result: "allow", reason: providerId });
    return acc;
  }

  /** 实名 + MFA 两个启用步骤（未完成不可读批次） */
  completeAccountSetup(id: string, step: "realname" | "mfa", actor: string): PortalAccount {
    const acc = this.requireAcc(id);
    if (step === "realname") acc.realNameVerified = true;
    else acc.mfaEnabled = true;
    this.persistAcc(acc, actor);
    return acc;
  }

  syncAccountState(providerId: string, state: PortalAccount["state"], actor: string) {
    for (const acc of this.accounts.values()) {
      if (acc.providerId === providerId && acc.state === "active") {
        acc.state = state;
        this.persistAcc(acc, actor);
      }
    }
  }

  /* ---------------- 批次授权 ---------------- */

  createGrant(
    providerId: string,
    caseId: string,
    body: { materialScopes: string[]; actions: PortalGrant["actions"]; validUntil?: string },
    actor: string
  ): PortalGrant {
    this.providers.assertUsable(providerId);
    if (!this.cases.list().some((c) => c.id === caseId))
      throw new PortalError(404, "43401", "案件不存在");
    if (!Array.isArray(body.materialScopes) || body.materialScopes.length === 0)
      throw new PortalError(422, "43402", "材料范围最小化，至少逐项指定一项");
    this.gseq += 1;
    const now = new Date().toISOString();
    const g: PortalGrant = {
      id: `PG-${String(this.gseq).padStart(4, "0")}`,
      providerId,
      caseId,
      materialScopes: body.materialScopes,
      actions: body.actions,
      state: "pending",
      validUntil: body.validUntil ?? new Date(Date.now() + PHOTOCOPY_DAYS * 86_400_000).toISOString(),
      original: { requested: false, approved: false, windowEndsAt: null, verifierId: null },
      createdBy: actor,
      createdAt: now
    };
    this.grants.set(g.id, g);
    this.persistGrant(g, actor);
    this.audit.record({ actor, realm: "staff", action: "portal.grant.create", resource: g.id, result: "allow" });
    return g;
  }

  /** 批准影印件查看（合规/案件岗） */
  approveView(id: string, actor: string): PortalGrant {
    const g = this.requireGrant(id);
    const out = portalGrantMachine.transition(null, g.state, "approve_view");
    if (!out.ok) throw new PortalError(409, "43403", out.reason ?? "当前状态不可批准");
    g.state = out.to as PortalGrantState;
    this.persistGrant(g, actor);
    this.audit.record({ actor, realm: "staff", action: "portal.grant.view", resource: id, result: "allow" });
    return g;
  }

  /** 原件：单独申请 → 单独审批 → 2h 窗口 */
  requestOriginal(id: string, actor: string): PortalGrant {
    const g = this.requireGrant(id);
    const out = portalGrantMachine.transition(null, g.state, "request_download");
    if (!out.ok) throw new PortalError(409, "43403", out.reason ?? "当前状态不可申请原件");
    g.state = out.to as PortalGrantState;
    g.original.requested = true;
    this.persistGrant(g, actor);
    return g;
  }

  approveOriginal(id: string, verifier: string): PortalGrant {
    const g = this.requireGrant(id);
    const out = portalGrantMachine.transition(null, g.state, "approve_download");
    if (!out.ok) throw new PortalError(409, "43403", out.reason ?? "当前状态不可批准原件");
    const now = new Date().toISOString();
    g.state = out.to as PortalGrantState;
    g.original.approved = true;
    g.original.verifierId = verifier;
    g.original.windowEndsAt = new Date(Date.now() + ORIGINAL_WINDOW_MS).toISOString();
    this.persistGrant(g, verifier);
    this.audit.record({ actor: verifier, realm: "staff", action: "portal.grant.original", resource: id, result: "allow" });
    return g;
  }

  revokeGrant(id: string, reason: string, actor: string): PortalGrant {
    const g = this.requireGrant(id);
    const out = portalGrantMachine.transition(null, g.state, "revoke");
    if (!out.ok) throw new PortalError(409, "43403", out.reason ?? "当前状态不可撤回");
    g.state = out.to as PortalGrantState;
    this.persistGrant(g, actor);
    this.audit.record({ actor, realm: "staff", action: "portal.grant.revoke", resource: id, result: "allow", reason });
    return g;
  }

  /** 时钟：到期回收（影印有效期/原件窗口） */
  tick(nowIso: string): string[] {
    const hit: string[] = [];
    for (const g of this.grants.values()) {
      if (g.state === "expired" || g.state === "revoked") continue;
      let expire = g.validUntil <= nowIso;
      if (g.state === "download_window" && g.original.windowEndsAt && g.original.windowEndsAt <= nowIso) expire = true;
      if (expire) {
        const out = portalGrantMachine.transition(null, g.state, "expire");
        if (out.ok) {
          g.state = out.to as PortalGrantState;
          this.persistGrant(g, "system");
          hit.push(g.id);
        }
      }
    }
    return hit;
  }

  /* ---------------- 可见范围（无全局列表） ---------------- */

  visibleCases(accountId: string): Array<{ caseId: string; scopes: string[]; actions: string[] }> {
    const acc = this.requireAcc(accountId);
    if (!acc.realNameVerified || !acc.mfaEnabled) return [];
    const map = new Map<string, { caseId: string; scopes: Set<string>; actions: Set<string> }>();
    for (const g of this.grants.values()) {
      if (g.providerId !== acc.providerId) continue;
      if (g.state !== "viewable" && g.state !== "download_window") continue;
      if (g.validUntil <= new Date().toISOString()) continue;
      if (!map.has(g.caseId)) map.set(g.caseId, { caseId: g.caseId, scopes: new Set(), actions: new Set() });
      const row = map.get(g.caseId)!;
      g.materialScopes.forEach((s) => row.scopes.add(s));
      g.actions.forEach((a) => row.actions.add(a));
    }
    return [...map.values()].map((r) => ({ caseId: r.caseId, scopes: [...r.scopes], actions: [...r.actions] }));
  }

  /** 越权门：访问具体材料/提交动作前逐件校验 */
  assertInScope(accountId: string, caseId: string, scope: string, action: string): PortalGrant {
    const acc = this.requireAcc(accountId);
    const g = [...this.grants.values()].find(
      (x) =>
        x.providerId === acc.providerId &&
        x.caseId === caseId &&
        (x.state === "viewable" || x.state === "download_window") &&
        x.validUntil > new Date().toISOString() &&
        x.materialScopes.includes(scope) &&
        x.actions.includes(action as never)
    );
    if (!g) {
      this.audit.record({ actor: acc.login, realm: "provider", action: "portal.scope.deny", resource: `${caseId}:${scope}:${action}`, result: "deny" });
      throw new PortalError(403, "43405", "越权访问已拒绝并冻结该尝试");
    }
    return g;
  }

  /* ---------------- 受控阅读器 ---------------- */

  openReader(accountId: string, caseId: string, scope: string): { session: ReaderSession; watermark: { name: string; org: string } } {
    const g = this.assertInScope(accountId, caseId, scope, "material_view");
    // 原件须处于下载窗口
    const isOriginal = scope.startsWith("original:");
    if (isOriginal && (g.state !== "download_window" || !g.original.windowEndsAt || g.original.windowEndsAt <= new Date().toISOString()))
      throw new PortalError(403, "43405", "原件窗口未开启或已结束");
    this.sseq += 1;
    const now = new Date().toISOString();
    const s: ReaderSession = {
      id: `RS-${String(this.sseq).padStart(4, "0")}`,
      grantId: g.id,
      accountId,
      startedAt: now,
      presignExpiresAt: new Date(Date.now() + PRESIGN_MS).toISOString(),
      pageAudit: [],
      closed: false
    };
    this.sessions.set(s.id, s);
    this.persistSession(s, accountId);
    const sp = this.providers.list().find((x) => x.id === g.providerId)!;
    const acc = this.requireAcc(accountId);
    this.audit.record({ actor: acc.login, realm: "provider", action: "portal.reader.open", resource: s.id, result: "allow", reason: scope });
    return { session: s, watermark: { name: acc.name, org: sp.name } };
  }

  /** 翻页逐页审计；预签名过期即拒（须重新 open，旧会话不留缓存） */
  viewPage(sessionId: string, page: number, actor: string): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.closed) throw new PortalError(409, "43403", "阅读会话已关闭");
    if (s.presignExpiresAt <= new Date().toISOString()) {
      s.closed = true;
      this.persistSession(s, actor);
      throw new PortalError(403, "43405", "预签名已过期，请重新打开（非故障）");
    }
    s.pageAudit.push({ page, at: new Date().toISOString() });
    this.persistSession(s, actor);
  }

  closeReader(sessionId: string, actor: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.closed = true;
    this.persistSession(s, actor);
  }

  /** 带水印 PDF 是唯一“下载”形态（无裸文件下载端点） */
  requestWatermarkedPdf(accountId: string, caseId: string, scope: string): { artifactRef: string; mark: string } {
    const g = this.assertInScope(accountId, caseId, scope, "material_view");
    const acc = this.requireAcc(accountId);
    const sp = this.providers.list().find((x) => x.id === g.providerId)!;
    const mark = `${acc.name} · ${sp.name} · ${new Date().toISOString()}`;
    this.audit.record({ actor: acc.login, realm: "provider", action: "portal.pdf.watermark", resource: `${caseId}:${scope}`, result: "allow" });
    return { artifactRef: `L3://watermarked/${g.id}.pdf`, mark };
  }

  /* ---------------- 报告凭据提交（→ sp 时间线） ---------------- */

  submitReport(
    accountId: string,
    caseId: string,
    body: { kind: string; title: string; detail?: string },
    actor: string
  ) {
    const g = this.assertInScope(accountId, caseId, "report", "report_upload");
    const acc = this.requireAcc(accountId);
    const ev = this.timeline.reportFromProvider(caseId, g.providerId, body, acc.login);
    return ev;
  }

  /* ---------------- 查询 ---------------- */

  listGrants(providerId?: string): PortalGrant[] {
    return [...this.grants.values()].filter((g) => !providerId || g.providerId === providerId);
  }

  listAccounts(providerId?: string): PortalAccount[] {
    return [...this.accounts.values()].filter((a) => !providerId || a.providerId === providerId);
  }

  /* ---------------- 内部 ---------------- */

  private requireAcc(id: string): PortalAccount {
    const a = this.accounts.get(id);
    if (!a) throw new PortalError(404, "43401", "门户账号不存在");
    return a;
  }

  private requireGrant(id: string): PortalGrant {
    const g = this.grants.get(id);
    if (!g) throw new PortalError(404, "43401", "批次授权不存在");
    return g;
  }

  private persistAcc(a: PortalAccount, actor: string) {
    if (this.store?.enabled) void this.store.save("portal_account", a.id, 1, a.state, a as never, actor);
  }

  private persistGrant(g: PortalGrant, actor: string) {
    if (this.store?.enabled) void this.store.save("portal_grant", g.id, 1, g.state, g as never, actor);
  }

  private persistSession(s: ReaderSession, actor: string) {
    if (this.store?.enabled) void this.store.save("reader_session", s.id, 1, s.closed ? "closed" : "open", s as never, actor);
  }
}
