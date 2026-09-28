import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { paymentMachine, type PaymentState } from "@tip/core";
import { OrderService, type OrderRecord } from "../order/order.service.js";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CaseService } from "../case/case.service.js";
import { CommissionService } from "../commission/commission.service.js";

/**
 * M2-11/12 付款计划 / 凭证核验 / 收据 + 变更退款冻结。
 * D8 保守口径：V1 仅线下对公转账 + 凭证 + 财务双人核验，不做资金托管/在线支付；
 * PaymentGateway 仅接口，D8 拍板后装实现，不动状态机。
 */

export interface PlanInstallment {
  seq: number;
  label: string;
  feeCode: string;
  collector: string;
  currency: string;
  amountMinor: string | null;
  certainty: "confirmed" | "estimated" | "tbc" | "not_incurred";
  condition: string; // 触发条件
  status: "due" | "not_accrued"; // 官方/第三方未发生不预记应收
  paymentState: PaymentState;
  voucher: {
    fileHash: string | null;
    artifactRef: string | null;
    uploadedAt: string | null;
    amountMinor: string | null;
  };
  verifiedAt: string | null;
  receiptId: string | null;
  rejectReason: string | null;
}

export interface PaymentPlan {
  orderId: string;
  installments: PlanInstallment[];
}

export interface Receipt {
  id: string;
  orderId: string;
  installmentSeq: number;
  currency: string;
  amountMinor: string;
  collector: string;
  issuedAt: string;
  watermark: "transparent-identity-platform 电子收据（示例）";
}

export type ChangeKind = "refund" | "installment_change" | "proposal_change" | "fee_dispute";

export interface ChangeRequest {
  id: string;
  orderId: string;
  kind: ChangeKind;
  note: string;
  voucherRefs: string[];
  status: "pending"; // M2 只冻结；M4 流转执行
  createdAt: string;
  createdBy: string;
}

/** 支付通道抽象（无实现；D8 决策后适配在线支付/跨境通道） */
export interface PaymentGateway {
  initiate(input: { orderId: string; amountMinor: bigint; currency: string }): Promise<{ redirectUrl: string }>;
  handleCallback(payload: unknown): Promise<{ orderId: string; installmentSeq: number; paid: boolean }>;
  query(orderId: string): Promise<{ state: string }>;
}

class PaymentError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class PaymentService implements OnModuleInit {
  private plans = new Map<string, PaymentPlan>();
  private receipts = new Map<string, Receipt>();
  private changes = new Map<string, ChangeRequest>();
  private receiptSeq = 0;
  private changeSeq = 0;

  constructor(
    private readonly orders: OrderService,
    private readonly audit: AuditService,
    private readonly cases: CaseService,
    private readonly snapshotsStore?: SnapshotStore,
    private readonly commission?: CommissionService
  ) {}

  async onModuleInit() {
    if (!this.snapshotsStore?.enabled) return;
    const planRows = await this.snapshotsStore.listAll<PaymentPlan>("payment_plan");
    for (const r of planRows) this.plans.set(r.aggregateId, r.snapshot);
    const receiptRows = await this.snapshotsStore.listAll<Receipt>("receipt");
    let maxR = 0;
    for (const r of receiptRows) {
      this.receipts.set(r.aggregateId, r.snapshot);
      const n = Number(r.aggregateId.replace("RCP-", ""));
      if (n > maxR) maxR = n;
    }
    this.receiptSeq = maxR;
    const changeRows = await this.snapshotsStore.listAll<ChangeRequest>("order_change");
    let maxC = 0;
    for (const r of changeRows) {
      this.changes.set(r.aggregateId, r.snapshot);
      const n = Number(r.aggregateId.replace("CHG-", ""));
      if (n > maxC) maxC = n;
    }
    this.changeSeq = maxC;
  }

  private persistPlan(plan: PaymentPlan, actor: string) {
    if (!this.snapshotsStore?.enabled) return;
    void this.snapshotsStore.save("payment_plan", plan.orderId, 1, "active", plan as never, actor);
  }

  /* ---------------- 付款计划（M2-11） ---------------- */

  /** 生成付款计划：M2/M3 前仅合同首付（平台服务费）；官方/第三方费显未发生不预记应收 */
  ensurePlan(orderId: string, viewer: { realm: "staff" | "customer" | "advisor"; ref: string }): PaymentPlan {
    const order = this.orders.getById(orderId, viewer);
    const existing = this.plans.get(orderId);
    if (existing) return existing;
    const installments: PlanInstallment[] = order.snapshots.feeSnapshot.map((f, i) => {
      const isPlatform = f.nature === "platform_service";
      return {
        seq: i + 1,
        label: f.label,
        feeCode: f.code,
        collector: f.collector ?? "待确认",
        currency: f.currency ?? "—",
        amountMinor: f.amountMinor !== null ? String(f.amountMinor) : null,
        certainty: f.certainty,
        condition: isPlatform ? "合同首付，签约时支付" : "按实际发生代收代付，未发生不预记应收",
        status: isPlatform && f.certainty === "confirmed" ? "due" : "not_accrued",
        paymentState: isPlatform && f.certainty === "confirmed" ? "unpaid" : "unpaid",
        voucher: { fileHash: null, artifactRef: null, uploadedAt: null, amountMinor: null },
        verifiedAt: null,
        receiptId: null,
        rejectReason: null
      };
    });
    const plan: PaymentPlan = { orderId, installments };
    this.plans.set(orderId, plan);
    this.persistPlan(plan, viewer.ref);
    return plan;
  }

