import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard, CurrentActor, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { CatalogService, projectView, feeView, type ProjectDraftInput, type FeeDraftInput } from "./catalog.service.js";

/**
 * 员工侧内容治理（M1-02/04/05/06）。仅 staff；全部动作留痕。
 */
@Controller("admin/catalog")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly audit: AuditService
  ) {}

  /* ---- 项目版本 ---- */

  @Get("projects")
  listProjects() {
    return { records: this.catalog.adminListProjects().map(projectView) };
  }

  @Post("projects/drafts")
  createProject(@Body() body: ProjectDraftInput, @CurrentActor() actor: Actor) {
    const rec = this.catalog.createProjectDraft(body, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "project.draft.create", resource: rec.id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  @Post("projects/:id/new-version")
  newVersion(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const rec = this.catalog.newProjectVersion(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "project.new_version", resource: rec.id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  @Post("projects/:id/draft")
  updateDraft(@Param("id") id: string, @Body() body: Partial<ProjectDraftInput>, @CurrentActor() actor: Actor) {
    return projectView(this.catalog.updateProjectDraft(id, body, actor.user));
  }

  @Post("projects/:id/submit-verification")
  submitVerification(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const rec = this.catalog.submitProjectForVerification(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "project.submit_verification", resource: id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  @Post("projects/:id/verification")
  verificationDecision(@Param("id") id: string, @Body() body: { decision: "pass" | "reject"; reason?: string }, @CurrentActor() actor: Actor) {
    const rec = body.decision === "pass"
      ? this.catalog.passVerification(id, actor.user)
      : this.catalog.rejectVerification(id, actor.user, body.reason ?? "");
    this.audit.record({ actor: actor.user, realm: "staff", action: `project.verification_${body.decision}`, resource: id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  @Post("projects/:id/publication")
  publicationDecision(@Param("id") id: string, @Body() body: { decision: "approve" | "reject"; reason?: string }, @CurrentActor() actor: Actor) {
    const rec = body.decision === "approve"
      ? this.catalog.approvePublication(id, actor.user)
      : this.catalog.rejectPublication(id, actor.user, body.reason ?? "");
    this.audit.record({ actor: actor.user, realm: "staff", action: `project.publication_${body.decision}`, resource: id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  @Post("projects/:id/suspend")
  suspend(@Param("id") id: string, @Body() body: { reasonCategory: string; handlingNote: string }, @CurrentActor() actor: Actor) {
    const rec = this.catalog.suspend(id, actor.user, body.reasonCategory, body.handlingNote);
    this.audit.record({ actor: actor.user, realm: "staff", action: "project.suspend", resource: id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  @Post("projects/:id/delist")
  delist(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const rec = this.catalog.delist(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "project.delist", resource: id, result: "allow", subjectRef: rec.code });
    return projectView(rec);
  }

  /* ---- 收费方案版本 ---- */

  @Get("fee-schedules")
  listFees() {
    return { records: this.catalog.adminListFees().map(feeView) };
  }

  @Post("fee-schedules/drafts")
  createFee(@Body() body: FeeDraftInput, @CurrentActor() actor: Actor) {
    const rec = this.catalog.createFeeDraft(body, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "fee.draft.create", resource: rec.id, result: "allow", subjectRef: rec.code });
    return feeView(rec);
  }

  @Post("fee-schedules/:id/submit")
  submitFee(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return feeView(this.catalog.submitFee(id, actor.user));
  }

  @Post("fee-schedules/:id/review")
  reviewFee(@Param("id") id: string, @Body() body: { event: "approve" | "reject" }, @CurrentActor() actor: Actor) {
    const rec = this.catalog.reviewFee(id, body.event, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: `fee.${body.event}`, resource: id, result: "allow", subjectRef: rec.code });
    return feeView(rec);
  }
}
