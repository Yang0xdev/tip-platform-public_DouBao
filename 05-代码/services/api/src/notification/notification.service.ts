import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { deliveryMachine, type DeliveryState } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CaseService } from "../case/case.service.js";
import type { TaskRecord } from "../task/task.service.js";

/**
 * M3-06 T0/T1 通知引擎与送达回执。
 * 铁律：
 *  - 模板版本化 + 四眼审核，未发布模板不可发送；
 *  - T0 通道签约时采集、可改不可全关（全关拒绝+审计）；锁屏/推送摘要不含案号项目细节；
 *  - 送达状态机：pending→sent→delivered→read；失败换道、人工、升级；
 *  - 换道链初始参数：App 首发 → 2h 未读短信 → 当日未达人工电话 → 距截止 ≤4h 未触达本人直升级主管；
 *    家属代接继续升级；升级不改截止；
 *  - T0 只能由任务自动触发，个人手工发 T0 一律拒绝；后台与客户同一份回执。
 */

export type Channel = "app" | "sms" | "email" | "call";

export interface NotificationTemplate {
  id: string;
  code: string;
  version: number;
  state: "draft" | "pending_review" | "published" | "suspended";
  category: "t0" | "t1" | "general";
  title: string;
  body: string;
  /** 锁屏/推送安全摘要：不含案号、项目名 */
  safeSummary: string;
  channels: Channel[];
  authorId: string;
  reviewerId: string | null;
  createdAt: string;
}

export interface DeliveryAttempt {
  channel: Channel;
  at: string;
  outcome: "sent" | "delivered" | "read" | "failed";
  detail: string | null;
}

export interface DeliveryRecord {
  id: string;
  caseId: string;
  taskId: string | null;
  templateCode: string;
  category: "t0" | "t1" | "general";
  recipientRef: string;
  channel: Channel;
  state: DeliveryState;
  attempts: DeliveryAttempt[];
  chain: Channel[];
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  escalatedTo: string | null;
  note: string | null;
  createdAt: string;
}

export interface ChannelPrefs {
  app: boolean;
  sms: boolean;
  email: boolean;
}

class NotificationError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

const APP_UNREAD_MS = 2 * 3600_000;
const ESCALATE_BEFORE_MS = 4 * 3600_000;

@Injectable()
export class NotificationService implements OnModuleInit {
  private templates = new Map<string, NotificationTemplate>();
  private deliveries = new Map<string, DeliveryRecord>();
  private prefs = new Map<string, ChannelPrefs>(); // caseId → prefs
  private tseq = 0;
  private dseq = 0;

