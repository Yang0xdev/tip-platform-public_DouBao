import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { TicketService, type TicketKind, type ComplaintCategory } from "./ticket.service.js";

/* 客户：P-14/P-15 提交与详情 */
@Controller("v1/tickets")
@UseGuards(RealmGuard)
export class TicketCustomerController {
  constructor(private readonly tickets: TicketService) {}

  @Post()
  @RealmAllowed("customer")
  submit(
    @Body()
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
    @CurrentActor() actor: Actor
  ) {
    return this.tickets.submit(body, actor.user);
  }

  @Get("mine")
  @RealmAllowed("customer")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.tickets.listForCustomer(actor.user) };
  }

  @Post(":id/info")
  @RealmAllowed("customer")
  info(@Param("id") id: string, @Body() body: { note: string }, @CurrentActor() actor: Actor) {
    return this.tickets.provideInfo(id, actor.user, body.note);
  }

  @Post(":id/withdraw")
  @RealmAllowed("customer")
  withdraw(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.tickets.withdraw(id, actor.user, body.reason);
  }

  @Post(":id/review-request")
  @RealmAllowed("customer")
  reviewRequest(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.tickets.requestReview(id, actor.user);
  }

  @Post(":id/rate")
  @RealmAllowed("customer")
  rate(@Param("id") id: string, @Body() body: { score: number }, @CurrentActor() actor: Actor) {
    return this.tickets.rate(id, actor.user, body.score);
  }
}

/* 后台 A08 */
@Controller("admin/tickets")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class TicketAdminController {
  constructor(private readonly tickets: TicketService) {}

  @Get("queue")
  queue(@Query("team") team: "customer_service" | "compliance_team") {
    return { records: this.tickets.listQueue(team ?? "customer_service") };
  }

  @Post(":id/accept")
  accept(
    @Param("id") id: string,
    @Body() body: { assigneeId?: string; complex?: boolean },
    @CurrentActor() actor: Actor
  ) {
    return this.tickets.accept(id, actor.user, body);
  }

  @Post(":id/process")
  process(@Param("id") id: string, @Body() body: { note?: string }, @CurrentActor() actor: Actor) {
    return this.tickets.process(id, actor.user, body.note);
  }

  @Post(":id/request-info")
  requestInfo(@Param("id") id: string, @Body() body: { note: string }, @CurrentActor() actor: Actor) {
    return this.tickets.requestInfo(id, actor.user, body.note);
  }

  @Post(":id/resolve")
  resolve(@Param("id") id: string, @Body() body: { note: string }, @CurrentActor() actor: Actor) {
    return this.tickets.resolve(id, actor.user, body.note);
  }

  @Post(":id/close")
  close(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.tickets.close(id, actor.user);
  }

  @Post(":id/refer-compliance")
  refer(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.tickets.referCompliance(id, actor.user);
  }

  @Post(":id/reinvestigate")
  reinvestigate(@Param("id") id: string, @Body() body: { newInvestigatorId: string }) {
    return this.tickets.reviewByNewInvestigator(id, body.newInvestigatorId);
  }

  @Post("tick")
  tick(@Body() body: { now: string }) {
    return { escalated: this.tickets.tick(body.now) };
  }
}

/* 顾问端：协同工单（不含投诉正文） */
@Controller("advisor/tickets")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class TicketAdvisorController {
  constructor(private readonly tickets: TicketService) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.tickets.listForAdvisor(actor.user) };
  }
}
