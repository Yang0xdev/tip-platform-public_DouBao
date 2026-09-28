import { Injectable } from "@nestjs/common";
import { commissionMachine, type CommissionState } from "@tip/core";
import { AuditService } from "../audit.service.js";

/**
 * M4-05/06 佣金六态 + 退款执行
 *  - 计提仅由 订单生效→首付核验 触发；点击/咨询/预约/名片扫码/方案确认无计提路径；
 *  - 官方费/第三方费/未发生费不产生佣金；异币种分列不合计；
 *  - 冻结矩阵：投诉立案/退款申请/合规 L2+/离职交接；
 *  - 结算双人复核；支付线下登记无自动打款；
 *  - 退款：业务+财务双人方案，已发生费按实扣除，无"不成功全额退款"；收据冲红不删除。
 */

export interface CommissionLine {
  id: string;
  orderId: string;
  advisorId: string;
  feeItemCode: string;
  amountMinor: string;
  currency: string;
  ruleVersion: string;
  state: CommissionState;
  settlementBatchId: string | null;
  log: Array<{ at: string; to: CommissionState; actor: string; note?: string }>;
  adjusted: Array<{ at: string; note: string; actor: string }>;
}

export interface SettlementBatch {
  id: string;
  createdAt: string;
  lines: string[];
  reviewerA: string | null;
  reviewerB: string | null;
  state: "draft" | "reviewed" | "approved" | "paid";
  paidAt: string | null;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  changeRequestId: string | null;
  ticketId: string | null;
  lines: Array<{ amountMinor: string; currency: string; reason: string }>;
  businessReviewerId: string | null;
  financeReviewerId: string | null;
  state: "proposed" | "double_reviewed" | "executed" | "rejected";
  executedAt: string | null;
  voucherRef: string | null;
  receiptReversalRef: string | null;
}

export class CommissionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

@Injectable()
export class CommissionService {
  private lines = new Map<string, CommissionLine>();
  private batches = new Map<string, SettlementBatch>();
  private refunds = new Map<string, RefundRecord>();
  private cseq = 0;
  private bseq = 0;
  private rseq = 0;
  /** 顾问级新增冻结（合规 L2+ / 投诉线索） */
  private frozenAdvisors = new Set<string>();

  constructor(private readonly audit: AuditService) {}

  /* ---------------- 计提触发（仅订单/到账链） ---------------- */

  /** 订单生效：建立 not_accrued（平台服务费项才计提基数） */
  onOrderEffective(
    order: {
      id: string;
      advisorId: string | null;
      plan?: Array<{ code: string; nature: string; certainty?: string; amountMinor: bigint | string | null; currency: string | null }>
    },
    actor: string
  ): CommissionLine[] {
    const out: CommissionLine[] = [];
    for (const p of order.plan ?? []) {
      if (p.nature !== "platform_service" || p.certainty !== "confirmed" || !p.amountMinor || !p.currency) continue;
      this.cseq += 1;
      const line: CommissionLine = {
        id: `COM-${String(this.cseq).padStart(4, "0")}`,
        orderId: order.id,
        advisorId: order.advisorId ?? "unassigned",
        feeItemCode: p.code,
        amountMinor: String(p.amountMinor),
        currency: p.currency,
        ruleVersion: "commission-rules-v1",
        state: "not_accrued",
        settlementBatchId: null,
        log: [{ at: new Date().toISOString(), to: "not_accrued", actor }],
        adjusted: []
      };
      this.lines.set(line.id, line);
      out.push(line);
    }
    return out;
  }

  /** 首付核验通过：not_accrued → accrued（顾问被新增冻结则挂起不结转？规则：仍计提但冻结） */
  onPaymentVerified(orderId: string, actor: string): void {
    for (const l of this.lines.values()) {
      if (l.orderId !== orderId || l.state !== "not_accrued") continue;
      this.transition(l, "accrue", actor);
      if (this.frozenAdvisors.has(l.advisorId)) this.transition(l, "freeze", actor, "顾问新增冻结");
    }
  }

  /* ---------------- 冻结矩阵 ---------------- */

  freezeForOrder(orderId: string, reason: string, actor: string): void {
    for (const l of this.lines.values())
      if (l.orderId === orderId && l.state === "accrued") this.transition(l, "freeze", actor, reason);
  }