  /** 仅展示签约主体对公账户（白名单）；非主体账户无信息；防骗提示常驻 */
  payeeInfo(orderId: string, viewer: { realm: "customer"; ref: string }) {
    const order = this.orders.getById(orderId, viewer);
    const cfg = this.orders.getConfig();
    const accounts = cfg.payeeAccounts.filter((a) => a.name === order.snapshots.feeSnapshot.find((f) => f.nature === "platform_service")?.collector);
    return {
      accounts,
      warnings: ["请仅向以上签约主体对公账户转账", "请勿向任何个人账户转账", "平台不会通过即时通讯索要验证码或要求转账"]
    };
  }

  /* ---------------- 凭证上传与核验 ---------------- */

  /** 客户上传转账凭证 → pending_verify；明确“待核验，不代表到账” */
  uploadVoucher(
    orderId: string,
    body: { installmentSeq: number; fileHash: string; artifactRef: string; amountMinor: string; currency: string },
    customerRef: string
  ): PaymentPlan {
    const order = this.orders.getById(orderId, { realm: "customer", ref: customerRef });
    if (order.freezeStatus) throw new PaymentError(409, "42401", `订单处于 ${order.freezeStatus}，不可并行付款`);
    if (order.contractState !== "effective" && order.contractState !== "gate_passed" && order.contractState !== "pending_sign" && order.contractState !== "signed_registered") {
      // 首付可在合同流程中上传，但订单须已过主体门
      throw new PaymentError(409, "42402", "主体门未通过，暂不可付款");
    }
    const plan = this.ensurePlan(orderId, { realm: "customer", ref: customerRef });
    const ins = plan.installments.find((x) => x.seq === body.installmentSeq);
    if (!ins || ins.status !== "due") throw new PaymentError(422, "42403", "该费项目前未到应付节点");
    if (ins.paymentState === "verified") throw new PaymentError(409, "42404", "该期已核验到账，无需重复上传");
    if (!body.fileHash || !body.artifactRef) throw new PaymentError(422, "42405", "需上传凭证文件（JPG/PDF，≤20MB）");
    if (body.currency !== ins.currency) throw new PaymentError(422, "42406", "凭证币种与费表不一致");
    // 重复凭证：文件哈希 + 金额 + 期次（跨订单也拦截）
    const dup = [...this.plans.values()].some((p) =>
      p.installments.some((x) => x.voucher.fileHash === body.fileHash && x.voucher.amountMinor === body.amountMinor)
    );
    if (dup) throw new PaymentError(409, "42204", "重复凭证，已用于记账，不可重复提交");
    const event = ins.paymentState === "rejected" ? "reupload" : "upload_voucher";
    this.transition(ins, event as never);
    ins.voucher = { fileHash: body.fileHash, artifactRef: body.artifactRef, uploadedAt: new Date().toISOString(), amountMinor: body.amountMinor };
    ins.rejectReason = null;
    this.persistPlan(plan, customerRef);
    this.audit.record({ actor: customerRef, realm: "customer", action: "payment.voucher.upload", resource: `${orderId}#${body.installmentSeq}`, result: "allow" });
    return plan;
  }

