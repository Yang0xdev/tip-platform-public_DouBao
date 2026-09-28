import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  consentMachine,
  guardianshipMachine,
  type ConsentState,
  type GuardianshipState
} from "@tip/core";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CaseService } from "../case/case.service.js";

/**
 * M3-05 家庭授权与监护（Consent）。
 * 统一模型：主体 Person × 对象（案件）× 动作 Action × 有效期 × 授予方式。
 * 铁律：
 *  - 成年成员动作逐项本人勾选（主申不可代勾）；邀请只产生 pending_self；
 *  - 未成年子女须监护证据核验通过才可代理；争议（离异/收养/身故）系统不判定，只冻结转人工；
 *  - 撤回/过期服务端逐项即时生效，进行中当次审核可完成、不扩展新范围；
 *  - 跨境共享单独同意、不捆绑、最小清单、可一键回收；D9 路径未确认前只保留同意记录结构。
 */

export const CONSENT_ACTIONS = [
  "progress:view",
  "material:view_submit",
  "matter:confirm",
  "notice:receive"
] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

const MAX_VALIDITY_DAYS = 730;

export interface ActionGrant {
  action: ConsentAction;
  grantedAt: string | null;
}

export interface ConsentGrant {
  id: string;
  caseId: string;
  personRef: string;
  state: ConsentState;
  actions: ActionGrant[];
  validUntil: string | null;
  channel: "self" | "paper";
  invitedAt: string | null;
  confirmedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  paper: { artifactRef: string; verifierId: string; verifiedAt: string } | null;
  createdAt: string;
}

export interface GuardianshipRecord {
  id: string;
  caseId: string;
  childRef: string;
  state: GuardianshipState;
  evidence: { artifactRef: string; fileHash: string; submittedAt: string; verifierId: string | null; verifiedAt: string | null };
  dispute: { reason: string; at: string } | null;
  createdAt: string;
}

export interface CrossBorderConsent {
  id: string;
  caseId: string;
  customerRef: string;
  providerId: string;
  items: Array<{ scope: string; granted: boolean; grantedAt: string | null }>;
  grantedAt: string | null;
  revokedAt: string | null;
}

class ConsentError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class ConsentService implements OnModuleInit {
  private grants = new Map<string, ConsentGrant>();
  private guardians = new Map<string, GuardianshipRecord>();
  private cross = new Map<string, CrossBorderConsent>();
  private seq = 0;
  private gseq = 0;
  private cseq = 0;

  constructor(
    private readonly cases: CaseService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    for (const [kind, map, prefix] of [
      ["consent", this.grants, "CON-"],
      ["guardianship", this.guardians, "GRD-"],
      ["cross_border_consent", this.cross, "CBC-"]
    ] as const) {
      const rows = await this.store.listAll<never>(kind);
      let maxSeq = 0;
      for (const r of rows) {
        map.set(r.aggregateId, r.snapshot as never);
        const n = Number(r.aggregateId.replace(prefix, ""));
        if (n > maxSeq) maxSeq = n;
      }
      if (kind === "consent") this.seq = maxSeq;
      if (kind === "guardianship") this.gseq = maxSeq;
      if (kind === "cross_border_consent") this.cseq = maxSeq;
    }
  }

  /* ---------------- 成年成员：邀请 → 本人确认 ---------------- */

  invite(caseId: string, personRef: string, actor: string): ConsentGrant {
    const c = this.requireCase(caseId);
    if (actor !== c.customerRef) throw new ConsentError(403, "43004", "仅主申可发起家庭成员邀请");
    if (!c.applicants.some((a) => a.ref === personRef && a.role !== "primary"))
      throw new ConsentError(422, "43002", "被邀请人须先加入案件申请人列表");
    const existing = [...this.grants.values()].find((g) => g.caseId === caseId && g.personRef === personRef);
    if (existing && existing.state !== "revoked")
      throw new ConsentError(409, "43003", "该成员已有邀请或授权");

    this.seq += 1;
    const now = new Date().toISOString();
    const g: ConsentGrant = {
      id: `CON-${String(this.seq).padStart(4, "0")}`,
      caseId,
      personRef,
      state: "pending_self",
      actions: CONSENT_ACTIONS.map((action) => ({ action, grantedAt: null })),
      validUntil: null,
      channel: "self",
      invitedAt: now,
      confirmedAt: null,
      revokedAt: null,
      revokeReason: null,
      paper: null,
      createdAt: now
    };
    this.grants.set(g.id, g);
    this.persist(g, actor);
    this.audit.record({ actor, realm: "customer", action: "consent.invite", resource: g.id, result: "allow", reason: personRef });
    return g;
  }

