import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit.service.js";
import { CaseService, STAGE_LABELS } from "../case/case.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { MaterialService } from "../material/material.service.js";
import { TaskService } from "../task/task.service.js";
import { TimelineService } from "../timeline/timeline.service.js";
import type { AiAnswer, AiSource } from "./ai.service.js";

/**
 * 顾问端 AI（初步，确定性 grounded，不接 LLM）：
 *  - 晨间简报、会前准备、资料查询、客户跟进，全部从顾问有权访问的真实数据拼装；
 *  - 物理排除：支付账户、到账明细、投诉正文、L3 原件、非归属客户；
 *  - AI 只检索与起草，不触发业务动作；ChatProvider(Qwen) 为后续升级。
 */

@Injectable()
export class AdvisorAiService {
  constructor(
    private readonly eng: EngagementService,
    private readonly cases: CaseService,
    private readonly tasks: TaskService,
    private readonly materials: MaterialService,
    private readonly timeline: TimelineService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService
  ) {}

  suggestions(): { records: Array<{ key: string; text: string }> } {
    return {
      records: [
        { key: "brief", text: "给我今天的晨间简报" },
        { key: "prep", text: "帮我准备和 #2051 的会面" },
        { key: "lookup", text: "查询已发布的居留项目" },
        { key: "follow", text: "#2051 最近有什么进展" }
      ]
    };
  }

  ask(advisorId: string, message: string): AiAnswer {
    const q = (message || "").trim();
    this.audit.record({ actor: advisorId, realm: "staff", action: "advisor.ai.ask", resource: advisorId, result: "allow" });

    if (/晨间|简报|今日|今天|overview/i.test(q)) {
      return this.morningBrief(advisorId);
    }
    const customerRef = this.extractCustomer(advisorId, q);
    if (/会前|会面|准备/.test(q)) {
      return this.preMeeting(advisorId, customerRef);
    }
    if (/进展|跟进|时间线|动态/.test(q)) {
      return this.customerProgress(customerRef);
    }
    if (/查|项目|政策|资料|费表|搜索/.test(q)) {
      return this.lookup(q);
    }
    return {
      text: "我可以帮你做：晨间简报、会前准备、已发布资料查询、客户进展跟进。直接描述需求即可。",
      sources: []
    };
  }

  /* ---------- 意图实现 ---------- */

  /** 从消息中解析 #客户编号（如 #2051 → c-2051），且必须是该顾问 active 客户 */
  private extractCustomer(advisorId: string, q: string): string | null {
    const m = q.match(/#?(\d{4})\b/);
    if (!m) return null;
    const ref = `c-${m[1]}`;
    const ok = this.eng.advisorClients(advisorId).some((r) => r.customerRef === ref);
    return ok ? ref : null;
  }

  private morningBrief(advisorId: string): AiAnswer {
    const pending = this.eng.advisorQueue(advisorId, "pending_accept");
    const clients = this.eng.advisorClients(advisorId);
    const myTasks = this.tasks.listForOwner(advisorId);
    const overdue = myTasks.filter((t) => t.state === "overdue" || t.state === "escalated");
    const lines = [
      `今日晨间简报：`,
      `· 待接待/待接受：${pending.length} 条`,
      `· 在服务客户：${clients.length} 位`,
      `· 你的逾期任务：${overdue.length} 项${overdue.length ? `（${overdue.map((t) => t.title).slice(0, 3).join("、")}）` : ""}`
    ];
    const sources: AiSource[] = [
      { level: "co", title: "接待队列", ref: "queue" },
      { level: "co", title: "任务台账", ref: "tasks" }
    ];
    return { text: lines.join("\n"), sources, next: "可直接说“帮我准备和 #客户 的会面”。" };
  }

  private advisorCasesFor(advisorId: string, customerRef: string | null) {
    return this.cases
      .listForAdvisor(advisorId)
      .filter((c) => (customerRef ? c.customerRef === customerRef : true));
  }

  private preMeeting(advisorId: string, customerRef: string | null): AiAnswer {
    if (!customerRef) {
      return { text: "请指定客户编号，例如“帮我准备和 #2051 的会面”。", sources: [] };
    }
    const caseRecords = this.advisorCasesFor(advisorId, customerRef);
    if (caseRecords.length === 0) {
      return { text: `客户 ${customerRef} 目前没有在办案件；可准备需求沟通与初评材料。`, sources: [] };
    }
    const lines: string[] = [`客户 ${customerRef} 会前简报：`];
    const sources: AiSource[] = [];
    for (const c of caseRecords) {
      lines.push(`· 案件 ${c.id}：阶段「${STAGE_LABELS[c.stage]}」`);
      const events = this.timeline.viewForCase(c.id, { internal: false })
        .filter((e) => e.level === "co" || e.level === "off").slice(-3);
      for (const e of events) {
        lines.push(`  - ${e.title}`);
        sources.push({ level: e.level, title: e.title, ref: e.id });
      }
      const pendingTasks = this.tasks.listForCase(c.id).filter((t) => t.state !== "done");
      if (pendingTasks.length) lines.push(`  - 待办：${pendingTasks.map((t) => t.title).slice(0, 3).join("、")}`);
      const missing = this.materials.listForAdvisor(c.id).filter((m) => m.state !== "approved");
      if (missing.length) lines.push(`  - 未齐材料：${missing.slice(0, 4).map((m) => m.title).join("、")}`);
    }
    lines.push("授权边界：仅可使用已发布项目与核准素材；不承诺结果。");
    return { text: lines.join("\n"), sources, next: "会中可使用 iPad 讲解模式。" };
  }

  private customerProgress(customerRef: string | null): AiAnswer {
    if (!customerRef) {
      return { text: "请指定客户编号，例如“#2051 最近有什么进展”。", sources: [] };
    }
    const caseRecords = this.cases.list().filter((c) => c.customerRef === customerRef);
    const lines: string[] = [`客户 ${customerRef} 最新进展：`];
    const sources: AiSource[] = [];
    for (const c of caseRecords) {
      const events = this.timeline.viewForCase(c.id, { internal: false })
        .filter((e) => e.level === "co" || e.level === "off").slice(-4);
      lines.push(`· 案件 ${c.id}（${STAGE_LABELS[c.stage]}）`);
      for (const e of events) {
        lines.push(`  - ${e.title}`);
        sources.push({ level: e.level, title: e.title, ref: e.id });
      }
    }
    if (sources.length === 0) lines.push("· 暂无已核验更新。");
    return { text: lines.join("\n"), sources };
  }

  private lookup(q: string): AiAnswer {
    const projects = this.catalog.listPublishedProjects();
    const kw = q.replace(/.*查询|.*搜索|已发布的?|项目|政策|资料/g, "").trim();
    const hit = kw
      ? projects.filter((p) => (p.title + p.code + p.body).includes(kw))
      : projects;
    if (hit.length === 0) {
      return { text: "没有匹配的已发布内容；未发布/失效内容不会返回。", sources: [] };
    }
    const lines = ["已发布项目："];
    const sources: AiSource[] = [];
    for (const p of hit.slice(0, 5)) {
      lines.push(`· ${p.title}（${p.code} v${p.version}）${p.feeScheduleId ? "，含已发布费表" : ""}`);
      sources.push({ level: "co", title: p.title, ref: p.id });
    }
    return { text: lines.join("\n"), sources, next: "仅已发布内容可对客展示。" };
  }
}
