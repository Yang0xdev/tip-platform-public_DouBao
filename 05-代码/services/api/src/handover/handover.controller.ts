import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { HandoverService } from "./handover.service.js";

/** 客户端：客户发起换顾问（步骤1 的客户路径） */
@Controller("v1/handovers")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class HandoverCustomerController {
  constructor(private readonly handovers: HandoverService) {}

  @Post()
  start(
    @Body() body: { relationshipId: string; toAdvisorId?: string; reason: string },
    @CurrentActor() actor: Actor
  ) {
    return this.handovers.start(body, actor.user, "customer");
  }
}

/** 后台：强制交接发起 + 五步推进 + 查询 */
@Controller("admin/handovers")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class HandoverAdminController {
  constructor(private readonly handovers: HandoverService) {}

  @Get()
  list() {
    return { records: this.handovers.list() };
  }

  @Post()
  forced(
    @Body()
    body: {
      relationshipId: string;
      toAdvisorId?: string;
      reason: string;
      reviewers: string[];
    },
    @CurrentActor() actor: Actor
  ) {
    return this.handovers.start({ ...body, forced: true }, actor.user, "staff");
  }

  @Post(":id/freeze")
  freeze(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.handovers.freeze(id, actor.user);
  }

  @Post(":id/checklist")
  checklist(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.handovers.checklist(id, actor.user);
  }

  @Post(":id/accept")
  accept(
    @Param("id") id: string,
    @Body() body: { toAdvisorId: string },
    @CurrentActor() actor: Actor
  ) {
    return this.handovers.accept(id, body.toAdvisorId, actor.user);
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.handovers.complete(id, actor.user);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.handovers.cancel(id, actor.user);
  }
}