  /** 成员本人逐项勾选动作与有效期 → active；主申代勾一律拒绝 */
  selfConfirm(
    grantId: string,
    body: { actions: ConsentAction[]; validUntil: string },
    actor: string
  ): ConsentGrant {
    const g = this.requireGrant(grantId);
    if (actor !== g.personRef) {
      this.audit.record({ actor, realm: "customer", action: "consent.self_confirm", resource: grantId, result: "deny", reason: "非本人" });
      throw new ConsentError(403, "43004", "须由成员本人确认，不可代签");
    }
    const out = consentMachine.transition(null, g.state, "self_confirm");
    if (!out.ok) throw new ConsentError(409, "43003", out.reason ?? "当前状态不可确认");
    if (!Array.isArray(body.actions) || body.actions.length === 0)
      throw new ConsentError(422, "43002", "至少逐项勾选一项动作");
    for (const a of body.actions) {
      if (!CONSENT_ACTIONS.includes(a)) throw new ConsentError(422, "43002", `未知动作 ${a}`);
      const row = g.actions.find((x) => x.action === a)!;
      row.grantedAt = new Date().toISOString();
    }
    this.assertValidity(body.validUntil);
    const now = new Date().toISOString();
    g.state = out.to as ConsentState;
    g.validUntil = body.validUntil;
    g.confirmedAt = now;
    this.persist(g, actor);
    this.audit.record({ actor, realm: "customer", action: "consent.self_confirm", resource: grantId, result: "allow" });
    return g;
  }

  /** 例外通道：成年成员确无法本人操作 → 线下授权书受控登记（原件 L3 + 核验人 + 有效期） */
  registerPaper(
    caseId: string,
    personRef: string,
    body: { artifactRef: string; actions: ConsentAction[]; validUntil: string; verifierId: string },
    actor: string
  ): ConsentGrant {
    const c = this.requireCase(caseId);
    if (!c.applicants.some((a) => a.ref === personRef && a.role !== "primary"))
      throw new ConsentError(422, "43002", "被授权人须先加入案件申请人列表");
    if (!body.artifactRef || !body.verifierId) throw new ConsentError(422, "43002", "线下授权书引用与核验人必填");
    if (!Array.isArray(body.actions) || body.actions.length === 0)
      throw new ConsentError(422, "43002", "至少逐项登记一项动作");
    this.assertValidity(body.validUntil);
    this.seq += 1;
    const now = new Date().toISOString();
    const g: ConsentGrant = {
      id: `CON-${String(this.seq).padStart(4, "0")}`,
      caseId,
      personRef,
      state: "active",
      actions: CONSENT_ACTIONS.map((action) => ({
        action,
        grantedAt: body.actions.includes(action) ? now : null
      })),
      validUntil: body.validUntil,
      channel: "paper",
      invitedAt: null,
      confirmedAt: now,
      revokedAt: null,
      revokeReason: null,
      paper: { artifactRef: body.artifactRef, verifierId: body.verifierId, verifiedAt: now },
      createdAt: now
    };
    this.grants.set(g.id, g);
    this.persist(g, actor);
    this.audit.record({ actor, realm: "staff", action: "consent.paper.register", resource: g.id, result: "allow", reason: personRef });
    return g;
  }

  /** 撤回：逐项即时生效（本人或合规岗） */
  revoke(grantId: string, reason: string, actor: string, realm: "customer" | "staff"): ConsentGrant {
    const g = this.requireGrant(grantId);
    if (realm === "customer" && actor !== g.personRef)
      throw new ConsentError(403, "43004", "仅授权人本人可撤回");
    if (!reason?.trim()) throw new ConsentError(422, "43002", "撤回须填写原因");
    const out = consentMachine.transition(null, g.state, "revoke");
    if (!out.ok) throw new ConsentError(409, "43003", out.reason ?? "当前状态不可撤回");
    const now = new Date().toISOString();
    g.state = out.to as ConsentState;
    g.revokedAt = now;
    g.revokeReason = reason;
    this.persist(g, actor);
    this.audit.record({ actor, realm, action: "consent.revoke", resource: grantId, result: "allow", reason });
    return g;
  }

