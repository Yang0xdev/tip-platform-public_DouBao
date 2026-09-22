import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AllowAnonymous, CurrentActor, RealmAllowed, RealmGuard, type Actor } from "../realm.guard.js";
import { AuditService } from "../audit.service.js";
import { AssessmentTemplateService, type TemplateKind, type QuestionnaireContent, type ResultTemplateContent } from "./template.service.js";
import { RuleSetService } from "./ruleset.service.js";
import type { Answers } from "@tip/core";

const DISCLAIMER = "信息整理与差距提示，不是资格认定、不构成法律意见、不代表获批结果，个案以官方审核为准。";

/** 员工侧：问卷/结论模板与规则集的编辑、复核、发布（M1-07/08） */
@Controller("admin/assessment")
@UseGuards(RealmGuard)
@RealmAllowed("staff")
export class AdminAssessmentController {
  constructor(
    private readonly templates: AssessmentTemplateService,
    private readonly rulesets: RuleSetService,
    private readonly audit: AuditService
  ) {}

  @Get("templates")
  listTemplates(@Query("kind") kind?: TemplateKind) {
    return { records: this.templates.list(kind) };
  }

  @Post("templates/:kind/drafts")
  draftTemplate(
    @Param("kind") kind: TemplateKind,
    @Body() body: { code: string; title: string; content: QuestionnaireContent | ResultTemplateContent },
    @CurrentActor() actor: Actor
  ) {
    if (kind !== "questionnaire" && kind !== "result_template") throw new Error("未知模板类型");
    return this.templates.createDraft(kind, body.code, body.title, body.content, actor.user);
  }

  @Post("templates/:id/submit")
  submitTemplate(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.templates.submit(id, actor.user);
  }

  @Post("templates/:id/review")
  reviewTemplate(@Param("id") id: string, @Body() body: { event: "approve" | "reject" }, @CurrentActor() actor: Actor) {
    const rec = this.templates.review(id, body.event, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: `assessment.template_${body.event}`, resource: id, result: "allow" });
    return rec;
  }

  @Get("rulesets")
  listRulesets(@Query("projectCode") projectCode?: string) {
    return { records: this.rulesets.list(projectCode) };
  }

  @Post("rulesets/drafts")
  draftRuleset(@Body() body: { projectCode: string; ruleSet: unknown }, @CurrentActor() actor: Actor) {
    return this.rulesets.createDraft(body.projectCode, body.ruleSet as never, actor.user);
  }

  @Post("rulesets/:id/submit")
  submitRuleset(@Param("id") id: string, @CurrentActor() actor: Actor) {
    return this.rulesets.submit(id, actor.user);
  }

  @Post("rulesets/:id/review")
  reviewRuleset(@Param("id") id: string, @Body() body: { event: "approve" | "reject" }, @CurrentActor() actor: Actor) {
    const rec = this.rulesets.review(id, body.event, actor.user);
    this.audit.record({ actor: actor.user, realm: "staff", action: `assessment.ruleset_${body.event}`, resource: id, result: "allow", subjectRef: rec.projectCode });
    return rec;
  }
}

/** 对客：只加载已发布模板；评估无状态计算（游客可用，不保存明细） */
@Controller("v1/assessment")
@UseGuards(RealmGuard)
@RealmAllowed("staff", "customer", "partner", "service")
@AllowAnonymous(["GET", "POST"])
export class PublicAssessmentController {
  constructor(
    private readonly templates: AssessmentTemplateService,
    private readonly rulesets: RuleSetService
  ) {}

  @Get("questionnaire")
  questionnaire() {
    const t = this.templates.requirePublished("questionnaire");
    return { id: t.id, code: t.code, version: t.version, title: t.title, content: t.content };
  }

  @Get("result-template")
  resultTemplate() {
    const t = this.templates.requirePublished("result_template");
    return { id: t.id, code: t.code, version: t.version, title: t.title, content: t.content };
  }

  @Post("evaluate")
  evaluate(@Body() body: { projectCode: string; answers: Answers }) {
    const q = this.templates.requirePublished("questionnaire");
    const result = this.rulesets.evaluate(body.projectCode, body.answers ?? {}, `q-v${q.version}`);
    const dims = result.dimensions;
    return {
      projectCode: body.projectCode,
      outcome: result.outcome,
      questionnaireVersion: result.questionnaireVersion,
      ruleVersion: result.ruleVersion,
      sections: {
        met: dims.filter((d) => d.status === "met"),
        gap: dims.filter((d) => d.status === "gap"),
        unconfirmed: dims.filter((d) => d.status === "unconfirmed"),
        sources: { note: "条件与核验日期见项目详情来源区", ruleVersion: result.ruleVersion }
      },
      notCommittedNote:
        result.outcome === "not_committed" ? "仍有必填项未完成，以下仅为已完成部分的信息整理，不构成确定性结论。" : null,
      needsManualNote: result.outcome === "eligible" ? null : "建议由顾问人工解读（即将开放）；M1 不产生顾问任务与归属。",
      disclaimer: DISCLAIMER
    };
  }
}
