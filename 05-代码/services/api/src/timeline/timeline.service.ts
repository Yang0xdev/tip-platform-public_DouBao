import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CaseService } from "../case/case.service.js";

/**
 * M3-04 四级来源时间线与凭据核验门。
 * 四级（颜色+文字+圆点三通道在端上呈现）：
 *  cu 客户提交（蓝）；co 公司审核/动作（紫）；
 *  sp 服务方报告（琥珀，固定后缀“未经官方核验”，永不变 off 除非核验通过另发 off 事件）；
 *  off 已核验官方凭据（绿，含凭据与核验人）。
 * 铁律：
 *  - 服务方门户上传只生成 sp，进 A06 待核验队列；核验通过才另发 off；
 *  - 核验人 ≠ 案件发起人（SoD 服务端校验）；
 *  - “已递交”=co、“已受理”=off，措辞固定不可改写；
 *  - sp 事件任何响应中不可能带 off 标记（level 枚举与 off 字段物理分离）。
 */

export type TimelineLevel = "cu" | "co" | "sp" | "off";

export interface TimelineEvent {
  id: string;
  caseId: string;
  at: string;
  level: TimelineLevel;
  /** 固定措辞类型，如 submitted（已递交/co）、accepted（已受理/off）、report（报告/sp） */
  kind: string;
  title: string;
  detail: string | null;
  /** off 事件：官方凭据引用与核验人（sp 事件结构上不含这两个字段的有效值） */
  evidenceRef: string | null;
  verifierId: string | null;
  /** sp 事件：来源服务方与核验状态 */
  providerId: string | null;
  verification: { state: "pending" | "verified" | "rejected"; note: string | null } | null;
}

class TimelineError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

/** 固定措辞：公司动作与官方节点不可改写 */
const FIXED_WORDING: Record<string, string> = {
  submitted: "已递交",
  accepted: "官方已受理",
  approved: "官方已批准",
  refused: "官方未批准",
  material_submit: "材料已提交",
  material_approved: "材料审核通过"
};

@Injectable()
export class TimelineService implements OnModuleInit {
  private events = new Map<string, TimelineEvent>();
  private seq = 0;

  constructor(
    private readonly cases: CaseService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    const rows = await this.store.listAll<TimelineEvent>("timeline");
    let maxSeq = 0;
    for (const r of rows) {
      this.events.set(r.aggregateId, r.snapshot);
      const n = Number(r.aggregateId.replace("EV-", ""));
      if (n > maxSeq) maxSeq = n;
    }
    this.seq = maxSeq;
  }

  /* ---------------- 事件写入 ---------------- */

  /** cu：客户提交（材料上传等） */
  recordCustomer(caseId: string, kind: string, title: string, actor: string, detail: string | null = null): TimelineEvent {
    return this.append(caseId, "cu", kind, title, actor, { detail });
  }

  /** co：公司审核/动作；固定措辞 kind 映射不可改写 */
  recordCompany(caseId: string, kind: string, actor: string, detail: string | null = null): TimelineEvent {
    const title = FIXED_WORDING[kind] ?? kind;
    return this.append(caseId, "co", kind, title, actor, { detail });
  }

  /** sp：服务方通过门户提交的报告 → 待核验队列（固定后缀由视图层附加） */
  reportFromProvider(
    caseId: string,
    providerId: string,
    body: { kind?: string; title: string; detail?: string },
    actor: string
  ): TimelineEvent {
    if (!this.cases.list().some((c) => c.id === caseId)) throw new TimelineError(404, "42901", "案件不存在");
    if (!body.title?.trim()) throw new TimelineError(422, "42902", "报告标题必填");
    const ev = this.append(caseId, "sp", body.kind || "report", body.title, actor, {
      detail: body.detail ?? null,
      providerId
    });
    ev.verification = { state: "pending", note: null };
    this.persist(ev, actor);
    this.audit.record({ actor, realm: "provider", action: "timeline.sp.report", resource: ev.id, result: "allow", reason: providerId });
    return ev;
  }

  /* ---------------- 核验门（A06-cred） ---------------- */

  verificationQueue(): TimelineEvent[] {
    return [...this.events.values()].filter((e) => e.level === "sp" && e.verification?.state === "pending");
  }

