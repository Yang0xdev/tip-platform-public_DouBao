import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { IpadService, type IpadMode } from "./ipad.service.js";

/** iPad 展业：面谈会话与双模式、I-01 项目比较、I-02 方案共读（M2-07/08） */
@Controller("ipad")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class IpadController {
  constructor(private readonly ipad: IpadService) {}

  @Post("sessions")
  start(@Body() body: { customerRef?: string | null }, @CurrentActor() actor: Actor) {
    return this.ipad.start(actor.user, body.customerRef ?? null);
  }

  @Post("sessions/:id/switch")
  switch(@Param("id") id: string, @Body() body: { mode: IpadMode }, @CurrentActor() actor: Actor) {
    return this.ipad.switchMode(id, body.mode, actor.user);
  }

  @Post("sessions/:id/end")
  end(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.ipad.end(id, actor.user);
  }

  @Get("sessions/:id/projects")
  projects(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.ipad.projects(id, actor.user);
  }

  @Get("sessions/:id/proposals/:proposalId")
  proposal(@Param("id") id: string, @Param("proposalId") proposalId: string, @CurrentActor() actor: Actor) {
    return this.ipad.proposal(id, proposalId, actor.user);
  }

  @Post("sessions/:id/remarks")
  remark(@Param("id") id: string, @Body() body: { text: string }, @CurrentActor() actor: Actor) {
    return this.ipad.checkRemark(id, body.text, actor.user);
  }

  @Post("sessions/:id/internal-access")
  internal(@Param("id") id: string, @Body() body: { target: string }, @CurrentActor() actor: Actor) {
    return this.ipad.attemptInternal(id, body.target, actor.user);
  }
}
