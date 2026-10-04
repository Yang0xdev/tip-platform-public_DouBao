import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

import { CatalogService } from "../catalog/catalog.service.js";
import { VerificationService } from "../catalog/verification.service.js";
import { EntityService } from "../entities/entity.service.js";
import { AdvisorCardService } from "../advisors/advisor-card.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { OnboardingService } from "../advisors/onboarding.service.js";
import { RuleSetService } from "../assessment/ruleset.service.js";
import { AssessmentTemplateService } from "../assessment/template.service.js";
import { DataSourceService } from "../globalaccess/data-source.service.js";
import { QualityService } from "../quality/quality.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { ProposalService } from "../proposal/proposal.service.js";
import { OrderService } from "../order/order.service.js";
import { PaymentService } from "../payment/payment.service.js";
import { ClientDetailService } from "../clientdetail/clientdetail.service.js";
import { IpadService } from "../ipad/ipad.service.js";
import { CaseService } from "../case/case.service.js";
import { TaskService } from "../task/task.service.js";
import { MaterialService } from "../material/material.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import { ConsentService } from "../consent/consent.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { ProviderService } from "../provider/provider.service.js";
import { PortalService } from "../portal/portal.service.js";
import { HandoverService } from "../handover/handover.service.js";
import { TicketService } from "../ticket/ticket.service.js";
import { CommissionService } from "../commission/commission.service.js";
import { ComplianceEventService } from "../compliance/compliance-event.service.js";
import { DeletionService } from "../deletion/deletion.service.js";
import { InviteService } from "../invite/invite.service.js";
import { AiService } from "../ai/ai.service.js";
import { AdvisorAiService } from "../ai/advisor-ai.service.js";
import { KnowledgeService } from "../ai/knowledge.service.js";
import { WikiService } from "../wiki/wiki.service.js";

/* ============ 深快照 / 深恢复（只处理纯数据，类实例一律跳过） ============ */

const M_BIGINT = "__bigint__";
const M_DATE = "__date__";
const M_MAP = "__map__";
const M_SET = "__set__";

type Snapshot = unknown;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function snapshotValue(v: unknown): Snapshot {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  if (t === "bigint") return { [M_BIGINT]: (v as bigint).toString() };
  if (t === "function") return undefined;
  if (v instanceof Date) return { [M_DATE]: v.toISOString() };
  if (v instanceof Map) {
    return {
      [M_MAP]: [...v.entries()].map(([k, val]) => [snapshotValue(k), snapshotValue(val)])
    };
  }
  if (v instanceof Set) {
    return { [M_SET]: [...v.values()].map((x) => snapshotValue(x)) };
  }
  if (Array.isArray(v)) return v.map((x) => snapshotValue(x));
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      const s = snapshotValue(val);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  // 其他类实例（注入的服务、Logger、机器对象等）跳过
  return undefined;
}

function restoreValue(v: Snapshot): unknown {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((x) => restoreValue(x));
  if (isPlainObject(v)) {
    if (M_BIGINT in v) return BigInt(String(v[M_BIGINT]));
    if (M_DATE in v) return new Date(String(v[M_DATE]));
    if (M_MAP in v) {
      const entries = (v[M_MAP] as unknown[][]).map((pair) => [
        restoreValue(pair[0]),
        restoreValue(pair[1])
      ]);
      return new Map(entries as [unknown, unknown][]);
    }
    if (M_SET in v) return new Set((v[M_SET] as unknown[]).map((x) => restoreValue(x)));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = restoreValue(val);
    return out;
  }
  return v;
}