  /** 逐件核验：通过另发 off；不通过保持 sp 并说明；核验人≠发起人 */
  verify(
    spEventId: string,
    body: { decision: "verified" | "rejected"; note?: string; evidenceRef?: string },
    verifier: string
  ): TimelineEvent[] {
    const sp = this.events.get(spEventId);
    if (!sp || sp.level !== "sp") throw new TimelineError(404, "42901", "待核验服务方事件不存在");
    if (sp.verification?.state !== "pending") throw new TimelineError(409, "42904", "该事件已核验");
    const c = this.cases.list().find((x) => x.id === sp.caseId)!;
    if (verifier === c.initiatorId) {
      this.audit.record({ actor: verifier, realm: "staff", action: "timeline.verify", resource: spEventId, result: "deny", reason: "VERIFIER_IS_INITIATOR" });
      throw new TimelineError(409, "42903", "核验人不能是案件发起人");
    }

    if (body.decision === "rejected") {
      sp.verification = { state: "rejected", note: body.note?.trim() ? body.note : "核验未通过" };
      this.persist(sp, verifier);
      this.audit.record({ actor: verifier, realm: "staff", action: "timeline.verify", resource: spEventId, result: "allow", reason: "rejected" });
      return [sp];
    }

    if (!body.evidenceRef) throw new TimelineError(422, "42902", "核验通过须登记官方凭据引用");
    sp.verification = { state: "verified", note: body.note?.trim() ? body.note : null };
    // 另发 off 事件（不就地把 sp 改成 off：sp 记录永久保留其来源级别）
    const off = this.append(sp.caseId, "off", sp.kind, FIXED_WORDING[sp.kind] ?? sp.title, verifier, {
      detail: sp.detail,
      evidenceRef: body.evidenceRef
    });
    this.persist(sp, verifier);
    this.audit.record({ actor: verifier, realm: "staff", action: "timeline.verify", resource: spEventId, result: "allow", reason: off.id });
    return [sp, off];
  }

  /* ---------------- 查询 ---------------- */

  listForCase(caseId: string): TimelineEvent[] {
    return [...this.events.values()].filter((e) => e.caseId === caseId).sort((a, b) => a.at.localeCompare(b.at));
  }

  /** 客户/顾问视图：sp 固定后缀；对客不回内部核验备注 */
  viewForCase(caseId: string, opts: { internal: boolean }) {
    return this.listForCase(caseId).map((e) => {
      const base = {
        id: e.id,
        at: e.at,
        level: e.level,
        kind: e.kind,
        title: e.level === "sp" ? `${e.title}（未经官方核验）` : e.title,
        detail: e.detail,
        evidenceRef: e.level === "off" ? e.evidenceRef : null,
        verifierId: e.level === "off" ? e.verifierId : null
      };
      if (opts.internal) return { ...base, providerId: e.providerId, verification: e.verification };
      // 对客：sp 仅回 pending/已核验的中性状态，不回驳回内部备注
      return {
        ...base,
        verification: e.level === "sp" ? { state: e.verification?.state === "rejected" ? "pending" : e.verification?.state } : null
      };
    });
  }

  /* ---------------- 内部 ---------------- */

  private append(
    caseId: string,
    level: TimelineLevel,
    kind: string,
    title: string,
    actor: string,
    extra: Partial<TimelineEvent>
  ): TimelineEvent {
    if (!this.cases.list().some((c) => c.id === caseId)) throw new TimelineError(404, "42901", "案件不存在");
    this.seq += 1;
    const ev: TimelineEvent = {
      id: `EV-${String(this.seq).padStart(4, "0")}`,
      caseId,
      at: new Date().toISOString(),
      level,
      kind,
      title,
      detail: null,
      evidenceRef: null,
      verifierId: level === "off" ? actor : null,
      providerId: null,
      verification: null,
      ...extra
    };
    this.events.set(ev.id, ev);
    this.persist(ev, actor);
    this.audit.record({ actor, realm: level === "cu" ? "customer" : "staff", action: `timeline.${level}`, resource: ev.id, result: "allow" });
    return ev;
  }

  private persist(e: TimelineEvent, actor: string) {
    if (!this.store?.enabled) return;
    void this.store.save("timeline", e.id, 1, e.level, e as never, actor);
  }
}
