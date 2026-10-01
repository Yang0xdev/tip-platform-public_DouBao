import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard } from "../realm.guard.js";
import { AdvisorAiService } from "./advisor-ai.service.js";

/**
 * 顾问端 AI（初步）：建议问题 + 确定性 grounded 问答。
 * 路径前缀 /advisor/ai；仅 staff realm。
 */
@Controller("advisor/ai")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdvisorAiController {
  constructor(private readonly ai: AdvisorAiService) {}

  @Get("suggestions")
  suggestions() {
    return this.ai.suggestions();
  }

  @Post("ask")
  ask(@Body() body: { message: string }, @CurrentActor() actor: { user: string }) {
    return this.ai.ask(actor.user, body?.message ?? "");
  }
}
