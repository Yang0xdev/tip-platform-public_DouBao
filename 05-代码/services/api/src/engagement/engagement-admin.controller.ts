import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { EngagementService, type ConsultationSource } from "./engagement.service.js";

/** 后台 A04：分配队列、手工录入、冲突裁决、关系总览（M2-01/02） */
@Controller("admin/engagements")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class EngagementAdminController {
  constructor(private readonly engagements: EngagementService) {}

  @Get("queue")
  queue() {
    return { records: this.engagements.adminQueue() };
  }

  @Get("relationships")
  relationships() {
    return { records: this.engagements.adminListRelationships() };
  }

  @Post(":id/assign")
  assign(@Param("id") id: string, @Body() body: { advisorId: string }, @CurrentActor() actor: Actor) {
    return this.engagements.assign(id, body.advisorId, actor.user);
  }

  @Post(":id/resolve-conflict")
  resolve(
    @Param("id") id: string,
    @Body() body: { advisorId: string | null; reason: string },
    @CurrentActor() actor: Actor
  ) {
    return this.engagements.resolveConflict(id, actor.user, body.advisorId ?? null, body.reason);
  }

  /** 平台外登记（后台手工录入，标来源 manual） */
  @Post("manual")
  manual(
    @Body()
    body: {
      customerRef: string;
      source?: ConsultationSource;
      duplicateKey?: string | null;
      advisorId?: string | null;
      projectCode?: string | null;
      note?: string | null;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.engagements.capture({
      source: body.source ?? "manual",
      customerRef: body.customerRef,
      duplicateKey: body.duplicateKey ?? null,
      advisorId: body.advisorId ?? null,
      projectCode: body.projectCode ?? null,
      note: body.note ?? null,
      actor: actor.user
    });
  }
}
