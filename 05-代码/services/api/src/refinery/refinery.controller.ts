import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import type { DocType } from "./refinery.types.js";
import { RefineryService } from "./refinery.service.js";

/**
 * AI 数据工厂管理端点（admin/refinery/*，staff）。
 * 七工段：ingest → classify → parse → extract → normalize → validate → publish
 */
@Controller("admin/refinery")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class RefineryController {
  constructor(private readonly refinery: RefineryService) {}

  /* ① 采集 */
  @Post("sources/ingest-text")
  ingestText(
    @Body()
    body: {
      title: string; content: string; sourceType?: "folder" | "scan" | "email" | "export" | "manual" | "api";
      format?: "text/plain" | "text/html" | "text/markdown" | "spreadsheet";
      sensitivity?: "normal" | "sensitive";
    },
    @CurrentActor() actor: Actor
  ) {
    return this.refinery.ingestText(actor.user, body);
  }

  @Post("sources/ingest-pdf")
  async ingestPdf(
    @Body() body: { title: string; base64: string; sensitivity?: "normal" | "sensitive" },
    @CurrentActor() actor: Actor
  ) {
    return this.refinery.ingestPdf(actor.user, body);
  }

  /** 批量采集（文件夹多选/导入）；auto=true 自动跑到待复核 */
  @Post("sources/ingest-batch")
  async ingestBatch(
    @Body() body: { items: Array<{ title: string; content: string }>; auto?: boolean },
    @CurrentActor() actor: Actor
  ) {
    const ids: string[] = [];
    for (const item of body.items ?? []) {
      try {
        const raw = this.refinery.ingestText(actor.user, {
          title: item.title, content: item.content, sourceType: "folder"
        });
        if (body.auto !== false) await this.refinery.autoRun(actor.user, raw.id);
        ids.push(raw.id);
      } catch {
        /* 重复/空内容跳过 */
      }
    }
    return { ingested: ids };
  }

  /** 浏览器侧视觉解析回传版面块 */
  @Post("sources/:id/blocks")
  setBlocks(
    @Param("id") id: string,
    @Body() body: { blocks: unknown },
    @CurrentActor() actor: Actor
  ) {
    return this.refinery.setBlocks(actor.user, id, body.blocks as never);
  }

  @Get("sources")
  list() {
    return this.refinery.list();
  }

  @Get("sources/:id")
  get(@Param("id") id: string) {
    return this.refinery.get(id);
  }

  /* ② 分诊 */
  @Post("sources/:id/classify")
  classify(
    @Param("id") id: string,
    @Body() body: { override?: DocType },
    @CurrentActor() actor: Actor
  ) {
    return this.refinery.classify(actor.user, id, body.override);
  }

  /* ③ 解析 */
  @Post("sources/:id/parse")
  parse(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.refinery.parse(actor.user, id);
  }

  /* ④ 抽取 */
  @Post("sources/:id/extract")
  extract(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.refinery.extract(actor.user, id);
  }

  @Post("sources/:id/correct-field")
  correct(
    @Param("id") id: string,
    @Body() body: { key: string; value: string },
    @CurrentActor() actor: Actor
  ) {
    return this.refinery.correctField(actor.user, id, body.key, body.value);
  }

  /* ⑤ 清洗 */
  @Post("sources/:id/normalize")
  normalize(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.refinery.normalize(actor.user, id);
  }

  /* ⑥ 校验 + 四眼 */
  @Post("sources/:id/lint")
  lint(@Param("id") id: string) {
    return this.refinery.lint(id);
  }

  @Post("sources/:id/submit")
  submit(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.refinery.submitForReview(actor.user, id);
  }

  @Post("sources/:id/review")
  review(
    @Param("id") id: string,
    @Body() body: { decision: "approve" | "reject"; reason?: string },
    @CurrentActor() actor: Actor
  ) {
    return this.refinery.review(actor.user, id, body.decision, body.reason);
  }

  /* ⑦ 发布 */
  @Post("sources/:id/publish")
  publish(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.refinery.publish(actor.user, id);
  }

  /* 自动跑到待复核 */
  @Post("sources/:id/auto-run")
  autoRun(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.refinery.autoRun(actor.user, id);
  }

  /* 血缘 */
  @Get("sources/:id/lineage")
  lineage(@Param("id") id: string) {
    return this.refinery.lineage(id);
  }

  /* 规范记录 */
  @Get("canonical")
  canonical() {
    return this.refinery.listCanonical();
  }

  /* 看板 */
  @Get("dashboard")
  dashboard() {
    return this.refinery.dashboard();
  }

  /* 示例包 */
  @Post("sample-pack")
  samplePack(@CurrentActor() actor: Actor) {
    return this.refinery.loadSamplePack(actor.user);
  }
}
