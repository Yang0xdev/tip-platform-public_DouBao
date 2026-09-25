import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { TimelineService } from "./timeline.service.js";

/** 后台：时间线（内部视图）、A06 待核验队列、凭据核验（M3-04） */
@Controller("admin/timeline")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class TimelineAdminController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  list(@Query("caseId") caseId: string) {
    return { records: this.timeline.viewForCase(caseId, { internal: true }) };
  }

  @Get("verification-queue")
  queue() {
    return { records: this.timeline.verificationQueue() };
  }

  @Post("verify")
  verify(
    @Body() body: { spEventId: string; decision: "verified" | "rejected"; note?: string; evidenceRef?: string },
    @CurrentActor() actor: Actor
  ) {
    return { records: this.timeline.verify(body.spEventId, body, actor.user) };
  }

  /** co 公司动作（如“已递交”固定措辞） */
  @Post("company")
  company(@Body() body: { caseId: string; kind: string; detail?: string }, @CurrentActor() actor: Actor) {
    return this.timeline.recordCompany(body.caseId, body.kind, actor.user, body.detail ?? null);
  }
}

/** 客户端：四级来源时间线（M3-11/P-11） */
@Controller("v1/timeline")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class TimelineCustomerController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  list(@Query("caseId") caseId: string) {
    return { records: this.timeline.viewForCase(caseId, { internal: false }) };
  }
}
