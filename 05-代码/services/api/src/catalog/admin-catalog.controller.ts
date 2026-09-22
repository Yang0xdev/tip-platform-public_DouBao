import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { RealmAllowed, RealmGuard, CurrentActor, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { CatalogService, toPublicView, type CatalogKind, type DraftInput } from "./catalog.service.js";

/**
 * 员工侧内容治理（M1-02/04/05/06）：草稿、提交、四眼复核、列表（含全部状态）。
 * 仅 staff；所有动作留痕。
 */
@Controller("admin/catalog")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly audit: AuditService
  ) {}

  @Get(":kind")
  list(@Param("kind") kind: string, @CurrentActor() actor: Actor) {
    const k = asKind(kind);
    return { records: this.catalog.adminList(k).map(toPublicView) };
  }

  @Post(":kind/drafts")
  createDraft(@Param("kind") kind: string, @Body() body: DraftInput, @CurrentActor() actor: Actor) {
    const rec = this.catalog.createDraft(asKind(kind), body, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "catalog.draft.create", resource: rec.id, result: "allow", subjectRef: rec.code });
    return toPublicView(rec);
  }

  @Post(":kind/:id/submit")
  submit(@Param("kind") kind: string, @Param("id") id: string, @CurrentActor() actor: Actor) {
    asKind(kind);
    const rec = this.catalog.submit(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "catalog.submit", resource: id, result: "allow", subjectRef: rec.code });
    return toPublicView(rec);
  }

  @Post(":kind/:id/review")
  review(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() body: { event: "approve" | "reject" | "suspend"; ackWarnings?: boolean },
    @CurrentActor() actor: Actor
  ) {
    asKind(kind);
    const rec = this.catalog.review(id, body.event, actor.user, Boolean(body.ackWarnings));
    this.audit.record({ actor: actor.user, realm: "staff", action: `catalog.${body.event}`, resource: id, result: "allow", subjectRef: rec.code });
    return toPublicView(rec);
  }

  @Post(":kind/:id/revise")
  revise(@Param("kind") kind: string, @Param("id") id: string, @CurrentActor() actor: Actor) {
    asKind(kind);
    const rec = this.catalog.revise(id, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: "catalog.revise", resource: id, result: "allow", subjectRef: rec.code });
    return toPublicView(rec);
  }
}

function asKind(kind: string): CatalogKind {
  if (kind === "projects") return "project";
  if (kind === "fee-schedules") return "fee_schedule";
  throw new BadRequestException({ code: "40003", message: "未知内容类型" });
}
