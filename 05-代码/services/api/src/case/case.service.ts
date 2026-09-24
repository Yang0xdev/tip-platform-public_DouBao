import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { caseMachine, type CaseEvent, type CaseState } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import type { OrderRecord } from "../order/order.service.js";

/**
 * M3-01 建案与案件看板。
 * 铁律：
 *  - 合同 effective + 首付 verified（订单 readyForCaseAt）才可建案，一单一案；
 *  - 阶段迁移走 core caseMachine 白名单：官方节点（accepted/approved/refused）
 *    必须挂已核验官方凭据，核验人≠案件发起人（42210/42211）；
 *  - paused/lost_contact/disputed 为并行独立异常记录，不改阶段、不并入处理中；
 *  - 顾问对案件阶段只读（M3-12），写权限在办理/核验岗位。
 */

export const STAGE_LABELS: Record<CaseState, string> = {
  material_prep: "材料准备",
  pending_submit: "待递交",
  submitted: "已递交",
  accepted: "已受理",
  supplementing: "补件中",
  reviewing: "审理中",
  approved: "批准",
  refused: "拒绝",
  closed: "结案"
};

export const BOARD_COLUMNS: CaseState[] = [
  "material_prep",
  "pending_submit",
  "submitted",
  "accepted",
  "supplementing",
  "reviewing",
  "approved",
  "refused",
  "closed"
];

export type ExceptionKind = "paused" | "lost_contact" | "disputed";

export const EXCEPTION_LABELS: Record<ExceptionKind, string> = {
  paused: "暂停",
  lost_contact: "失联",
  disputed: "争议"
};

export interface ExceptionRecord {
  kind: ExceptionKind;
  active: boolean;
  reason: string;
  at: string;
  clearedAt: string | null;
  clearReason: string | null;
}

export interface StageLogEntry {
  from: CaseState;
  to: CaseState;
  event: CaseEvent;
  at: string;
  actor: string;
  evidenceRef: string | null;
}

export interface CaseApplicant {
  ref: string;
  role: "primary" | "spouse" | "child" | "adult_dependent";
}

export interface CaseRecord {
  id: string;
  orderId: string;
  customerRef: string;
  /** 案件发起人（建案时主责顾问，SoD 比对用） */
  initiatorId: string;
  advisorId: string;
  projectCode: string;
  stage: CaseState;
  snapshots: {
    proposalRevision: number;
    feeVersion: number;
    wordVersion: string;
  };
  applicants: CaseApplicant[];
  stageLog: StageLogEntry[];
  exceptions: ExceptionRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseBoard {
  columns: Array<{ stage: CaseState; label: string; cases: CaseRecord[] }>;
  exceptions: Array<{ case: CaseRecord; active: ExceptionRecord[] }>;
}

class CaseError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class CaseService implements OnModuleInit {
  private cases = new Map<string, CaseRecord>();
  private seq = 0;

  constructor(
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    const rows = await this.store.listAll<CaseRecord>("case");
    let maxSeq = 0;
    for (const r of rows) {
      this.cases.set(r.aggregateId, { ...r.snapshot, stage: r.state as CaseState });
      const n = Number(r.aggregateId.replace("CASE-", ""));
      if (n > maxSeq) maxSeq = n;
    }
    this.seq = maxSeq;
  }

  /* ---------------- 建案 ---------------- */

  createFromOrder(o: OrderRecord, actor: string): CaseRecord {
    if (o.contractState !== "effective" || !o.readyForCaseAt)
      throw new CaseError(409, "42701", "合同生效且首付核验通过后才可建案");
    const existing = [...this.cases.values()].find((c) => c.orderId === o.id);
    if (existing) return existing; // 一单一案，幂等

    this.seq += 1;
    const now = new Date().toISOString();
    const c: CaseRecord = {
      id: `CASE-${String(this.seq).padStart(4, "0")}`,
      orderId: o.id,
      customerRef: o.customerRef,
      initiatorId: o.advisorId,
      advisorId: o.advisorId,
      projectCode: o.projectCode,
      stage: "material_prep",
      snapshots: {
        proposalRevision: o.snapshots.proposalRevision,
        feeVersion: o.snapshots.feeVersion,
        wordVersion: o.snapshots.wordVersion
      },
      applicants: [{ ref: o.customerRef, role: "primary" }],
      stageLog: [],
      exceptions: [],
      createdAt: now,
      updatedAt: now
    };
    this.cases.set(c.id, c);
    this.persist(c, actor);
    this.audit.record({ actor, realm: "staff", action: "case.create", resource: c.id, result: "allow", reason: o.id });
    return c;
  }

  /* ---------------- 阶段迁移 ---------------- */

