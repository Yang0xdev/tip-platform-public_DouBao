import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "../audit.service.js";
import { CurrentActor, RealmAllowed, RealmGuard } from "../realm.guard.js";
import { AiService } from "./ai.service.js";
import { KnowledgeService, type KnowledgeKind, type KnowledgeState } from "./knowledge.service.js";

/**
 * 总后台 AI 知识与运营中心（初步）：
 *  - /admin/ai-knowledge：知识条目四眼（编制→提交→复核→发布/失效）；
 *  - /admin/ai/metrics：AI 使用与转人工等系统指标（只含系统可计数项，不含业务效果）。
 */
@Controller()
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiService,
    private readonly auditSvc: AuditService
  ) {}

  /* ---------- 知识条目 ---------- */

  @Get("admin/ai-knowledge")
  list(@Query("state") state?: KnowledgeState) {
    return this.knowledge.list(state);
  }

  @Post("admin/ai-knowledge/ingest")
  ingest(
    @Body() body: { title: string; kind: KnowledgeKind; body: string; sourceRef: string; level?: "cu" | "co" | "sp" | "off" },
    @CurrentActor() actor: { user: string }
  ) {
    return this.knowledge.ingest(actor.user, body);
  }

  @Post("admin/ai-knowledge/:id/submit")
  submit(@Param("id") id: string, @CurrentActor() actor: { user: string }) {
    return this.knowledge.submit(id, actor.user);
  }

  @Post("admin/ai-knowledge/:id/review")
  review(
    @Param("id") id: string,
    @Body() body: { decision: "approve" | "reject"; reason?: string },
    @CurrentActor() actor: { user: string }
  ) {
    return this.knowledge.review(id, actor.user, body.decision, body.reason);
  }

  @Post("admin/ai-knowledge/:id/invalidate")
  invalidate(@Param("id") id: string, @Body() body: { reason: string }, @CurrentActor() actor: { user: string }) {
    return this.knowledge.invalidate(id, actor.user, body.reason);
  }

  /* ---------- 运营指标 ---------- */

  @Get("admin/ai/metrics")
  metrics() {
    return {
      records: [
        { key: "customer_asks", label: "客户 AI 提问", value: this.auditSvc.countAction("ai.ask") },
        { key: "advisor_asks", label: "顾问 AI 提问", value: this.auditSvc.countAction("advisor.ai.ask") },
        { key: "fallback", label: "转人工（无依据兜底）", value: this.auditSvc.countAction("ai.ask", "fallback") },
        { key: "consents", label: "已授权客户", value: this.ai.consentCount() },
        { key: "knowledge_published", label: "已发布知识条目", value: this.knowledge.published().records.length }
      ],
      note: "拦截数/采纳率等指标在 LLM 接入后启用；本版不含获批率等业务效果指标。"
    };
  }
}