  constructor(
    private readonly cases: CaseService,
    private readonly audit: AuditService,
    private readonly store?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.store?.enabled) return;
    for (const [kind, prefix] of [
      ["notification_template", "NTT-"],
      ["delivery", "DLV-"]
    ] as const) {
      const rows = await this.store.listAll<never>(kind);
      let maxSeq = 0;
      for (const r of rows) {
        const s = r.snapshot as { id: string };
        if (kind === "notification_template") this.templates.set(s.id, r.snapshot as never);
        else this.deliveries.set(s.id, { ...(r.snapshot as object), state: r.state as DeliveryState } as never);
        const n = Number(s.id.replace(prefix, ""));
        if (n > maxSeq) maxSeq = n;
      }
      if (kind === "notification_template") this.tseq = maxSeq;
      else this.dseq = maxSeq;
    }
  }

  /* ---------------- 通道偏好 ---------------- */

  initPrefs(caseId: string): ChannelPrefs {
    if (!this.prefs.has(caseId)) this.prefs.set(caseId, { app: true, sms: true, email: true });
    return this.prefs.get(caseId)!;
  }

  updatePrefs(caseId: string, next: ChannelPrefs, actor: string): ChannelPrefs {
    this.initPrefs(caseId);
    // T0 通道可改不可全关
    if (!next.app && !next.sms && !next.email) {
      this.audit.record({ actor, realm: "customer", action: "notification.prefs", resource: caseId, result: "deny", reason: "ALL_OFF" });
      throw new NotificationError(422, "43105", "T0 关键通知通道不可全部关闭");
    }
    this.prefs.set(caseId, next);
    this.audit.record({ actor, realm: "customer", action: "notification.prefs", resource: caseId, result: "allow" });
    return next;
  }

  getPrefs(caseId: string): ChannelPrefs {
    return this.initPrefs(caseId);
  }

  /* ---------------- 模板四眼 ---------------- */

  createTemplate(
    body: Omit<NotificationTemplate, "id" | "version" | "state" | "reviewerId" | "createdAt">,
    actor: string
  ): NotificationTemplate {
    if (!body.code || !body.title || !body.safeSummary || body.channels.length === 0)
      throw new NotificationError(422, "43102", "模板编码/标题/安全摘要/通道必填");
    if (body.safeSummary.length > 24)
      throw new NotificationError(422, "43102", "锁屏摘要须简短且不含案号项目细节");
    this.tseq += 1;
    const t: NotificationTemplate = {
      ...body,
      id: `NTT-${String(this.tseq).padStart(4, "0")}`,
      version: 1,
      state: "draft",
      reviewerId: null,
      createdAt: new Date().toISOString()
    };
    this.templates.set(t.id, t);
    this.persistT(t, actor);
    return t;
  }

  submitTemplate(id: string, actor: string): NotificationTemplate {
    const t = this.requireT(id);
    if (t.authorId !== actor) throw new NotificationError(403, "43102", "仅编制人可提交审核");
    t.state = "pending_review";
    this.persistT(t, actor);
    return t;
  }

  reviewTemplate(id: string, decision: "published" | "draft", actor: string): NotificationTemplate {
    const t = this.requireT(id);
    if (t.state !== "pending_review") throw new NotificationError(409, "43104", "仅待审核模板可审");
    if (actor === t.authorId) throw new NotificationError(409, "43104", "审核人不能是编制人");
    t.state = decision;
    t.reviewerId = actor;
    this.persistT(t, actor);
    this.audit.record({ actor, realm: "staff", action: "notification.template.review", resource: id, result: "allow", reason: decision });
    return t;
  }

  /* ---------------- 发送（任务自动 / 一般通知） ---------------- */

  /** 由 T0/T1 任务自动触发（TaskService 回调） */
  sendForTask(task: TaskRecord): DeliveryRecord {
    const tpl = [...this.templates.values()].find(
      (t) => t.code === (task.type.startsWith("material:") ? "material_supplement" : `task_${task.type}`) && t.state === "published"
    );
    if (!tpl) throw new NotificationError(409, "43103", `任务 ${task.type} 无已发布通知模板`);
    return this.createDelivery(task.caseId, task.ownerId, tpl, task.id);
  }

  /** 一般通知（general 类别）：允许后台发送；t0/t1 手工一律拒绝 */
  sendManual(caseId: string, templateId: string, recipientRef: string, actor: string): DeliveryRecord {
    const tpl = this.requireT(templateId);
    if (tpl.category !== "general") {
      this.audit.record({ actor, realm: "staff", action: "notification.manual", resource: templateId, result: "deny", reason: tpl.category });
      throw new NotificationError(403, "43106", "T0/T1 通知只能由任务自动触发，不可手工发送");
    }
    return this.createDelivery(caseId, recipientRef, tpl, null, actor);
  }

  private createDelivery(
    caseId: string,
    recipientRef: string,
    tpl: NotificationTemplate,
    taskId: string | null,
    actor = "system"
  ): DeliveryRecord {
    if (!this.cases.list().some((c) => c.id === caseId)) throw new NotificationError(404, "43101", "案件不存在");
    const prefs = this.initPrefs(caseId);
    const channel: Channel = tpl.channels.includes("app") && prefs.app ? "app" : tpl.channels.find((c) => c === "sms" && prefs.sms) ?? "email";
    this.dseq += 1;
    const now = new Date().toISOString();
    const d: DeliveryRecord = {
      id: `DLV-${String(this.dseq).padStart(4, "0")}`,
      caseId,
      taskId,
      templateCode: tpl.code,
      category: tpl.category,
      recipientRef,
      channel,
      state: "sent", // 首发即记录为已发出（模拟通道回执）
      attempts: [{ channel, at: now, outcome: "sent", detail: null }],
      chain: [channel],
      sentAt: now,
      deliveredAt: null,
      readAt: null,
      escalatedTo: null,
      note: null,
      createdAt: now
    };
    this.deliveries.set(d.id, d);
    this.persistD(d, actor);
    this.audit.record({ actor, realm: "staff", action: "notification.send", resource: d.id, result: "allow", reason: tpl.code });
    return d;
  }

  /* ---------------- 客户回执动作 ---------------- */

  markDelivered(id: string, channel: Channel, at = new Date().toISOString()): DeliveryRecord {
    const d = this.requireD(id);
    const out = deliveryMachine.transition(null, d.state, "deliver");
    if (!out.ok) return d;
    d.state = out.to as DeliveryState;
    d.deliveredAt = at;
    d.attempts.push({ channel, at, outcome: "delivered", detail: null });
    this.persistD(d, "system");
    return d;
  }

  markRead(id: string, actor: string): DeliveryRecord {
    const d = this.requireD(id);
    if (actor !== d.recipientRef) throw new NotificationError(403, "43107", "仅收件人可标记已读");
    if (!d.deliveredAt) this.markDelivered(id, d.channel);
    const d2 = this.requireD(id);
    const out = deliveryMachine.transition(null, d2.state, "read");
    if (!out.ok) throw new NotificationError(409, "43104", out.reason ?? "当前状态不可标记已读");
    d2.state = out.to as DeliveryState;
    d2.readAt = new Date().toISOString();
    d2.attempts.push({ channel: d2.channel, at: d2.readAt, outcome: "read", detail: null });
    this.persistD(d2, actor);
    return d2;
  }

  /** 模拟通道失败（短信网关等） */
  markFailed(id: string, detail: string): DeliveryRecord {
    const d = this.requireD(id);
    const out = deliveryMachine.transition(null, d.state, "fail");
    if (!out.ok) return d;
    d.state = out.to as DeliveryState;
    d.note = detail;
    d.attempts.push({ channel: d.channel, at: new Date().toISOString(), outcome: "failed", detail });
    this.persistD(d, "system");
    return d;
  }

  /* ---------------- 服务端时钟：换道 / 人工 / 升级 ---------------- */

  /**
   * @param tasks 当前案件任务快照（由调用方从 TaskService 传入，打破循环依赖）
   * @returns 本轮发生动作的送达记录
   */
  tick(nowIso: string, tasks: TaskRecord[]): DeliveryRecord[] {
    const changed: DeliveryRecord[] = [];
    for (const d of this.deliveries.values()) {
      if (d.state === "escalated") continue;
      const task = d.taskId ? tasks.find((t) => t.id === d.taskId) : null;

      // 1) App 首发 2h 未送达/未读 → 短信
      if (d.channel === "app" && d.state === "sent" && Date.parse(nowIso) - Date.parse(d.sentAt!) >= APP_UNREAD_MS) {
        this.switchTo(d, "sms", nowIso);
        changed.push(d);
        continue;
      }
      // 2) 当日仍未送达 → 人工电话
      const sameDay = new Date(d.sentAt!).toDateString() === new Date(nowIso).toDateString();
      if ((d.state === "sent" || d.state === "failed") && !sameDay) {
        const out = deliveryMachine.transition(null, d.state === "failed" ? "failed" : "channel_switched", "manual_reach");
        if (out.ok) {
          d.state = out.to as DeliveryState;
          d.channel = "call";
          d.chain.push("call");
          d.attempts.push({ channel: "call", at: nowIso, outcome: "sent", detail: "人工外呼" });
          this.persistD(d, "system");
          changed.push(d);
          continue;
        }
      }
      // 3) 距截止 ≤4h 未触达本人（含家属代接）→ 直升级主管
      if (task && Date.parse(task.dueAt) - Date.parse(nowIso) <= ESCALATE_BEFORE_MS && d.state !== "read") {
        const familyAnswered = d.note?.includes("家属代接");
        if (!d.deliveredAt || familyAnswered) {
          const from = d.state === "manual_call" || d.state === "channel_switched" ? d.state : "channel_switched";
          const out = deliveryMachine.transition(null, from as DeliveryState, "escalate");
          if (out.ok) {
            d.state = out.to as DeliveryState;
            d.escalatedTo = "supervisor";
            d.note = familyAnswered ? "家属代接，继续升级" : "未触达本人，升级主管";
            this.persistD(d, "system");
            this.audit.record({ actor: "system", realm: "staff", action: "notification.escalate", resource: d.id, result: "allow", reason: d.note });
            changed.push(d);
          }
        }
      }
    }
    return changed;
  }

  /** 模拟家属代接（人工外呼结果之一）：继续升级 */
  familyAnswered(id: string, nowIso: string): DeliveryRecord {
    const d = this.requireD(id);
    d.note = "家属代接";
    const out = deliveryMachine.transition(null, "manual_call", "escalate");
    if (out.ok) {
      d.state = out.to as DeliveryState;
      d.escalatedTo = "supervisor";
      this.persistD(d, "system");
    }
    return d;
  }

  private switchTo(d: DeliveryRecord, channel: Channel, nowIso: string) {
    let out = deliveryMachine.transition(null, d.state, "switch_channel");
    if (!out.ok) return;
    d.state = out.to as DeliveryState;
    out = deliveryMachine.transition(null, d.state, "send");
    if (!out.ok) return;
    d.state = out.to as DeliveryState;
    d.channel = channel;
    d.chain.push(channel);
    d.sentAt = nowIso;
    d.attempts.push({ channel, at: nowIso, outcome: "sent", detail: null });
    this.persistD(d, "system");
    this.audit.record({ actor: "system", realm: "staff", action: "notification.switch", resource: d.id, result: "allow", reason: channel });
  }

  /* ---------------- 查询 ---------------- */

  listForCase(caseId: string): DeliveryRecord[] {
    return [...this.deliveries.values()].filter((d) => d.caseId === caseId);
  }

  /** 客户视图：同一份回执，仅隐藏内部外呼细节 */
  viewForCustomer(caseId: string, recipientRef: string) {
    return this.listForCase(caseId)
      .filter((d) => d.recipientRef === recipientRef)
      .map(({ note: _n, ...rest }) => rest);
  }

  escalations(): DeliveryRecord[] {
    return [...this.deliveries.values()].filter((d) => d.state === "escalated");
  }

  listTemplates(): NotificationTemplate[] {
    return [...this.templates.values()];
  }

  /* ---------------- 内部 ---------------- */

  private requireT(id: string): NotificationTemplate {
    const t = this.templates.get(id);
    if (!t) throw new NotificationError(404, "43101", "模板不存在");
    return t;
  }

  private requireD(id: string): DeliveryRecord {
    const d = this.deliveries.get(id);
    if (!d) throw new NotificationError(404, "43101", "送达记录不存在");
    return d;
  }

  private persistT(t: NotificationTemplate, actor: string) {
    if (!this.store?.enabled) return;
    void this.store.save("notification_template", t.id, t.version, t.state, t as never, actor);
  }

  private persistD(d: DeliveryRecord, actor: string) {
    if (!this.store?.enabled) return;
    void this.store.save("delivery", d.id, 1, d.state, d as never, actor);
  }
}