  transition(
    id: string,
    event: CaseEvent,
    actor: string,
    opts: { evidenceRef?: string; verifierId?: string } = {}
  ): CaseRecord {
    const c = this.require(id);
    const evidenceRef = opts.evidenceRef ?? null;
    const ctx = {
      hasOfficialEvidence: !!evidenceRef,
      verifierId: opts.verifierId ?? null,
      initiatorId: c.initiatorId
    };
    const out = caseMachine.transition(ctx, c.stage, event);
    if (!out.ok) {
      const code = out.code === "VERIFIER_IS_INITIATOR" ? "42211" : "42210";
      this.audit.record({ actor, realm: "staff", action: "case.stage", resource: id, result: "deny", reason: out.code });
      throw new CaseError(409, code, out.reason ?? "阶段迁移被拒绝");
    }
    const from = c.stage;
    c.stage = out.to as CaseState;
    c.updatedAt = new Date().toISOString();
    c.stageLog.push({ from, to: c.stage, event, at: c.updatedAt, actor, evidenceRef });
    this.persist(c, actor);
    this.audit.record({ actor, realm: "staff", action: "case.stage", resource: id, result: "allow", reason: `${from}->${c.stage}` });
    return c;
  }

  /* ---------------- 并行异常态 ---------------- */

  setException(id: string, kind: ExceptionKind, reason: string, actor: string): CaseRecord {
    const c = this.require(id);
    if (!reason.trim()) throw new CaseError(400, "42702", "异常登记必须填写原因");
    if (c.exceptions.some((e) => e.kind === kind && e.active))
      throw new CaseError(409, "42703", `该案件已处于「${EXCEPTION_LABELS[kind]}」状态`);
    c.exceptions.push({ kind, active: true, reason, at: new Date().toISOString(), clearedAt: null, clearReason: null });
    c.updatedAt = new Date().toISOString();
    this.persist(c, actor);
    this.audit.record({ actor, realm: "staff", action: "case.exception.set", resource: id, result: "allow", reason: kind });
    return c;
  }

  clearException(id: string, kind: ExceptionKind, reason: string, actor: string): CaseRecord {
    const c = this.require(id);
    const e = c.exceptions.find((x) => x.kind === kind && x.active);
    if (!e) throw new CaseError(409, "42704", `该案件当前无「${EXCEPTION_LABELS[kind]}」异常`);
    if (!reason.trim()) throw new CaseError(400, "42702", "解除异常必须填写原因");
    e.active = false;
    e.clearedAt = new Date().toISOString();
    e.clearReason = reason;
    c.updatedAt = e.clearedAt;
    this.persist(c, actor);
    this.audit.record({ actor, realm: "staff", action: "case.exception.clear", resource: id, result: "allow", reason: kind });
    return c;
  }

  /* ---------------- 看板与查询 ---------------- */

  board(): CaseBoard {
    const all = [...this.cases.values()];
    const columns = BOARD_COLUMNS.map((stage) => ({
      stage,
      label: STAGE_LABELS[stage],
      cases: all.filter((c) => c.stage === stage)
    }));
    const exceptions = all
      .map((c) => ({ case: c, active: c.exceptions.filter((e) => e.active) }))
      .filter((x) => x.active.length > 0);
    return { columns, exceptions };
  }

  list(): CaseRecord[] {
    return [...this.cases.values()];
  }

  listForAdvisor(advisorId: string): CaseRecord[] {
    return this.list().filter((c) => c.advisorId === advisorId);
  }

  listForCustomer(customerRef: string): CaseRecord[] {
    return this.list().filter((c) => c.customerRef === customerRef);
  }

  getScoped(id: string, viewer: { realm: "staff" | "customer"; ref: string }): CaseRecord {
    const c = this.require(id);
    if (viewer.realm === "customer" && c.customerRef !== viewer.ref) {
      this.audit.record({ actor: viewer.ref, realm: "customer", action: "case.view", resource: id, result: "deny", reason: "越权" });
      throw new CaseError(403, "42705", "无权查看该案件");
    }
    if (viewer.realm === "staff" && c.advisorId !== viewer.ref) {
      this.audit.record({ actor: viewer.ref, realm: "staff", action: "case.view", resource: id, result: "deny", reason: "越权" });
      throw new CaseError(403, "42705", "无权查看该案件");
    }
    return c;
  }

  private require(id: string): CaseRecord {
    const c = this.cases.get(id);
    if (!c) throw new CaseError(404, "42700", "案件不存在");
    return c;
  }

  private persist(c: CaseRecord, actor: string) {
    if (!this.store?.enabled) return;
    // 案件为单聚合单行投影（upsert 覆盖最新态）
    void this.store.save("case", c.id, 1, c.stage, c as never, actor);
  }
}
