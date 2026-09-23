import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { ClientDetailService } from "./clientdetail.service.js";

/** 顾问端：客户详情三页签 + 跟进记录（M2-03） */
@Controller("advisor")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ClientDetailAdvisorController {
  constructor(private readonly details: ClientDetailService) {}

  @Get("clients/:relationshipId/detail")
  detail(@Param("relationshipId") relationshipId: string, @CurrentActor() actor: Actor) {
    return this.details.detailByRelationship(relationshipId, actor.user);
  }

  @Post("clients/:customerRef/follow-ups")
  addFollow(
    @Param("customerRef") customerRef: string,
    @Body() body: { text: string; kind?: "fact" | "internal" },
    @CurrentActor() actor: Actor
  ) {
    return this.details.addFollow(customerRef, body, actor.user);
  }

  @Post("follow-ups/:id/correct")
  correct(
    @Param("id") id: string,
    @Body() body: { text: string; note: string },
    @CurrentActor() actor: Actor
  ) {
    return this.details.correctFollow(id, body, actor.user);
  }
}

/** 客户端：查看对客可见的跟进/事实节点（字段级过滤） */
@Controller("v1/follow-ups")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class FollowUpCustomerController {
  constructor(private readonly details: ClientDetailService) {}

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return { records: this.details.customerFollows(actor.user) };
  }
}
