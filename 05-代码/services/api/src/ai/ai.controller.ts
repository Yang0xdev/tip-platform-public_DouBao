import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { AiContextService, type ContextKind } from "./context.service.js";
import { AiService } from "./ai.service.js";

/**
 * 客户端 AI（初步）：单独同意、建议问题、确定性 grounded 问答。
 * 路径前缀 /v1/ai；仅客户 realm。
 */
@Controller("v1/ai")
@UseGuards(RealmGuard)
@RealmAllowed("customer")
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly contextSvc: AiContextService
  ) {}

  /** U1：授权上下文包（grounded 片段） */
  @Get("context")
  context(
    @CurrentActor() actor: Actor,
    @Query("kind") kind: ContextKind,
    @Query("caseId") caseId?: string,
    @Query("projectCodes") projectCodes?: string
  ) {
    return this.contextSvc.build(
      actor.user,
      kind ?? "general",
      {
        caseId: caseId || undefined,
        projectCodes: projectCodes ? projectCodes.split(",").filter(Boolean) : undefined
      }
    );
  }

  @Get("consent")
  consent(@CurrentActor() actor: Actor) {
    return this.ai.getConsent(actor.user);
  }

  @Post("consent")
  setConsent(@Body() body: { granted: boolean }, @CurrentActor() actor: Actor) {
    this.ai.setConsent(actor.user, body?.granted === true, actor.user);
    return this.ai.getConsent(actor.user);
  }

  @Get("suggestions")
  suggestions() {
    return this.ai.suggestions();
  }

  @Post("ask")
  ask(@Body() body: { message: string }, @CurrentActor() actor: Actor) {
    return this.ai.ask(actor.user, body?.message ?? "");
  }
}
