import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { CommissionService } from "./commission.service.js";

/* 后台 A07 */
@Controller("admin/commissions")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class CommissionAdminController {
  constructor(private readonly commissions: CommissionService) {}

  @Get()
  lines() {
    return { records: this.commissions.listLines() };
  }

  @Post("settlement-batches")
  batch(@CurrentActor() actor: Actor) {
    return this.commissions.createSettlementBatch(actor.user);
  }

  @Get("settlement-batches")
  listBatches() {
    return { records: this.commissions.listBatches() };
  }

  @Post("settlement-batches/:id/review")
  review(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.commissions.reviewSettlement(id, actor.user);
  }

  @Post("settlement-batches/:id/approve")
  approve(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.commissions.approveSettlement(id, actor.user);
  }

  @Post("settlement-batches/:id/pay")
  pay(@Param("id") id: string, @Body() body: { voucherRef: string }, @CurrentActor() actor: Actor) {
    return this.commissions.registerPaid(id, actor.user, body.voucherRef);
  }

  @Post(":id/clawback")
  clawback(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.commissions.clawback(id, actor.user, body.reason);
  }

  @Post(":id/adjust")
  adjust(@Param("id") id: string, @Body() body: { note: string }, @CurrentActor() actor: Actor) {
    return this.commissions.adjust(id, actor.user, body.note);
  }

  /* 退款 */
  @Get("refunds")
  refunds() {
    return { records: this.commissions.listRefunds() };
  }

  @Post("refunds")
  propose(@Body() body: Parameters<CommissionService["proposeRefund"]>[0], @CurrentActor() actor: Actor) {
    return this.commissions.proposeRefund(body, actor.user);
  }

  @Post("refunds/:id/review")
  reviewRefund(@Param("id") id: string, @Body() body: { role: "business" | "finance" }, @CurrentActor() actor: Actor) {
    return this.commissions.reviewRefund(id, actor.user, body.role);
  }

  @Post("refunds/:id/execute")
  execute(@Param("id") id: string, @Body() body: { voucherRef: string }, @CurrentActor() actor: Actor) {
    return this.commissions.executeRefund(id, actor.user, body.voucherRef);
  }

  @Post("refunds/:id/reject")
  reject(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.commissions.rejectRefund(id, actor.user, body.reason);
  }
}

/* 顾问 S-09：只回本人，无客户资金账户字段 */
@Controller("advisor/commissions")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class CommissionAdvisorController {
  constructor(private readonly commissions: CommissionService) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.commissions.listForAdvisor(actor.user) };
  }
}