  /** 到期：时钟驱动 */
  expireGrants(nowIso: string): string[] {
    const hit: string[] = [];
    for (const g of this.grants.values()) {
      if ((g.state === "active" || g.state === "pending_self") && g.validUntil && g.validUntil <= nowIso) {
        const out = consentMachine.transition(null, g.state, "expire");
        if (out.ok) {
          g.state = out.to as ConsentState;
          this.persist(g, "system");
          hit.push(g.id);
        }
      }
    }
    return hit;
  }

  /** 执行点：成年成员动作授权校验（材料/进度等域调用） */
  assertAction(caseId: string, personRef: string, action: ConsentAction): ConsentGrant {
    const g = [...this.grants.values()].find((x) => x.caseId === caseId && x.personRef === personRef);
    if (!g || g.state !== "active" || (g.validUntil && g.validUntil <= new Date().toISOString()))
      throw new ConsentError(403, "43006", "授权已撤回/过期或不存在");
    const row = g.actions.find((x) => x.action === action);
    if (!row || !row.grantedAt) throw new ConsentError(403, "43006", `未授权动作 ${action}`);
    return g;
  }

  /* ---------------- 未成年子女：监护证据 ---------------- */

  submitGuardianshipEvidence(
    caseId: string,
    childRef: string,
    body: { artifactRef: string; fileHash: string },
    actor: string
  ): GuardianshipRecord {
    const c = this.requireCase(caseId);
    if (actor !== c.customerRef) throw new ConsentError(403, "43004", "仅主申可登记监护证据");
    if (!c.applicants.some((a) => a.ref === childRef && a.role === "child"))
      throw new ConsentError(422, "43002", "对象须为案件中的未成年子女");
    if (!body.artifactRef || !body.fileHash) throw new ConsentError(422, "43002", "监护证据引用必填");
    this.gseq += 1;
    const now = new Date().toISOString();
    const r: GuardianshipRecord = {
      id: `GRD-${String(this.gseq).padStart(4, "0")}`,
      caseId,
      childRef,
      state: "evidence_pending",
      evidence: { artifactRef: body.artifactRef, fileHash: body.fileHash, submittedAt: now, verifierId: null, verifiedAt: null },
      dispute: null,
      createdAt: now
    };
    this.guardians.set(r.id, r);
    this.persist(r, actor);
    this.audit.record({ actor, realm: "customer", action: "guardianship.evidence", resource: r.id, result: "allow" });
    return r;
  }

  verifyGuardianship(id: string, verifier: string): GuardianshipRecord {
    const r = this.requireGuardian(id);
    const out = guardianshipMachine.transition(null, r.state, "verify");
    if (!out.ok) throw new ConsentError(409, "43003", out.reason ?? "当前状态不可核验");
    const now = new Date().toISOString();
    r.state = out.to as GuardianshipState;
    r.evidence.verifierId = verifier;
    r.evidence.verifiedAt = now;
    this.persist(r, verifier);
    this.audit.record({ actor: verifier, realm: "staff", action: "guardianship.verify", resource: id, result: "allow" });
    return r;
  }

  raiseGuardianshipDispute(id: string, reason: string, actor: string): GuardianshipRecord {
    const r = this.requireGuardian(id);
    if (!reason?.trim()) throw new ConsentError(422, "43002", "争议须填写说明");
    const out = guardianshipMachine.transition(null, r.state, "raise_dispute");
    if (!out.ok) throw new ConsentError(409, "43003", out.reason ?? "当前状态不可登记争议");
    const now = new Date().toISOString();
    r.state = out.to as GuardianshipState;
    r.dispute = { reason, at: now };
    this.persist(r, actor);
    this.audit.record({ actor, realm: "staff", action: "guardianship.dispute", resource: id, result: "allow", reason });
    return r;
  }

  resubmitGuardianship(
    id: string,
    body: { artifactRef: string; fileHash: string },
    actor: string
  ): GuardianshipRecord {
    const r = this.requireGuardian(id);
    const out = guardianshipMachine.transition(null, r.state, "resubmit");
    if (!out.ok) throw new ConsentError(409, "43003", out.reason ?? "当前状态不可重交");
    const now = new Date().toISOString();
    r.state = out.to as GuardianshipState;
    r.evidence = { ...r.evidence, artifactRef: body.artifactRef, fileHash: body.fileHash, submittedAt: now, verifierId: null, verifiedAt: null };
    r.dispute = null;
    this.persist(r, actor);
    return r;
  }

