import { Injectable, Optional } from "@nestjs/common";
import { ticketMachine, type TicketState } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { ComplianceEventService } from "../compliance/compliance-event.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";

/**
 * M4-01/02/03/12 工单与投诉
 *  - 普通工单与投诉物理隔离（compliance 队列）；
 *  - 投诉：被投诉人及其汇报链回避；私收款/误导承诺自动转合规线索并冻结被投诉人新增授权；
 *  - SLA：咨询/投诉 1 工作日受理，复杂件 10 工作日调查；超时升级（队列负责人→主管→合规）；
 *  - 官方结果类投诉≠服务失败，结论以服务范围与凭据为准；
 *  - 关闭后由非顾问岗位回访；不认可可申请一次复核（复核人未参与原调查）。
 */

export type TicketKind = "consult" | "question" | "data_change" | "complaint";
export type ComplaintCategory =
  | "service_undelivered"
  | "delivery_quality"
  | "official_outcome"
  | "off_platform_deal";

export interface StatusLog {
  at: string;
  state: TicketState;
  actor: string;
  note?: string;
}

export interface Ticket {
  id: string;
  kind: TicketKind;
  complaintCategory: ComplaintCategory | null;
  respondentAdvisorId: string | null;
  excludedActorIds: string[];
  customerRef: string;
  orderId: string | null;
  caseId: string | null;
  title: string;
  description: string;
  attachments: string[];
  state: TicketState;
  assignedTeam: "customer_service" | "compliance_team" | null;
  assigneeId: string | null;
  investigatorIds: string[];
  acceptDueAt: string;
  resolveDueAt: string | null;
  escalatedTo: string | null;
  reviewRequesterId: string | null;
  originalInvestigatorId: string | null;
  followUpAt: string | null;
  rated: number | null;
  log: StatusLog[];
  createdAt: string;
}

export class TicketError extends Error {
  constructor(status: number, public code: string, message: string) {
    super(message);
  }
}

const DAY = 86_400_000;

@Injectable()
export class TicketService {
  private tickets = new Map<string, Ticket>();
  private seq = 0;
  /** 合规服务后置注入（避免模块循环依赖） */
  private compliance: {
    openFromTicket: (t: Ticket, actor: string) => unknown;
  } | null = null;
  /** 顾问服务后置注入（冻结新增授权） */
  private advisorAdmin: { freezeNewAuthorization: (advisorId: string, reason: string, actor: string) => unknown } | null =
    null;

  constructor(
    private readonly audit: AuditService,
    @Optional() private readonly complianceSvc?: ComplianceEventService,
    @Optional() private readonly grantsSvc?: AuthorizationService
  ) {}

  setCompliance(svc: NonNullable<TicketService["compliance"]>) {
    this.compliance = svc;
  }
  setAdvisorAdmin(svc: NonNullable<TicketService["advisorAdmin"]>) {
    this.advisorAdmin = svc;
  }

  /* ---------------- 客户提交 ---------------- */

  submit(
    body: {
      kind: TicketKind;
      complaintCategory?: ComplaintCategory;
      respondentAdvisorId?: string;
      orderId?: string;
      caseId?: string;
      title: string;
      description: string;
      attachments?: string[];
    },
    customerRef: string
  ): Ticket {
    if (!body.title?.trim() || !body.description?.trim())
      throw new TicketError(422, "43501", "标题与描述必填");
    if (body.attachments?.some((a) => !/\.(jpg|jpeg|pdf)$/i.test(a)))
      throw new TicketError(422, "43502", "附件仅支持 JPG/PDF");
    const isComplaint = body.kind === "complaint";
    if (isComplaint && !body.complaintCategory)
      throw new TicketError(422, "43503", "投诉须选择争议分类");

    this.seq += 1;
    const now = Date.now();
    const respondent = body.respondentAdvisorId ?? null;
    const t: Ticket = {
      id: `TKT-${String(this.seq).padStart(4, "0")}`,
      kind: body.kind,
      complaintCategory: body.complaintCategory ?? null,
      respondentAdvisorId: respondent,
      excludedActorIds: respondent ? [respondent] : [],
      customerRef,
      orderId: body.orderId ?? null,
      caseId: body.caseId ?? null,
      title: body.title,
      description: body.description,
      attachments: body.attachments ?? [],
      state: "submitted",
      assignedTeam: null,
      assigneeId: null,
      investigatorIds: [],
      acceptDueAt: new Date(now + DAY).toISOString(),
      resolveDueAt: null,
      escalatedTo: null,
      reviewRequesterId: null,
      originalInvestigatorId: null,
      followUpAt: null,
      rated: null,
      log: [{ at: new Date(now).toISOString(), state: "submitted", actor: customerRef }],
      createdAt: new Date(now).toISOString()
    };
    this.tickets.set(t.id, t);
    this.audit.record({ realm: "customer", action: "ticket.submit", resource: t.id, result: "info", reason: t.kind, actor: customerRef });

    // 投诉：私收款/误导承诺（off_platform_deal 且无登记订单，或客户明示私收款线索）
    if (isComplaint) {
      const autoTrigger =
        body.complaintCategory === "off_platform_deal" ||
        /私收款|个人账户|私下转账|承诺成功|包成功/.test(body.description);
      if (autoTrigger) {
        (this.compliance ?? this.complianceSvc)?.openFromTicket(t, "system");
        if (respondent)
          (this.advisorAdmin ?? this.grantsSvc)?.freezeNewAuthorization(respondent, "投诉线索自动停新（M4-03）", "system");
      }
    }
    return t;
  }

