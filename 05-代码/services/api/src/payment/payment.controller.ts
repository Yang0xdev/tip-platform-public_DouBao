import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { PaymentService, type ChangeKind } from "./payment.service.js";

/** 客户端：付款指引、凭证上传、收据、变更/退款申请（M2-11/12） */
@Controller("v1/orders")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class PaymentCustomerController {
  constructor(private readonly payments: PaymentService) {}

  @Get(":id/payment-plan")
  plan(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.payments.ensurePlan(id, { realm: "customer", ref: actor.user });
  }

  @Get(":id/payee-info")
  payee(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.payments.payeeInfo(id, { realm: "customer", ref: actor.user });
  }

  @Post(":id/payment-vouchers")
  upload(
    @Param("id") id: string,
    @Body() body: { installmentSeq: number; fileHash: string; artifactRef: string; amountMinor: string; currency: string },
    @CurrentActor() actor: Actor
  ) {
    return this.payments.uploadVoucher(id, body, actor.user);
  }

  @Get(":id/receipts")
  receipts(@Param("id") id: string, @CurrentActor() actor: Actor) {
    // 先确保订单可见
    this.payments.ensurePlan(id, { realm: "customer", ref: actor.user });
    return { records: this.payments.listReceipts(id) };
  }

  @Post(":id/change-requests")
  change(
    @Param("id") id: string,
    @Body() body: { kind: ChangeKind; note: string; voucherRefs?: string[] },
    @CurrentActor() actor: Actor
  ) {
    return this.payments.submitChange(id, body, actor.user);
  }

  @Get(":id/change-requests")
  listChanges(@Param("id") id: string, @CurrentActor() actor: Actor) {
    this.payments.ensurePlan(id, { realm: "customer", ref: actor.user });
    return { records: this.payments.listChanges({ orderId: id }) };
  }
}

/** 后台/财务：凭证核验队列、收据、变更单（M2-11/12） */
@Controller("admin/payments")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class PaymentAdminController {
  constructor(private readonly payments: PaymentService) {}

  @Get("pending-verify")
  pending() {
    return { records: this.payments.pendingVerify() };
  }

  @Post(":orderId/verify")
  verify(
    @Param("orderId") orderId: string,
    @Body() body: { installmentSeq: number; decision: "verified" | "rejected"; reason?: string; secondVerifierId?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.payments.verify(orderId, body, actor.user);
  }

  @Get("receipts")
  receipts() {
    return { records: this.payments.listReceipts() };
  }
}

/** 后台：变更/退款单（M2 只冻结，M4 执行） */
@Controller("admin/order-changes")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ChangeRequestAdminController {
  constructor(private readonly payments: PaymentService) {}

  @Get()
  list() {
    return { records: this.payments.listChanges() };
  }
}
