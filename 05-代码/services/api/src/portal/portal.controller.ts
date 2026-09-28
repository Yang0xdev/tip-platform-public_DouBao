import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { PortalService } from "./portal.service.js";

/** 后台：门户账号开通、批次授权审批、时钟回收 */
@Controller("admin/portal")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class PortalAdminController {
  constructor(private readonly portal: PortalService) {}

  @Get("accounts")
  accounts(@Body() body: { providerId?: string }) {
    return { records: this.portal.listAccounts(body.providerId) };
  }

  @Post("accounts")
  open(
    @Body() body: { providerId: string; login: string; name: string },
    @CurrentActor() actor: Actor
  ) {
    return this.portal.openAccount(body.providerId, body, actor.user);
  }

  @Post("accounts/:id/setup")
  setup(@Param("id") id: string, @Body() body: { step: "realname" | "mfa" }, @CurrentActor() actor: Actor) {
    return this.portal.completeAccountSetup(id, body.step, actor.user);
  }

  @Get("grants")
  grants(@Body() body: { providerId?: string }) {
    return { records: this.portal.listGrants(body.providerId) };
  }

  @Post("grants")
  createGrant(
    @Body()
    body: {
      providerId: string;
      caseId: string;
      materialScopes: string[];
      actions: Array<"roster" | "report_upload" | "material_view">;
      validUntil?: string;
    },
    @CurrentActor() actor: Actor
  ) {
    return this.portal.createGrant(body.providerId, body.caseId, body, actor.user);
  }

  @Post("grants/:id/approve-view")
  approveView(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.portal.approveView(id, actor.user);
  }

  @Post("grants/:id/original/request")
  requestOriginal(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.portal.requestOriginal(id, actor.user);
  }

  @Post("grants/:id/original/approve")
  approveOriginal(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.portal.approveOriginal(id, actor.user);
  }

  @Post("grants/:id/revoke")
  revoke(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.portal.revokeGrant(id, body.reason, actor.user);
  }

  @Post("tick")
  tick(@Body() body: { nowIso: string }) {
    return { records: this.portal.tick(body.nowIso) };
  }
}

/** 服务方门户（partner realm）：可见案件、受控阅读器、水印 PDF、报告提交 */
@Controller("portal")
@UseGuards(RealmGuard)
@RealmAllowed("partner")
export class PortalPartnerController {
  constructor(private readonly portal: PortalService) {}

  @Get("profile")
  profile(@CurrentActor() actor: Actor) {
    return { login: actor.user };
  }

  @Get("cases")
  cases(@CurrentActor() actor: Actor) {
    return { records: this.portal.visibleCases(actor.user) };
  }

  @Post("reader")
  openReader(
    @Body() body: { caseId: string; scope: string },
    @CurrentActor() actor: Actor
  ) {
    return this.portal.openReader(actor.user, body.caseId, body.scope);
  }

  @Post("reader/:id/page")
  page(@Param("id") id: string, @Body() body: { page: number }, @CurrentActor() actor: Actor) {
    this.portal.viewPage(id, body.page, actor.user);
    return { ok: true };
  }

  @Post("reader/:id/close")
  close(@Param("id") id: string, @CurrentActor() actor: Actor) {
    this.portal.closeReader(id, actor.user);
    return { ok: true };
  }

  @Post("pdf")
  pdf(@Body() body: { caseId: string; scope: string }, @CurrentActor() actor: Actor) {
    return this.portal.requestWatermarkedPdf(actor.user, body.caseId, body.scope);
  }

  @Post("reports")
  report(
    @Body() body: { caseId: string; kind: string; title: string; detail?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.portal.submitReport(actor.user, body.caseId, body, actor.user);
  }
}
