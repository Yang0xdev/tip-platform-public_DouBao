import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { WikiService, type PageState } from "./wiki.service.js";

/**
 * K1 Wiki 管理端点（admin/wiki/*，staff）。
 */
@Controller("admin/wiki")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class WikiController {
  constructor(private readonly wiki: WikiService) {}

  @Get("sources")
  sources() {
    return this.wiki.listSources();
  }

  @Post("sources")
  ingest(
    @Body()
    body: {
      kind: "document" | "regulation" | "fee" | "education";
      title: string;
      body: string;
      sourceRef: string;
      level?: "cu" | "co" | "sp" | "off";
    },
    @CurrentActor() actor: Actor
  ) {
    return this.wiki.ingestSource(actor.user, body);
  }

  @Post("sources/invalidate")
  invalidate(@Body() body: { sourceId: string; reason: string }, @CurrentActor() actor: Actor) {
    return this.wiki.invalidateForSource(actor.user, body.sourceId, body.reason);
  }

  @Get("pages")
  pages(@Query("state") state?: PageState) {
    return this.wiki.listPages(state);
  }

  @Post("compile")
  compile(
    @Body()
    body: {
      title: string;
      slug: string;
      sourceIds: string[];
      markdown?: string;
      compiledWith?: "manual" | "qwen";
    },
    @CurrentActor() actor: Actor
  ) {
    return this.wiki.compileDraft(actor.user, body);
  }

  @Post("lint")
  lint(@Body() body: { pageId: string }, @CurrentActor() actor: Actor) {
    return this.wiki.lint(actor.user, body.pageId);
  }

  @Post("submit")
  submit(@Body() body: { pageId: string }, @CurrentActor() actor: Actor) {
    return this.wiki.submit(actor.user, body.pageId);
  }

  @Post("review")
  review(
    @Body() body: { pageId: string; approve: boolean; reason?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.wiki.review(actor.user, body.pageId, body.approve === true, body.reason);
  }

  @Get("gaps")
  gaps() {
    return this.wiki.gaps();
  }
}
