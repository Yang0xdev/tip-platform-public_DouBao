import { Injectable } from "@nestjs/common";
import { VerificationService } from "../catalog/verification.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService } from "../advisors/onboarding.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { RuleSetService } from "../assessment/ruleset.service.js";

/**
 * 影子期内容看板与质量基线（PRD-M1 M1-17，A11 子集，只读）
 * 口径版本化、只建基线不设目标；样本不足（<5）显"样本积累中"；
 * 禁止获批率/成功率、成交额排名、把词库命中做成顾问简单负向计数。
 */
const MIN_SAMPLE = 5;

@Injectable()
export class QualityService {
  private readonly caliberVersion = "m1-baseline-v1";

  constructor(
    private readonly verifications: VerificationService,
    private readonly catalog: CatalogService,
    private readonly entities: EntityService,
    private readonly onboarding: OnboardingService,
    private readonly grants: AuthorizationService,
    private readonly rulesets: RuleSetService
  ) {}

  dashboard(now = new Date()) {
    const vrs = this.verifications.list();
    const projects = this.catalog.adminListProjects();
    const publishedProjects = projects.filter((p) => p.state === "published");
    const factIds = new Set(projects.flatMap((p) => p.keyFactIds));
    const facts = [...factIds].map((id) => vrs.find((v) => v.id === id)).filter(Boolean) as ReturnType<VerificationService["list"]>;
    const verified = facts.filter((f) => f.state === "verified" || f.state === "due").length;
    const due = facts.filter((f) => f.state === "due").length;
    const invalid = facts.filter((f) => f.state === "invalid").length;

    const entList = this.entities.list(now);
    const grants = this.grants.list();
    this.grants.refreshExpiry(now);
    const obs = this.onboarding.list();

    // 内容发布周期（草稿创建→发布，小时）
    const cycles = publishedProjects
      .map((p) => (new Date(p.updatedAt).getTime() - new Date(p.createdAt).getTime()) / 3_600_000)
      .filter((h) => h >= 0);

    const f = this.rulesets.funnel;
    const sample = (n: number, value: unknown) => (n < MIN_SAMPLE ? { note: "样本积累中", sample: n } : value);

    return {
      caliberVersion: this.caliberVersion,
      generatedAt: now.toISOString(),
      content: {
        publishedProjects: publishedProjects.length,
        verificationCoverage: facts.length === 0
          ? { note: "样本积累中" }
          : { verified, total: facts.length, rate: Number((verified / facts.length).toFixed(3)), due, invalid },
        publishCycleHoursMedian: sample(cycles.length, median(cycles)),
        suspendedOrDelisted: projects.filter((p) => p.state === "suspended" || p.state === "delisted").length
      },
      entities: {
        active: entList.filter((e) => e.usable).length,
        dueSoon: entList.filter((e) => e.displayStatus === "due_soon").length,
        unusable: entList.filter((e) => !e.usable).length
      },
      advisors: {
        onboarding: {
          draft: obs.filter((o) => o.state === "draft" || o.state === "correcting").length,
          submitted: obs.filter((o) => o.state === "submitted").length,
          approved: obs.filter((o) => o.state === "approved").length,
          rejected: obs.filter((o) => o.state === "rejected").length
        },
        grants: {
          authorized: grants.filter((g) => g.state === "authorized").length,
          expiring: grants.filter((g) => g.state === "expiring").length,
          expired: grants.filter((g) => g.state === "expired").length,
          reconfirmRequired: grants.filter((g) => g.state === "reconfirm_required").length
        }
      },
      assessmentFunnel: {
        started: f.started,
        completed: sample(f.started, f.completed),
        completionRate: sample(f.started, f.started === 0 ? null : Number((f.completed / f.started).toFixed(3))),
        note: "needs_manual 占比仅用于发现规则覆盖缺口，不做顾问考核"
      },
      prohibited: ["获批率/成功率", "成交额排名", "词库命中对顾问的简单负向计数"]
    };
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
