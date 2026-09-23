import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { ProposalService, type ProposalDraftInput } from "./proposal.service.js";
import { OrderService } from "../order/order.service.js";

/** 顾问端：方案编制与提交复核（M2-04） */
@Controller("advisor/proposals")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ProposalAdvisorController {
  constructor(private readonly proposals: ProposalService) {}

  @Post("drafts")
  draft(@Body() body: ProposalDraftInput, @CurrentActor() actor: Actor) {
    return this.proposals.draft(body, actor.user);
  }

  @Post(":id/submit")
  submit(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.proposals.submitReview(id, actor.user);
  }

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.proposals.advisorList(actor.user) };
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.proposals.getById(id, { realm: "advisor", ref: actor.user });
  }
}

/** 后台 A05：报价复核队列（M2-05） */
@Controller("admin/proposals")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ProposalAdminController {
  constructor(private readonly proposals: ProposalService) {}

  @Get("review-queue")
  queue() {
    return { records: this.proposals.reviewQueue() };
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @Body() body: { secondReviewerId?: string }, @CurrentActor() actor: Actor) {
    return this.proposals.approve(id, actor.user, body.secondReviewerId);
  }

  @Post(":id/reject")
  reject(@Param("id") id: string, @Body() body: { reasons: string[] }, @CurrentActor() actor: Actor) {
    return this.proposals.reject(id, actor.user, body.reasons);
  }
}

/** 客户端：查看方案、确认、申请修改（M2-06） */
@Controller("v1/proposals")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class ProposalCustomerController {
  constructor(
    private readonly proposals: ProposalService,
    private readonly orders: OrderService
  ) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.proposals.customerList(actor.user) };
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.proposals.getById(id, { realm: "customer", ref: actor.user });
  }

  @Post(":id/confirm")
  confirm(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const p = this.proposals.confirm(id, actor.user);
    // M2-09/13：客户确认即自动生成订单草稿，固化方案/费表/规则快照
    this.orders.createFromProposal(p, actor.user);
    return p;
  }

  @Post(":id/revision")
  revision(@Param("id") id: string, @Body() body: { note: string }, @CurrentActor() actor: Actor) {
    return this.proposals.requestRevision(id, actor.user, body.note);
  }
}