function snapshotInstance(inst: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(inst)) {
    if (key === "constructor") continue;
    let value: unknown;
    try {
      const desc = Object.getOwnPropertyDescriptor(inst, key);
      if (!desc || !("value" in desc)) continue; // 跳过 getter
      value = (inst as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    const s = snapshotValue(value);
    if (s !== undefined) out[key] = s;
  }
  return out;
}

function restoreInstance(inst: object, data: Record<string, unknown>): void {
  for (const [key, raw] of Object.entries(data)) {
    const restored = restoreValue(raw);
    const target = (inst as Record<string, unknown>)[key];
    if (target instanceof Map && restored instanceof Map) {
      target.clear();
      for (const [k, v] of restored.entries()) target.set(k, v);
    } else if (Array.isArray(target) && Array.isArray(restored)) {
      target.length = 0;
      target.push(...(restored as unknown[]));
    } else if (target instanceof Set && restored instanceof Set) {
      target.clear();
      for (const x of restored.values()) target.add(x);
    } else {
      (inst as Record<string, unknown>)[key] = restored;
    }
  }
}

/* ============ 编排服务 ============ */

const AUTOSAVE_MS = 10_000;

@Injectable()
export class StateOrchestrator implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("StatePersistence");
  private timer: ReturnType<typeof setInterval> | null = null;
  private restored = false;
  private lastSavedAt: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly verification: VerificationService,
    private readonly entity: EntityService,
    private readonly advisorCard: AdvisorCardService,
    private readonly authorization: AuthorizationService,
    private readonly onboarding: OnboardingService,
    private readonly ruleSet: RuleSetService,
    private readonly template: AssessmentTemplateService,
    private readonly dataSource: DataSourceService,
    private readonly quality: QualityService,
    private readonly engagement: EngagementService,
    private readonly proposal: ProposalService,
    private readonly order: OrderService,
    private readonly payment: PaymentService,
    private readonly clientDetail: ClientDetailService,
    private readonly ipad: IpadService,
    private readonly caseService: CaseService,
    private readonly task: TaskService,
    private readonly material: MaterialService,
    private readonly timeline: TimelineService,
    private readonly consent: ConsentService,
    private readonly notification: NotificationService,
    private readonly provider: ProviderService,
    private readonly portal: PortalService,
    private readonly handover: HandoverService,
    private readonly ticket: TicketService,
    private readonly commission: CommissionService,
    private readonly compliance: ComplianceEventService,
    private readonly deletion: DeletionService,
    private readonly invite: InviteService,
    private readonly ai: AiService,
    private readonly advisorAi: AdvisorAiService,
    private readonly knowledge: KnowledgeService,
    private readonly wiki: WikiService
  ) {}

  private registry(): Array<{ key: string; inst: object }> {
    return [
      { key: "catalog", inst: this.catalog },
      { key: "verification", inst: this.verification },
      { key: "entity", inst: this.entity },
      { key: "advisor-card", inst: this.advisorCard },
      { key: "authorization", inst: this.authorization },
      { key: "onboarding", inst: this.onboarding },
      { key: "ruleset", inst: this.ruleSet },
      { key: "assessment-template", inst: this.template },
      { key: "data-source", inst: this.dataSource },
      { key: "quality", inst: this.quality },
      { key: "engagement", inst: this.engagement },
      { key: "proposal", inst: this.proposal },
      { key: "order", inst: this.order },
      { key: "payment", inst: this.payment },
      { key: "client-detail", inst: this.clientDetail },
      { key: "ipad", inst: this.ipad },
      { key: "case", inst: this.caseService },
      { key: "task", inst: this.task },
      { key: "material", inst: this.material },
      { key: "timeline", inst: this.timeline },
      { key: "consent", inst: this.consent },
      { key: "notification", inst: this.notification },
      { key: "provider", inst: this.provider },
      { key: "portal", inst: this.portal },
      { key: "handover", inst: this.handover },
      { key: "ticket", inst: this.ticket },
      { key: "commission", inst: this.commission },
      { key: "compliance", inst: this.compliance },
      { key: "deletion", inst: this.deletion },
      { key: "invite", inst: this.invite },
      { key: "ai", inst: this.ai },
      { key: "advisor-ai", inst: this.advisorAi },
      { key: "knowledge", inst: this.knowledge },
      { key: "wiki", inst: this.wiki }
    ];
  }

  get enabled(): boolean {
    return this.prisma.enabled;
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    const rows = await this.prisma.db.serviceState.count();
    if (rows > 0) {
      await this.restoreAll();
      this.restored = true;
      this.logger.log(`已从数据库恢复服务状态（${rows} 个服务）`);
    }
    this.timer = setInterval(() => {
      this.flush().catch((e) => this.logger.warn(`自动保存失败: ${String(e)}`));
    }, AUTOSAVE_MS);
    // 不阻塞进程退出
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.enabled) {
      try {
        await this.flush();
      } catch (e) {
        this.logger.warn(`关停落盘失败: ${String(e)}`);
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled) return;
    const entries: Array<{ key: string; data: Prisma.InputJsonValue }> = [];
    for (const { key, inst } of this.registry()) {
      entries.push({ key, data: snapshotInstance(inst) as Prisma.InputJsonValue });
    }
    await this.prisma.db.$transaction(
      entries.map((e) =>
        this.prisma.db.serviceState.upsert({
          where: { key: e.key },
          create: { key: e.key, data: e.data },
          update: { data: e.data }
        })
      )
    );
    this.lastSavedAt = new Date().toISOString();
  }

  private async restoreAll(): Promise<void> {
    const rows = await this.prisma.db.serviceState.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.data]));
    for (const { key, inst } of this.registry()) {
      const data = byKey.get(key);
      if (data) restoreInstance(inst, data as Record<string, unknown>);
    }
  }

  async status(): Promise<{
    enabled: boolean;
    populated: boolean;
    restored: boolean;
    serviceCount: number;
    keys: string[];
    lastSavedAt: string | null;
  }> {
    let keys: string[] = [];
    let populated = false;
    if (this.enabled) {
      const rows = await this.prisma.db.serviceState.findMany({ select: { key: true } });
      keys = rows.map((r) => r.key);
      populated = keys.length > 0;
    }
    return {
      enabled: this.enabled,
      populated,
      restored: this.restored,
      serviceCount: this.registry().length,
      keys,
      lastSavedAt: this.lastSavedAt
    };
  }
}
