import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { EngagementService } from "./engagement.service.js";

/** 顾问侧：队列（chips）、接受/转分配、客户列表与详情（M2-01/02/03 关系部分） */
@Controller("advisor")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class EngagementAdvisorController {
  constructor(private readonly engagements: EngagementService) {}

  @Get("engagements/queue")
  queue(@CurrentActor() actor: Actor, @Query("chip") chip?: "pending_accept" | "active" | "all") {
    return { records: this.engagements.advisorQueue(actor.user, chip ?? "all") };
  }

  @Post("engagements/:id/accept")
  accept(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.engagements.accept(id, actor.user);
  }

  @Post("engagements/:id/reassign")
  reassign(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.engagements.reassign(id, actor.user, body.reason);
  }

  @Get("clients")
  clients(@CurrentActor() actor: Actor) {
    return { records: this.engagements.advisorClients(actor.user) };
  }

  @Get("clients/:relationshipId")
  client(@Param("relationshipId") relationshipId: string, @CurrentActor() actor: Actor) {
    return this.engagements.advisorClientView(actor.user, relationshipId);
  }
}
