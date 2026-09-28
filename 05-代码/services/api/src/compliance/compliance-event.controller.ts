import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import {
  ComplianceEventService,
  type DispositionKind,
  type EventSource
} from "./compliance-event.service.js";

@Controller("admin/compliance-events")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ComplianceEventAdminController {
  constructor(private readonly events: ComplianceEventService) {}

  @Get()
  list() {
    return { records: this.events.list() };
  }

  @Post()
  open(
    @Body()
    body: {
      source: EventSource;
      level: "L1" | "L2" | "L3";
      title: string;
      detail: string;
      relatedTicketId?: string;
      respondentAdvisorId?: string;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.events.open(body, actor.user);
  }

  @Post(":id/triage")
  triage(
    @Param("id") id: string,
    @Body() body: { level: "L1" | "L2" | "L3"; note?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.events.triage(id, body.level, actor.user, body.note);
  }

  @Post(":id/investigate")
  investigate(
    @Param("id") id: string,
    @Body() body: { excluded?: string[] },
    @CurrentActor() actor: Actor
  ) {
    return this.events.investigate(id, actor.user, body.excluded);
  }

  @Post(":id/dispositions")
  disposition(
    @Param("id") id: string,
    @Body() body: { kind: DispositionKind; detail: string },
    @CurrentActor() actor: Actor
  ) {
    return this.events.addDisposition(id, body.kind, body.detail, actor.user);
  }

  @Post(":id/propose")
  propose(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.events.propose(id, actor.user);
  }

  @Post(":id/decide")
  decide(
    @Param("id") id: string,
    @Body() body: { secondApproverId?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.events.decide(id, actor.user, body.secondApproverId);
  }

  @Post(":id/dispositions/:did/approve")
  approveDisposition(
    @Param("id") id: string,
    @Param("did") did: string,
    @CurrentActor() actor: Actor
  ) {
    return this.events.approveDisposition(id, did, actor.user);
  }

  @Post(":id/close")
  close(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.events.close(id, actor.user);
  }

  @Post(":id/appeal")
  appeal(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.events.appeal(id, actor.user);
  }

  @Post(":id/appeal-review")
  appealReview(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.events.reviewAppeal(id, actor.user);
  }
}
