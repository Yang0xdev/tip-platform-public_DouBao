import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { ConsentService, type ConsentAction } from "./consent.service.js";

/** 客户端：成员邀请、本人确认、撤回、监护证据、跨境单独同意（M3-05） */
@Controller("v1")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class ConsentCustomerController {
  constructor(private readonly consents: ConsentService) {}

  @Post("consents/invite")
  invite(@Body() body: { caseId: string; personRef: string }, @CurrentActor() actor: Actor) {
    return this.consents.invite(body.caseId, body.personRef, actor.user);
  }

  @Post("consents/self-confirm")
  selfConfirm(
    @Body() body: { grantId: string; actions: ConsentAction[]; validUntil: string },
    @CurrentActor() actor: Actor
  ) {
    return this.consents.selfConfirm(body.grantId, body, actor.user);
  }

  @Post("consents/revoke")
  revoke(@Body() body: { grantId: string; reason: string }, @CurrentActor() actor: Actor) {
    return this.consents.revoke(body.grantId, body.reason, actor.user, "customer");
  }

  @Get("consents")
  list(@Query("caseId") caseId: string) {
    return { records: this.consents.listGrantsForCase(caseId) };
  }

  @Post("guardianship/evidence")
  evidence(
    @Body() body: { caseId: string; childRef: string; artifactRef: string; fileHash: string },
    @CurrentActor() actor: Actor
  ) {
    return this.consents.submitGuardianshipEvidence(body.caseId, body.childRef, body, actor.user);
  }

  @Post("cross-border/consents")
  cross(
    @Body() body: { caseId: string; providerId: string; items: Array<{ scope: string }> },
    @CurrentActor() actor: Actor
  ) {
    return this.consents.recordCrossBorder(body.caseId, body.providerId, body.items, actor.user);
  }

  @Post("cross-border/consents/:id/revoke")
  crossRevoke(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.consents.revokeCrossBorder(id, actor.user);
  }
}

/** 后台：监护核验/争议、线下授权书登记、合规撤回（M3-05） */
@Controller("admin")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class ConsentAdminController {
  constructor(private readonly consents: ConsentService) {}

  @Post("guardianship/:id/verify")
  verifyG(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.consents.verifyGuardianship(id, actor.user);
  }

  @Post("guardianship/:id/dispute")
  disputeG(
    @Param("id") id: string,
    @Body() body: { reason: string },
    @CurrentActor() actor: Actor
  ) {
    return this.consents.raiseGuardianshipDispute(id, body.reason, actor.user);
  }

  @Post("consents/paper")
  paper(
    @Body()
    body: {
      caseId: string;
      personRef: string;
      artifactRef: string;
      actions: ConsentAction[];
      validUntil: string;
      verifierId: string;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.consents.registerPaper(body.caseId, body.personRef, body, actor.user);
  }

  @Get("consents")
  list(@Query("caseId") caseId: string) {
    return {
      grants: this.consents.listGrantsForCase(caseId),
      guardianships: this.consents.listGuardiansForCase(caseId)
    };
  }

  @Post("consents/:id/revoke")
  revoke(
    @Param("id") id: string,
    @Body() body: { reason: string },
    @CurrentActor() actor: Actor
  ) {
    return this.consents.revoke(id, body.reason, actor.user, "staff");
  }
}
