import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { ProviderService, type ProviderAgreement, type ProviderType } from "./provider.service.js";

/** 后台 A02：服务方准入全流程（ext/in 同控制点） */
@Controller("admin/providers")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ProviderAdminController {
  constructor(private readonly providers: ProviderService) {}

  @Get()
  list() {
    return { records: this.providers.list() };
  }

  @Post()
  create(
    @Body() body: { type: ProviderType; mode: "ext" | "in"; name: string; domesticEntityId?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.providers.create(body, actor.user);
  }

  @Post(":id/domestic-entity")
  link(@Param("id") id: string, @Body() body: { entityId: string }, @CurrentActor() actor: Actor) {
    return this.providers.linkDomesticEntity(id, body.entityId, actor.user);
  }

  @Post(":id/license")
  license(
    @Param("id") id: string,
    @Body() body: { credentialNo: string; country: string; issuedAt: string; expiresAt: string },
    @CurrentActor() actor: Actor
  ) {
    return this.providers.attachLicense(id, body, actor.user);
  }

  @Post(":id/license/verify")
  verifyLicense(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.providers.verifyLicense(id, actor.user);
  }

  @Post(":id/agreement")
  agreement(
    @Param("id") id: string,
    @Body() body: { key: keyof ProviderAgreement },
    @CurrentActor() actor: Actor
  ) {
    return this.providers.setAgreement(id, body.key, actor.user);
  }

  @Post(":id/submit")
  submit(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.providers.submit(id, actor.user);
  }

  @Post(":id/review")
  review(
    @Param("id") id: string,
    @Body() body: { decision: "active" | "incomplete" },
    @CurrentActor() actor: Actor
  ) {
    return this.providers.review(id, body.decision, actor.user);
  }

  @Post(":id/suspend")
  suspend(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.providers.suspend(id, body.reason, actor.user);
  }

  @Post(":id/terminate")
  terminate(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.providers.terminate(id, body.reason, actor.user);
  }

  @Post("tick")
  tick(@Body() body: { nowIso: string }) {
    return { records: this.providers.tick(body.nowIso) };
  }
}