  /** 执行点：代理子女材料须监护核验通过；争议/缺失拒绝 */
  assertCanActForChild(caseId: string, childRef: string): GuardianshipRecord {
    const r = [...this.guardians.values()].find((x) => x.caseId === caseId && x.childRef === childRef);
    if (!r) throw new ConsentError(403, "43005", "缺少监护证据，不可代子女提交");
    if (r.state === "dispute_frozen") throw new ConsentError(403, "43005", "监护争议已冻结，转人工处理");
    if (r.state !== "verified") throw new ConsentError(403, "43005", "监护证据待核验");
    return r;
  }

  /* ---------------- 跨境共享单独同意（结构先行，D9） ---------------- */

  recordCrossBorder(
    caseId: string,
    providerId: string,
    items: Array<{ scope: string }>,
    customerRef: string
  ): CrossBorderConsent {
    const c = this.requireCase(caseId);
    if (customerRef !== c.customerRef) throw new ConsentError(403, "43004", "仅主申可作跨境共享同意");
    if (!Array.isArray(items) || items.length === 0)
      throw new ConsentError(422, "43002", "跨境清单最小化，至少逐项确认");
    this.cseq += 1;
    const now = new Date().toISOString();
    const rec: CrossBorderConsent = {
      id: `CBC-${String(this.cseq).padStart(4, "0")}`,
      caseId,
      customerRef,
      providerId,
      items: items.map((i) => ({ scope: i.scope, granted: true, grantedAt: now })),
      grantedAt: now,
      revokedAt: null
    };
    this.cross.set(rec.id, rec);
    this.persist(rec, customerRef);
    this.audit.record({ actor: customerRef, realm: "customer", action: "crossborder.consent", resource: rec.id, result: "allow", reason: providerId });
    return rec;
  }

  revokeCrossBorder(id: string, actor: string): CrossBorderConsent {
    const rec = this.cross.get(id);
    if (!rec) throw new ConsentError(404, "43001", "跨境同意记录不存在");
    if (actor !== rec.customerRef) throw new ConsentError(403, "43004", "仅本人可回收");
    rec.revokedAt = new Date().toISOString();
    rec.items.forEach((i) => {
      i.granted = false;
      i.grantedAt = null;
    });
    this.persist(rec, actor);
    this.audit.record({ actor, realm: "customer", action: "crossborder.revoke", resource: id, result: "allow" });
    return rec;
  }

  /* ---------------- 查询 ---------------- */

  listGrantsForCase(caseId: string): ConsentGrant[] {
    return [...this.grants.values()].filter((g) => g.caseId === caseId);
  }

  listGuardiansForCase(caseId: string): GuardianshipRecord[] {
    return [...this.guardians.values()].filter((g) => g.caseId === caseId);
  }

  /* ---------------- 内部 ---------------- */

  private assertValidity(validUntil: string) {
    const t = Date.parse(validUntil);
    if (Number.isNaN(t)) throw new ConsentError(422, "43002", "有效期格式无效");
    if (t - Date.now() > MAX_VALIDITY_DAYS * 86_400_000)
      throw new ConsentError(422, "43002", `有效期最长 ${MAX_VALIDITY_DAYS} 天`);
  }

  private requireCase(caseId: string) {
    const c = this.cases.list().find((x) => x.id === caseId);
    if (!c) throw new ConsentError(404, "43001", "案件不存在");
    return c;
  }

  private requireGrant(id: string): ConsentGrant {
    const g = this.grants.get(id);
    if (!g) throw new ConsentError(404, "43001", "授权不存在");
    return g;
  }

  private requireGuardian(id: string): GuardianshipRecord {
    const r = this.guardians.get(id);
    if (!r) throw new ConsentError(404, "43001", "监护记录不存在");
    return r;
  }

  private persist(snapshot: unknown, actor: string) {
    if (!this.store?.enabled) return;
    const s = snapshot as { id: string; state: string };
    const kind = s.id.startsWith("CON-")
      ? "consent"
      : s.id.startsWith("GRD-")
        ? "guardianship"
        : "cross_border_consent";
    void this.store.save(kind, s.id, 1, s.state, snapshot as never, actor);
  }
}
