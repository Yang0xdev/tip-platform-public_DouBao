import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AllowAnonymous, CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { OnboardingService, COMMITMENT_KEYS, type CommitmentKey, type OnboardingDraftInput } from "./onboarding.service.js";
import { AuthorizationService, LEARNING_MATERIALS, MATERIAL_VERSIONS, type MaterialKey } from "./authorization.service.js";
import { AdvisorCardService } from "./advisor-card.service.js";

/** 顾问自助端（M1 realm 统一为 staff，角色细分在 Keycloak 接入后落地） */
@Controller("advisor")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdvisorController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly grants: AuthorizationService,
    private readonly audit: AuditService
  ) {}

  @Post("onboarding/drafts")
  draft(@Body() body: OnboardingDraftInput, @CurrentActor() actor: Actor) {
    return this.onboarding.createDraft(body, actor.user);
  }

  @Get("onboarding/mine")
  mine(@CurrentActor() actor: Actor) {
    return this.onboarding.getByAdvisor(actor.user) ?? { state: "none" };
  }

  @Post("onboarding/:id/commitment")
  commitment(@Param("id") id: string, @Body() body: { key: CommitmentKey }, @CurrentActor() actor: Actor) {
    return this.onboarding.signCommitment(id, body.key, actor.user);
  }

  @Post("onboarding/:id/training")
  training(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.onboarding.confirmTraining(id, actor.user);
  }

  @Post("onboarding/:id/submit")
  submit(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const rec = this.onboarding.submit(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "onboarding.submit", resource: id, result: "allow" });
    return rec;
  }

  @Get("learning/materials")
  materials() {
    return { materials: LEARNING_MATERIALS.map((m) => ({ ...m, version: MATERIAL_VERSIONS[m.key] })) };
  }

  @Post("grants/:projectCode/start")
  startGrant(@Param("projectCode") projectCode: string, @CurrentActor() actor: Actor) {
    return this.grants.start(actor.user, projectCode);
  }

  @Post("grants/:projectCode/confirm")
  confirm(@Param("projectCode") projectCode: string, @Body() body: { materialKey: MaterialKey }, @CurrentActor() actor: Actor) {
    return this.grants.confirmMaterial(actor.user, projectCode, body.materialKey);
  }

  @Post("grants/:projectCode/submit")
  submitGrant(@Param("projectCode") projectCode: string, @Body() body: { requestedDays?: number }, @CurrentActor() actor: Actor) {
    const rec = this.grants.submit(actor.user, projectCode, body.requestedDays);
    this.audit.record({ actor: actor.user, realm: "staff", action: "grant.submit", resource: rec.id, result: "allow", subjectRef: projectCode });
    return rec;
  }

  @Get("grants")
  myGrants(@CurrentActor() actor: Actor) {
    return { records: this.grants.list(actor.user) };
  }
}

/** 员工管理侧：入驻审核、自述审核、授权审批 */
@Controller("admin/advisors")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdminAdvisorController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly grants: AuthorizationService,
    private readonly audit: AuditService
  ) {}

  @Get("onboarding")
  listOnboarding() {
    return { records: this.onboarding.list() };
  }

  @Post(":id/approve")
  approve(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const rec = this.onboarding.approve(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "onboarding.approve", resource: id, result: "allow" });
    return rec;
  }

  @Post(":id/reject")
  reject(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    const rec = this.onboarding.reject(id, actor.user, body.reason);
    this.audit.record({ actor: actor.user, realm: "staff", action: "onboarding.reject", resource: id, result: "allow", reason: body.reason });
    return rec;
  }

  @Post(":id/correction")
  correction(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: Actor) {
    return this.onboarding.requestCorrection(id, actor.user, body.reason);
  }

  @Post(":id/self-intro")
  selfIntro(@Param("id") id: string, @Body() body: { decision: "approve" | "reject" }, @CurrentActor() actor: Actor) {
    const rec = this.onboarding.reviewSelfIntro(id, actor.user, body.decision);
    this.audit.record({ actor: actor.user, realm: "staff", action: "onboarding.self_intro_" + body.decision, resource: id, result: "allow" });
    return rec;
  }

  @Get("grants")
  listGrants() {
    return { records: this.grants.list() };
  }

  @Post("grants/:advisorUserId/:projectCode/approve")
  approveGrant(@Param("advisorUserId") advisorUserId: string, @Param("projectCode") projectCode: string, @CurrentActor() actor: Actor) {
    const rec = this.grants.approve(actor.user, advisorUserId, projectCode);
    this.audit.record({ actor: actor.user, realm: "staff", action: "grant.approve", resource: rec.id, result: "allow", subjectRef: projectCode });
    return rec;
  }

  @Post("grants/:advisorUserId/:projectCode/reject")
  rejectGrant(
    @Param("advisorUserId") advisorUserId: string,
    @Param("projectCode") projectCode: string,
    @Body() body: { reason: string },
    @CurrentActor() actor: Actor
  ) {
    return this.grants.reject(actor.user, advisorUserId, projectCode, body.reason);
  }
}

/** 客户端只读名片（M1-11），游客可读，仅白名单字段 */
@Controller("v1/advisor-cards")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "customer", "partner", "service")
@AllowAnonymous()
export class PublicAdvisorCardController {
  constructor(private readonly cards: AdvisorCardService) {}

  @Get()
  list(@Query("projectCode") projectCode: string) {
    return { records: this.cards.listForProject(projectCode) };
  }
}
