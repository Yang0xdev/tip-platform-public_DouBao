import { HttpException, Injectable } from "@nestjs/common";
import {
  evaluate,
  feeScheduleMachine,
  type AssessmentRuleSet,
  type Answers,
  type AssessmentResult,
  type FeeScheduleState,
  type FeeScheduleEvent
} from "@tip/core";
import { VerificationService } from "../catalog/verification.service.js";
import { CatalogService } from "../catalog/catalog.service.js";

/**
 * 初评规则集（PRD-M1 M1-08 / C06 引擎）
 * 随项目版本管理：草稿→合规复核中→已发布→被替代；
 * 发布门：每个维度证据（核验记录 ID）全部 verified，且核验人≠规则集编辑人；
 * 项目必须已有已发布版本。计算由服务端无状态完成，不输出分数/概率/成功率。
 */

export interface RuleSetRecord {
  id: string;
  projectCode: string;
  version: number;
  ruleSet: AssessmentRuleSet;
  state: FeeScheduleState;
  editorId: string;
  reviewerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export class RuleSetError extends HttpException {
  constructor(status: number, bizCode: string, message: string, details?: unknown) {
    super({ code: bizCode, message, details }, status);
  }
}

@Injectable()
export class RuleSetService {
  private records = new Map<string, RuleSetRecord>();
  private seq = 0;

  constructor(
    private readonly verifications: VerificationService,
    private readonly catalog: CatalogService
  ) {}

  createDraft(projectCode: string, ruleSet: Omit<AssessmentRuleSet, "version">, editor: string): RuleSetRecord {
    if (!projectCode?.trim()) throw new RuleSetError(400, "40070", "项目编码必填");
    if (!ruleSet.requiredQuestions?.length || !ruleSet.dimensions?.length) {
      throw new RuleSetError(400, "40071", "规则集必须包含关键题与维度");
    }
    if (this.catalog.listPublishedProjects().every((p) => p.code !== projectCode)) {
      throw new RuleSetError(422, "42270", "项目尚无已发布版本，规则集不可创建");
    }
    this.seq += 1;
    const now = new Date().toISOString();
    const rec: RuleSetRecord = {
      id: `RULE-${String(this.seq).padStart(4, "0")}`,
      projectCode,
      version: this.nextVersion(projectCode),
      ruleSet: { ...ruleSet, version: `rules-${projectCode}-v${this.nextVersion(projectCode)}` },
      state: "draft",
      editorId: editor,
      reviewerId: null,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(rec.id, rec);
    return { ...rec };
  }

  submit(id: string, actor: string): RuleSetRecord {
    const rec = this.require(id);
    if (rec.editorId !== actor) throw new RuleSetError(403, "40302", "仅编辑人可提交");
    return this.move(rec, "submit", { authorId: rec.editorId, reviewerId: rec.reviewerId });
  }

  review(id: string, event: "approve" | "reject", reviewer: string): RuleSetRecord {
    const rec = this.require(id);
    if (event === "approve") {
      // 证据门：维度证据全部核验通过，核验人≠规则集最后编辑人
      const evidenceIds = [...new Set(rec.ruleSet.dimensions.flatMap((d) => d.evidenceVerificationIds ?? []))];
      if (evidenceIds.length === 0) throw new RuleSetError(422, "RULE_EVIDENCE_REQUIRED", "每个维度必须关联核验证据");
      this.verifications.assertPublishable(evidenceIds, rec.editorId);
    }
    const moved = this.move(rec, event, { authorId: rec.editorId, reviewerId: reviewer });
    moved.reviewerId = reviewer;
    if (event === "approve") {
      for (const other of this.records.values()) {
        if (other.id !== rec.id && other.projectCode === rec.projectCode && other.state === "published") {
          this.move(other, "supersede", { authorId: other.editorId, reviewerId: other.reviewerId });
        }
      }
    }
    return { ...moved };
  }

  list(projectCode?: string): RuleSetRecord[] {
    return [...this.records.values()].filter((r) => !projectCode || r.projectCode === projectCode).map((r) => ({ ...r }));
  }

  published(projectCode: string): RuleSetRecord | null {
    const found = this.list(projectCode).filter((r) => r.state === "published").sort((a, b) => b.version - a.version)[0];
    return found ?? null;
  }

  /** 无状态计算：仅使用已发布问卷版本与已发布规则集；相同输入幂等 */
  evaluate(projectCode: string, answers: Answers, questionnaireVersion: string): AssessmentResult {
    const rec = this.published(projectCode);
    if (!rec) throw new RuleSetError(404, "40470", "当前试点暂无匹配路径");
    return evaluate(rec.ruleSet, answers, questionnaireVersion);
  }

  private nextVersion(projectCode: string): number {
    const same = this.list(projectCode);
    return same.length === 0 ? 1 : Math.max(...same.map((r) => r.version)) + 1;
  }

  private require(id: string): RuleSetRecord {
    const rec = this.records.get(id);
    if (!rec) throw new RuleSetError(404, "40470", "规则集不存在");
    return rec;
  }

  private move(rec: RuleSetRecord, event: FeeScheduleEvent, ctx: { authorId: string; reviewerId: string | null }): RuleSetRecord {
    const out = feeScheduleMachine.transition(ctx, rec.state, event);
    if (!out.ok || !out.to) throw new RuleSetError(409, out.code === "FSM_ILLEGAL_TRANSITION" ? "40901" : (out.code ?? "40901"), out.reason ?? "状态迁移被拒绝");
    rec.state = out.to;
    rec.updatedAt = new Date().toISOString();
    this.records.set(rec.id, { ...rec });
    return rec;
  }
}
