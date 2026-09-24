import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { taskMachine, type TaskEvent, type TaskState } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CaseService } from "../case/case.service.js";

/**
 * M3-02 任务系统与 T0 时钟。
 * 铁律：
 *  - 截止时间 dueAt 创建后不可被任何升级/编辑动作改写（40910）；
 *    唯一变更路径：官方改期凭据 + 核验通过（reschedule），原截止与原因永久留痕；
 *  - 时钟由服务端 tick 驱动：到期 mark_overdue，逾期只触发升级链，升级逐级记录；
 *  - 任务完成/逾期/升级/改期全部事件化（状态机白名单 + 审计）。
 */

export interface EscalationRecord {
  level: number;
  at: string;
  reason: string;
}

export interface RescheduleRecord {
  oldDueAt: string;
  newDueAt: string;
  reason: string;
  evidenceRef: string;
  verifierId: string;
  at: string;
}

export interface TaskRecord {
  id: string;
  caseId: string;
  type: string;
  title: string;
  ownerId: string;
  dueAt: string;
  source: "official" | "contract" | "sla";
  t0: boolean;
  state: TaskState;
  startedAt: string | null;
  completedAt: string | null;
  escalations: EscalationRecord[];
  reschedules: RescheduleRecord[];
  createdAt: string;
  updatedAt: string;
}

class TaskError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class TaskService implements OnModuleInit {
  private tasks = new Map<string, TaskRecord>();
  private seq = 0;

  constructor(
    private readonly cases: CaseService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    const rows = await this.store.listAll<TaskRecord>("task");
    let maxSeq = 0;
    for (const r of rows) {
      this.tasks.set(r.aggregateId, { ...r.snapshot, state: r.state as TaskState });
      const n = Number(r.aggregateId.replace("TASK-", ""));
      if (n > maxSeq) maxSeq = n;
    }
    this.seq = maxSeq;
  }

  /* ---------------- 创建 ---------------- */