  freezeNewForAdvisor(advisorId: string, reason: string, actor: string): void {
    this.frozenAdvisors.add(advisorId);
    for (const l of this.lines.values())
      if (l.advisorId === advisorId && l.state === "accrued") this.transition(l, "freeze", actor, reason);
    this.audit.record({ action: "commission.advisor_freeze_new", resource: advisorId, realm: "staff", result: "info", reason, actor });
  }

  unfreezeForOrder(orderId: string, actor: string): void {
    for (const l of this.lines.values())
      if (l.orderId === orderId && l.state === "frozen") this.transition(l, "unfreeze", actor);
  }

  /* ---------------- 结算 ---------------- */

  createSettlementBatch(actor: string): SettlementBatch {
    const eligible = [...this.lines.values()].filter((l) => l.state === "accrued");
    if (!eligible.length) throw new CommissionError("43601", "没有可结算的已计提佣金");
    this.bseq += 1;
    const b: SettlementBatch = {
      id: `STL-${String(this.bseq).padStart(4, "0")}`,
      createdAt: new Date().toISOString(),
      lines: eligible.map((l) => l.id),
      reviewerA: null,
      reviewerB: null,
      state: "draft",
      paidAt: null
    };
    this.batches.set(b.id, b);
    this.audit.record({ realm: "staff", action: "commission.settlement.created", resource: b.id, result: "info", actor });
    return b;
  }

  reviewSettlement(batchId: string, reviewer: string): SettlementBatch {
    const b = this.requireBatch(batchId);
    if (!b.reviewerA) b.reviewerA = reviewer;
    else if (b.reviewerA !== reviewer) b.reviewerB = reviewer;
    else throw new CommissionError("43602", "两位复核人不得相同");
    if (b.reviewerA && b.reviewerB) {
      // 状态机守卫：双人且互异
      for (const id of b.lines) {
        const l = this.lines.get(id)!;
        if (l.state !== "accrued") throw new CommissionError("43603", `存在非 accrued 行 ${id}，不可结算`);
        const r = commissionMachine.transition(
          { settlementReviewerA: b.reviewerA, settlementReviewerB: b.reviewerB },
          l.state,
          "settle"
        );
        if (!r.ok) throw new CommissionError("43604", r.reason ?? "结算守卫拒绝");
        l.state = r.to!;
        l.settlementBatchId = b.id;
        l.log.push({ at: new Date().toISOString(), to: l.state, actor: reviewer });
      }
      b.state = "reviewed";
    }
    return b;
  }

  approveSettlement(batchId: string, actor: string): SettlementBatch {
    const b = this.requireBatch(batchId);
    if (b.state !== "reviewed") throw new CommissionError("43605", "双人复核通过才可审批");
    b.state = "approved";
    this.audit.record({ realm: "staff", action: "commission.settlement.approved", resource: batchId, result: "allow", actor });
    return b;
  }

  /** 支付线下登记（无自动打款） */
  registerPaid(batchId: string, actor: string, voucherRef: string): SettlementBatch {
    const b = this.requireBatch(batchId);
    if (b.state !== "approved") throw new CommissionError("43606", "审批通过才可登记支付");
    b.state = "paid";
    b.paidAt = new Date().toISOString();
    for (const id of b.lines) {
      const l = this.lines.get(id)!;
      this.goto(l, "paid", actor, `线下支付凭证 ${voucherRef}`);
    }
    return b;
  }

  clawback(lineId: string, actor: string, reason: string): CommissionLine {
    const l = this.requireLine(lineId);
    if (!reason?.trim()) throw new CommissionError("43607", "追回须填事实原因");
    this.goto(l, "clawback", actor, reason);
    return l;
  }

  /** adjusted 只记事件，不覆盖历史 */
  adjust(lineId: string, actor: string, note: string): CommissionLine {
    const l = this.requireLine(lineId);
    l.adjusted.push({ at: new Date().toISOString(), note, actor });
    this.audit.record({ realm: "staff", action: "commission.adjusted", resource: lineId, result: "info", actor });
    return l;
  }

  /* ---------------- 退款执行（M4-05） ---------------- */

