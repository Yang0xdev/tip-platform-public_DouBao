import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { EngagementService, type ConsultationSource } from "./engagement.service.js";

/** 客户侧：咨询捕获（预约/请求服务）、分配确认、撤回、问卷授权（M2-01/02） */
@Controller("v1/engagements")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class EngagementCustomerController {
  constructor(private readonly engagements: EngagementService) {}

  @Post("capture")
  capture(
    @Body()
    body: {
      source: ConsultationSource;
      duplicateKey?: string | null;
      advisorId?: string | null;
      projectCode?: string | null;
      note?: string | null;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.engagements.capture({
      source: body.source,
      customerRef: actor.user,
      duplicateKey: body.duplicateKey ?? null,
      advisorId: body.advisorId ?? null,
      projectCode: body.projectCode ?? null,
      note: body.note ?? null,
      actor: actor.user
    });
  }

  @Post(":id/confirm-assignment")
  confirm(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.engagements.confirmAssignment(id, actor.user);
  }

  @Post(":id/withdraw")
  withdraw(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.engagements.withdraw(id, actor.user);
  }

  @Post(":id/questionnaire-grant")
  grant(@Param("id") id: string, @Body() body: { granted: boolean }, @CurrentActor() actor: Actor) {
    return this.engagements.setQuestionnaireGrant(id, actor.user, Boolean(body.granted));
  }

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.engagements.customerList(actor.user) };
  }
}