  /** 财务核验：双人/银行核对；verified 开收据，reject 必填原因可重传（原凭证留存） */
  verify(
    orderId: string,
    body: { installmentSeq: number; decision: "verified" | "rejected"; reason?: string; secondVerifierId?: string },
    actor: string
  ): PaymentPlan {
    const order = this.orders.getById(orderId, { realm: "staff", ref: actor });
    const plan = this.ensurePlan(orderId, { realm: "staff", ref: actor });
    const ins = plan.installments.find((x) => x.seq === body.installmentSeq);
    if (!ins) throw new PaymentError(404, "42407", "期次不存在");
    if (ins.paymentState !== "pending_verify") throw new PaymentError(409, "42408", "仅待核验凭证可核验");
    // 核验人 ≠ 顾问（财务职责分离，且财务默认不见证件原件）
    if (actor === order.advisorId) throw new PaymentError(403, "42409", "顾问不可核验付款凭证（职责分离）");
    if (body.decision === "rejected") {
      const reason = body.reason?.trim();
      if (!reason) throw new PaymentError(422, "42410", "驳回需选择原因（户名不符/金额不符/图像不清/重复凭证）");
      this.transition(ins, "reject");
      ins.rejectReason = reason;
      this.persistPlan(plan, actor);
      this.audit.record({ actor, realm: "staff", action: "payment.voucher.reject", resource: `${orderId}#${ins.seq}`, result: "deny", reason });
      return plan;
    }
    // 金额/户名核对：凭证金额须与应付一致
    if (ins.voucher.amountMinor !== ins.amountMinor) {
      throw new PaymentError(422, "42411", "凭证金额与应付金额不一致，应驳回");
    }
    // 双人核验：第二核验人留痕（影子期记录即可）
    if (!body.secondVerifierId) throw new PaymentError(422, "42412", "需第二核验人共同确认（财务双人）");
    if (body.secondVerifierId === actor) throw new PaymentError(422, "42413", "第二核验人须为另一财务人员");
    this.transition(ins, "verify");
    ins.verifiedAt = new Date().toISOString();
    // 开收据
    this.receiptSeq += 1;
    const receipt: Receipt = {
      id: `RCP-${String(this.receiptSeq).padStart(4, "0")}`,
      orderId,
      installmentSeq: ins.seq,
      currency: ins.currency,
      amountMinor: ins.amountMinor ?? "0",
      collector: ins.collector,
      issuedAt: ins.verifiedAt,
      watermark: "transparent-identity-platform 电子收据（示例）"
    };
    this.receipts.set(receipt.id, receipt);
    ins.receiptId = receipt.id;
    if (this.snapshotsStore?.enabled) {
      void this.snapshotsStore.save("receipt", receipt.id, 1, "issued", receipt as never, actor);
    }
    this.persistPlan(plan, actor);
    this.commission?.onPaymentVerified(orderId, actor);
    this.audit.record({ actor, realm: "staff", action: "payment.verified", resource: `${orderId}#${ins.seq}`, result: "allow", reason: `receipt:${receipt.id},second:${body.secondVerifierId}` });
    // 首付核验 + 合同生效 → 待建案 → 自动建案（M3-01）
    if (ins.seq === 1 && order.contractState === "effective") {
      this.orders.markReadyForCase(orderId, actor);
      this.cases.createFromOrder(this.orders.list().find((x) => x.id === orderId)!, actor);
    }
    return plan;
  }

  /* ---------------- 变更/退款（M2-12，只冻结不执行） ---------------- */

  submitChange(
    orderId: string,
    body: { kind: ChangeKind; note: string; voucherRefs?: string[] },
    customerRef: string
  ): ChangeRequest {
    const order = this.orders.getById(orderId, { realm: "customer", ref: customerRef });
    if (!body.note?.trim()) throw new PaymentError(422, "42420", "请填写变更说明");
    this.changeSeq += 1;
    const id = `CHG-${String(this.changeSeq).padStart(4, "0")}`;
    const req: ChangeRequest = {
      id,
      orderId,
      kind: body.kind,
      note: body.note,
      voucherRefs: body.voucherRefs ?? [],
      status: "pending",
      createdAt: new Date().toISOString(),
      createdBy: customerRef
    };
    this.changes.set(id, req);
    // 退款类 → refund_pending；其余 → change_pending；提交即冻结，执行在 M4
    this.orders.freezeFor(orderId, body.kind === "refund" ? "refund_pending" : "change_pending", id, customerRef);
    if (this.snapshotsStore?.enabled) {
      void this.snapshotsStore.save("order_change", id, 1, "pending", req as never, customerRef);
    }
    this.audit.record({ actor: customerRef, realm: "customer", action: "order.change.submit", resource: id, result: "allow", reason: body.kind });
    return req;
  }

  listChanges(filter?: { orderId?: string }): ChangeRequest[] {
    const all = [...this.changes.values()];
    return filter?.orderId ? all.filter((c) => c.orderId === filter.orderId) : all;
  }

  listReceipts(orderId?: string): Receipt[] {
    const all = [...this.receipts.values()];
    return orderId ? all.filter((r) => r.orderId === orderId) : all;
  }

  /** 财务待核验队列（跨订单） */
  pendingVerify(): Array<{ orderId: string; installmentSeq: number; label: string; uploadedAt: string; amountMinor: string; currency: string }> {
    const out: ReturnType<PaymentService["pendingVerify"]> = [];
    for (const p of this.plans.values()) {
      for (const ins of p.installments) {
        if (ins.paymentState === "pending_verify") {
          out.push({ orderId: p.orderId, installmentSeq: ins.seq, label: ins.label, uploadedAt: ins.voucher.uploadedAt ?? "", amountMinor: ins.voucher.amountMinor ?? "0", currency: ins.currency });
        }
      }
    }
    return out;
  }

  /** 平台外交易（无登记订单）：不假装受理 */
  offPlatformNotice() {
    return {
      accepted: false,
      message: "未在平台登记的交易，平台无法受理变更或保障；请通过合同约定的争议解决等合法途径处理。",
      boundary: "登记订单才享平台保障；平台不监控私讯，也不鼓励平台外收款。"
    };
  }

  /* ---------------- 状态机 ---------------- */

  private transition(ins: PlanInstallment, event: Parameters<typeof paymentMachine.transition>[2]) {
    const out = paymentMachine.transition({}, ins.paymentState, event);
    if (!out.ok) throw new PaymentError(409, "42430", out.reason ?? "状态迁移被拒绝");
    ins.paymentState = out.to as PaymentState;
  }
}