  proposeRefund(
    body: {
      orderId: string;
      changeRequestId?: string;
      ticketId?: string;
      lines: Array<{ amountMinor: string; currency: string; reason: string }>;
    },
    actor: string
  ): RefundRecord {
    if (!body.lines.length) throw new CommissionError("43701", "退款须至少一条明细");
    if (body.lines.some((l) => !l.reason?.trim()))
      throw new CommissionError("43702", "每条退款须注明扣除/退还依据");
    this.rseq += 1;
    const r: RefundRecord = {
      id: `RFD-${String(this.rseq).padStart(4, "0")}`,
      orderId: body.orderId,
      changeRequestId: body.changeRequestId ?? null,
      ticketId: body.ticketId ?? null,
      lines: body.lines,
      businessReviewerId: null,
      financeReviewerId: null,
      state: "proposed",
      executedAt: null,
      voucherRef: null,
      receiptReversalRef: null
    };
    this.refunds.set(r.id, r);
    // 退款申请联动：关联订单佣金冻结
    this.freezeForOrder(body.orderId, "退款申请冻结", actor);
    return r;
  }

  reviewRefund(refundId: string, reviewer: string, role: "business" | "finance"): RefundRecord {
    const r = this.requireRefund(refundId);
    if (role === "business") r.businessReviewerId = reviewer;
    else r.financeReviewerId = reviewer;
    if (r.businessReviewerId && r.financeReviewerId) {
      if (r.businessReviewerId === r.financeReviewerId)
        throw new CommissionError("43703", "业务与财务复核不得为同一人");
      r.state = "double_reviewed";
    }
    return r;
  }

  executeRefund(refundId: string, actor: string, voucherRef: string): RefundRecord {
    const r = this.requireRefund(refundId);
    if (r.state !== "double_reviewed")
      throw new CommissionError("43704", "无双人复核的退款方案不可执行");
    r.state = "executed";
    r.executedAt = new Date().toISOString();
    r.voucherRef = voucherRef;
    r.receiptReversalRef = `RCP-RV-${r.id}`; // 收据冲红/更正留痕，不删除原记录
    this.audit.record({ realm: "staff", action: "refund.executed", resource: r.id, result: "allow", actor });
    return r;
  }

  rejectRefund(refundId: string, actor: string, reason: string): RefundRecord {
    const r = this.requireRefund(refundId);
    if (!reason?.trim()) throw new CommissionError("43705", "驳回必填原因");
    r.state = "rejected";
    this.unfreezeForOrder(r.orderId, actor);
    this.audit.record({ realm: "staff", action: "refund.rejected", resource: r.id, result: "deny", reason, actor });
    return r;
  }

  /* ---------------- 查询 ---------------- */

  listForAdvisor(advisorId: string): CommissionLine[] {
    return [...this.lines.values()].filter((l) => l.advisorId === advisorId);
  }
  listLines(): CommissionLine[] {
    return [...this.lines.values()];
  }
  listBatches(): SettlementBatch[] {
    return [...this.batches.values()];
  }
  listRefunds(): RefundRecord[] {
    return [...this.refunds.values()];
  }

  /* ---------------- 内部 ---------------- */

  private transition(
    l: CommissionLine,
    event: Parameters<typeof commissionMachine.transition>[2],
    actor: string,
    note?: string
  ) {
    const r = commissionMachine.transition({} as Parameters<typeof commissionMachine.transition>[0], l.state, event);
    if (!r.ok) throw new CommissionError("43608", r.reason ?? "佣金状态不允许该迁移");
    l.state = r.to!;
    l.log.push({ at: new Date().toISOString(), to: l.state, actor, note });
  }

  private goto(l: CommissionLine, to: CommissionState, actor: string, note?: string) {
    const event = to === "paid" ? "pay" : "clawback";
    this.transition(l, event, actor, note);
  }

  private requireLine(id: string): CommissionLine {
    const l = this.lines.get(id);
    if (!l) throw new CommissionError("43609", "佣金记录不存在");
    return l;
  }
  private requireBatch(id: string): SettlementBatch {
    const b = this.batches.get(id);
    if (!b) throw new CommissionError("43610", "结算单不存在");
    return b;
  }
  private requireRefund(id: string): RefundRecord {
    const r = this.refunds.get(id);
    if (!r) throw new CommissionError("43706", "退款记录不存在");
    return r;
  }
}