  /* ---------------- 后台受理/处理 ---------------- */

  private must(id: string): Ticket {
    const t = this.tickets.get(id);
    if (!t) throw new TicketError(404, "43504", "工单不存在");
    return t;
  }

  private move(t: Ticket, event: Parameters<typeof ticketMachine.transition>[2], actor: string, note?: string) {
    const r = ticketMachine.transition(undefined, t.state, event);
    if (!r.ok) throw new TicketError(409, "43505", r.reason ?? "当前状态不允许该操作");
    t.state = r.to!;
    t.log.push({ at: new Date().toISOString(), state: t.state, actor, note });
  }

  /** 受理分派：系统按队列分派，不由顾问挑单；回避校验 */
  accept(id: string, actor: string, opts?: { assigneeId?: string; complex?: boolean }): Ticket {
    const t = this.must(id);
    const isComplaint = t.kind === "complaint";
    const team: Ticket["assignedTeam"] = isComplaint ? "compliance_team" : "customer_service";
    if (opts?.assigneeId) {
      if (t.excludedActorIds.includes(opts.assigneeId))
        throw new TicketError(409, "43506", "被投诉人及其汇报链须回避，不可参与受理/调查");
    }
    this.move(t, "accept", actor);
    t.assignedTeam = team;
    t.assigneeId = opts?.assigneeId ?? actor;
    if (isComplaint) {
      t.investigatorIds.push(t.assigneeId);
      t.originalInvestigatorId = t.assigneeId;
    }
    t.resolveDueAt = new Date(
      Date.parse(t.createdAt) + (isComplaint && opts?.complex ? 10 : 1) * DAY
    ).toISOString();
    this.audit.record({ realm: "staff", action: "ticket.accept", resource: t.id, result: "allow", reason: String(team), actor });
    return t;
  }

  process(id: string, actor: string, note?: string): Ticket {
    const t = this.must(id);
    this.assertHandler(t, actor);
    this.move(t, "process", actor, note);
    return t;
  }

  requestInfo(id: string, actor: string, note: string): Ticket {
    const t = this.must(id);
    this.assertHandler(t, actor);
    if (!note?.trim()) throw new TicketError(422, "43507", "须说明需要补充的信息");
    this.move(t, "request_info", actor, note);
    return t;
  }

  provideInfo(id: string, actor: string, note: string): Ticket {
    const t = this.must(id);
    if (actor !== t.customerRef) throw new TicketError(403, "43508", "仅客户可补充信息");
    this.move(t, "provide_info", actor, note);
    return t;
  }

  resolve(id: string, actor: string, note: string): Ticket {
    const t = this.must(id);
    this.assertHandler(t, actor);
    if (!note?.trim()) throw new TicketError(422, "43509", "须填写处理结果说明（禁止处理中吞异常）");
    this.move(t, "resolve", actor, note);
    return t;
  }

  close(id: string, actor: string): Ticket {
    const t = this.must(id);
    this.assertHandler(t, actor);
    this.move(t, "close", actor);
    // 独立回访由非顾问岗位发起
    if (t.assigneeId && t.kind !== "complaint")
      t.followUpAt = new Date(Date.now() + DAY).toISOString();
    return t;
  }