  create(
    caseId: string,
    body: {
      type: string;
      title: string;
      ownerId: string;
      dueAt: string;
      source: TaskRecord["source"];
      t0: boolean;
    },
    actor: string
  ): TaskRecord {
    // 案件须存在（getScoped 以 staff 身份，内部岗位调用不限归属：用 list 校验）
    if (!this.cases.list().some((c) => c.id === caseId)) throw new TaskError(404, "42801", "案件不存在");
    if (!body.title?.trim() || !body.ownerId?.trim()) throw new TaskError(422, "42802", "任务标题与责任人必填");
    if (!body.dueAt || Number.isNaN(Date.parse(body.dueAt))) throw new TaskError(422, "42802", "截止时间格式无效");
    if (body.t0 && body.source !== "official" && body.source !== "contract")
      throw new TaskError(422, "42802", "T0 任务来源须为官方要求或合同约定");

    this.seq += 1;
    const now = new Date().toISOString();
    const t: TaskRecord = {
      id: `TASK-${String(this.seq).padStart(4, "0")}`,
      caseId,
      type: body.type,
      title: body.title,
      ownerId: body.ownerId,
      dueAt: body.dueAt,
      source: body.source,
      t0: body.t0,
      state: "open",
      startedAt: null,
      completedAt: null,
      escalations: [],
      reschedules: [],
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(t.id, t);
    this.persist(t, actor);
    this.audit.record({ actor, realm: "staff", action: "task.create", resource: t.id, result: "allow", reason: caseId });
    return t;
  }

  /* ---------------- 生命周期 ---------------- */

  start(id: string, actor: string): TaskRecord {
    return this.apply(id, "start", actor);
  }

  complete(id: string, actor: string): TaskRecord {
    const t = this.apply(id, "complete", actor);
    t.completedAt = t.updatedAt;
    this.persist(t, actor);
    return t;
  }

  /** 服务端时钟：到期未完成 → overdue（幂等） */
  tick(nowIso: string): string[] {
    const now = Date.parse(nowIso);
    const hit: string[] = [];
    for (const t of this.tasks.values()) {
      if ((t.state === "open" || t.state === "doing") && Date.parse(t.dueAt) <= now) {
        this.apply(t.id, "mark_overdue", "system-clock");
        hit.push(t.id);
      }
    }
    return hit;
  }

  /** 升级：overdue→escalated（多级，逐级留痕）；升级链无 dueAt 写权限 */
  escalate(id: string, reason: string, actor: string): TaskRecord {
    const t = this.require(id);
    if (!reason?.trim()) throw new TaskError(422, "42803", "升级须记录原因");
    const level = t.escalations.length + 1;
    const moved = this.apply(id, "escalate", actor, `L${level}:${reason}`);
    moved.escalations.push({ level, at: moved.updatedAt, reason });
    this.persist(moved, actor);
    return moved;
  }

  /** 改期：唯一可改 dueAt 的路径——官方改期凭据 + 核验通过（核验人≠发起人） */
  reschedule(
    id: string,
    body: { newDueAt: string; reason: string; evidenceRef: string; verifierId: string },
    actor: string
  ): TaskRecord {
    const t = this.require(id);
    if (!body.newDueAt || Number.isNaN(Date.parse(body.newDueAt)))
      throw new TaskError(422, "42802", "新截止时间格式无效");
    if (!body.reason?.trim() || !body.evidenceRef || !body.verifierId)
      throw new TaskError(422, "42803", "改期须填写原因并挂已核验凭据与核验人");
    const c = this.cases.list().find((x) => x.id === t.caseId)!;
    const out = taskMachine.transition(
      { hasOfficialEvidence: true, verifierId: body.verifierId, initiatorId: c.initiatorId },
      t.state,
      "reschedule"
    );
    if (!out.ok) {
      const code = out.code === "VERIFIER_IS_INITIATOR" ? "42211" : "42210";
      this.audit.record({ actor, realm: "staff", action: "task.reschedule", resource: id, result: "deny", reason: out.code });
      throw new TaskError(409, code, out.reason ?? "改期被拒绝");
    }
    const now = new Date().toISOString();
    t.reschedules.push({
      oldDueAt: t.dueAt,
      newDueAt: body.newDueAt,
      reason: body.reason,
      evidenceRef: body.evidenceRef,
      verifierId: body.verifierId,
      at: now
    });
    t.state = out.to as TaskState;
    t.dueAt = body.newDueAt;
    t.updatedAt = now;
    this.persist(t, actor);
    this.audit.record({ actor, realm: "staff", action: "task.reschedule", resource: id, result: "allow", reason: body.reason });
    return t;
  }

  /* ---------------- 查询 ---------------- */

  list(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  listForCase(caseId: string): TaskRecord[] {
    return this.list().filter((t) => t.caseId === caseId);
  }

  listForOwner(ownerId: string): TaskRecord[] {
    return this.list().filter((t) => t.ownerId === ownerId && t.state !== "done");
  }

  overdue(): TaskRecord[] {
    return this.list().filter((t) => t.state === "overdue" || t.state === "escalated");
  }

  /* ---------------- 内部 ---------------- */

  private apply(id: string, event: TaskEvent, actor: string, auditReason?: string): TaskRecord {
    const t = this.require(id);
    const c = this.cases.list().find((x) => x.id === t.caseId)!;
    const out = taskMachine.transition(
      { hasOfficialEvidence: false, verifierId: null, initiatorId: c.initiatorId },
      t.state,
      event
    );
    if (!out.ok) {
      this.audit.record({ actor, realm: "staff", action: `task.${event}`, resource: id, result: "deny", reason: out.code });
      throw new TaskError(409, "42804", out.reason ?? "任务状态迁移被拒绝");
    }
    const now = new Date().toISOString();
    t.state = out.to as TaskState;
    t.updatedAt = now;
    if (event === "start") t.startedAt = now;
    this.persist(t, actor);
    this.audit.record({ actor, realm: "staff", action: `task.${event}`, resource: id, result: "allow", reason: auditReason });
    return t;
  }

  private require(id: string): TaskRecord {
    const t = this.tasks.get(id);
    if (!t) throw new TaskError(404, "42801", "任务不存在");
    return t;
  }

  private persist(t: TaskRecord, actor: string) {
    if (!this.store?.enabled) return;
    void this.store.save("task", t.id, 1, t.state, t as never, actor);
  }
}