  rate(id: string, actor: string, score: number): Ticket {
    const t = this.must(id);
    if (actor !== t.customerRef) throw new TicketError(403, "43510", "仅客户可评价");
    if (score < 1 || score > 5) throw new TicketError(422, "43511", "评分 1–5");
    this.move(t, "rate", actor);
    t.rated = score;
    if (score <= 2) {
      // 差评自动生成复核线索（不自动改判）
      t.reviewRequesterId = actor;
      this.audit.record({ realm: "staff", action: "ticket.bad_rating_review_clue", resource: t.id, result: "info", actor: "system" });
    }
    return t;
  }

  requestReview(id: string, actor: string): Ticket {
    const t = this.must(id);
    if (actor !== t.customerRef) throw new TicketError(403, "43512", "仅客户可申请复核");
    this.move(t, "request_review", actor);
    t.reviewRequesterId = actor;
    return t;
  }

  /** 复核：复核人未参与原调查 */
  reviewByNewInvestigator(id: string, newInvestigatorId: string): Ticket {
    const t = this.must(id);
    if (newInvestigatorId === t.originalInvestigatorId)
      throw new TicketError(409, "43513", "复核人不得参与原调查");
    if (t.excludedActorIds.includes(newInvestigatorId))
      throw new TicketError(409, "43506", "复核人同样适用回避规则");
    this.move(t, "process", newInvestigatorId);
    t.investigatorIds.push(newInvestigatorId);
    return t;
  }

  withdraw(id: string, actor: string, reason: string): Ticket {
    const t = this.must(id);
    if (actor !== t.customerRef) throw new TicketError(403, "43514", "仅客户可撤回");
    if (!reason?.trim()) throw new TicketError(422, "43515", "撤回须填原因（记录保留）");
    this.move(t, "withdraw", actor, reason);
    return t;
  }

  referCompliance(id: string, actor: string): Ticket {
    const t = this.must(id);
    this.assertHandler(t, actor);
    this.move(t, "refer_compliance", actor);
    (this.compliance ?? this.complianceSvc)?.openFromTicket(t, actor);
    return t;
  }

  /* ---------------- 查询 / SLA 时钟 ---------------- */

  listForCustomer(customerRef: string): Ticket[] {
    return [...this.tickets.values()].filter((t) => t.customerRef === customerRef);
  }

  /** 普通工单队列（顾问只见协同项，不见投诉正文） */
  listQueue(team: "customer_service" | "compliance_team"): Ticket[] {
    return [...this.tickets.values()].filter(
      (t) => t.kind !== "complaint" ? team === "customer_service" : team === "compliance_team"
    );
  }

  /** 顾问可见的协同工单（不含投诉正文） */
  listForAdvisor(advisorId: string): Ticket[] {
    return [...this.tickets.values()].filter(
      (t) => t.kind !== "complaint" && (t.respondentAdvisorId === advisorId || t.assigneeId === advisorId)
    );
  }

  tick(nowIso: string): Ticket[] {
    const now = Date.parse(nowIso);
    const escalated: Ticket[] = [];
    for (const t of this.tickets.values()) {
      const terminal = ["closed", "rated", "withdrawn", "compliance_referred"];
      if (terminal.includes(t.state)) continue;
      let due: string | null = null;
      if (["submitted"].includes(t.state)) due = t.acceptDueAt;
      else if (t.resolveDueAt && ["accepted", "processing", "info_needed"].includes(t.state))
        due = t.resolveDueAt;
      if (due && now > Date.parse(due) && !t.escalatedTo) {
        t.escalatedTo = "supervisor";
        t.log.push({ at: nowIso, state: t.state, actor: "system", note: "SLA 超时升级主管" });
        this.audit.record({ realm: "staff", action: "ticket.sla.escalated", resource: t.id, result: "info", actor: "system" });
        escalated.push(t);
      } else if (t.escalatedTo === "supervisor" && due && now > Date.parse(due) + DAY) {
        t.escalatedTo = "compliance_officer";
        this.audit.record({ realm: "staff", action: "ticket.sla.escalated_compliance", resource: t.id, result: "info", actor: "system" });
        if (!escalated.includes(t)) escalated.push(t);
      }
    }
    return escalated;
  }

  private assertHandler(t: Ticket, actor: string) {
    // 投诉：被投诉人不可处理/关闭
    if (t.kind === "complaint") {
      if (t.excludedActorIds.includes(actor))
        throw new TicketError(403, "43516", "被投诉人不可见投诉正文、不可处理/关闭");
      if (t.assigneeId && t.assigneeId !== actor && actor !== "system")
        throw new TicketError(403, "43517", "投诉由独立调查人处理");
    }
  }
}
