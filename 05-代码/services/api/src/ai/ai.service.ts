import { Injectable } from "@nestjs/common";
import { fromMinor, type FeeItem } from "@tip/core";
import { AuditService } from "../audit.service.js";
import { CaseService, STAGE_LABELS } from "../case/case.service.js";
import { OrderService } from "../order/order.service.js";
import { TimelineService } from "../timeline/timeline.service.js";

/**
 * AI 初步实现（确定性 grounded 问答，不接 LLM）：
 *  - 答案全部从客户真实案件（co/off 时间线）、订单费表快照、已发布教育内容拼装；
 *  - 找不到依据就明说并引导联系顾问，绝不编造（零幻觉）；
 *  - ChatProvider（Ollama/Qwen）为后续升级接口，本版不接入；
 *  - 案件片段问答以客户单独同意为前提（44101）。
 */

export interface AiSource {
  level: "cu" | "co" | "sp" | "off";
  title: string;
  ref: string;
}

export interface AiAnswer {
  text: string;
  sources: AiSource[];
  next?: string;
  needConsent?: boolean;
}

interface ConsentRecord {
  granted: boolean;
  at: string;
}

const NATURE_LABELS: Record<FeeItem["nature"], string> = {
  platform_service: "平台服务费",
  domestic_service: "境内服务费",
  overseas_professional: "境外专业服务费",
  official: "官方申请费",
  third_party: "第三方费用"
};

const CERTAINTY_LABELS: Record<FeeItem["certainty"], string> = {
  confirmed: "已确认",
  estimated: "估算",
  tbc: "待确认",
  not_incurred: "未发生"
};

@Injectable()
export class AiService {
  private readonly consents = new Map<string, ConsentRecord>();

  constructor(
    private readonly cases: CaseService,
    private readonly orders: OrderService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService
  ) {}

  /* ---------- 单独同意 ---------- */

  getConsent(customerRef: string): { granted: boolean; at: string | null } {
    const c = this.consents.get(customerRef);
    return { granted: c?.granted ?? false, at: c?.at ?? null };
  }

  setConsent(customerRef: string, granted: boolean, actorRef: string): void {
    this.consents.set(customerRef, { granted, at: new Date().toISOString() });
    this.audit.record({
      actor: actorRef,
      realm: "customer",
      action: granted ? "ai.consent.grant" : "ai.consent.revoke",
      resource: customerRef,
      result: "allow"
    });
  }

  /* ---------- 建议问题 ---------- */

  suggestions(): { records: Array<{ key: string; text: string }> } {
    return {
      records: [
        { key: "progress", text: "我的案件到哪一步了？" },
        { key: "fees", text: "我还有哪些费用？" },
        { key: "materials", text: "我需要补什么材料？" },
        { key: "safety", text: "怎样识别私下转账风险？" }
      ]
    };
  }

  /* ---------- 确定性 grounded 问答 ---------- */

  ask(customerRef: string, message: string): AiAnswer {
    const q = (message || "").trim();
    this.audit.record({ actor: customerRef, realm: "customer", action: "ai.ask", resource: customerRef, result: "allow" });

    if (/你好|您好|hi|hello/i.test(q)) {
      return { text: "你好，我是你的身份规划 AI 助手。可以问我案件进度、费用、材料，或防骗相关问题。", sources: [] };
    }
    if (/防骗|骗|安全|转账|私下/.test(q)) {
      return {
        text:
          "请记住三条：1）仅向订单页显示的对公账户付款，拒绝任何个人/第三方账户；2）“包成功、不成功全退”是违规话术；3）付款后以财务核验和收据为准，待核验不等于到账。",
        sources: [{ level: "co", title: "防骗教育内容（已发布）", ref: "EDU-SAFE" }],
        next: "如发现可疑要求，可在「服务」页提交工单或联系合规热线。"
      };
    }

    // 以下均使用案件/费用片段，须先取得单独同意
    if (!this.getConsent(customerRef).granted) {
      return { text: "", sources: [], needConsent: true };
    }

    const caseRecords = this.cases.listForCustomer(customerRef);
    const orderRecords = this.orders.customerOrders(customerRef);

    if (/进度|到哪|阶段|进展/.test(q)) {
      return this.progressAnswer(caseRecords);
    }
    if (/费用|多少钱|收费|价格|费|付款/.test(q)) {
      return this.feeAnswer(orderRecords);
    }
    if (/材料|公证|认证|补|文件/.test(q)) {
      return this.materialAnswer(caseRecords);
    }

    return {
      text: "我没有在你的案件资料中找到直接答案，为避免误导，建议联系你的顾问确认。",
      sources: [],
      next: "也可以在「服务」页提交工单。"
    };
  }

  /* ---------- 答案构造 ---------- */

  private caseEvents(caseId: string) {
    return this.timeline
      .viewForCase(caseId, { internal: false })
      .filter((e) => e.level === "co" || e.level === "off");
  }

  private progressAnswer(caseRecords: ReturnType<CaseService["listForCustomer"]>): AiAnswer {
    if (caseRecords.length === 0) {
      return { text: "目前没有在办案件；方案确认并完成首款后会自动建案。", sources: [] };
    }
    const lines: string[] = [];
    const sources: AiSource[] = [];
    for (const c of caseRecords) {
      lines.push(`案件 ${c.id}：当前阶段「${STAGE_LABELS[c.stage]}」。`);
      const events = this.caseEvents(c.id).slice(-3);
      for (const e of events) {
        lines.push(`· ${e.title}`);
        sources.push({ level: e.level, title: e.title, ref: e.id });
      }
    }
    return {
      text: lines.join("\n"),
      sources,
      next: "阶段以官方/已核验记录为准，不提供获批预测。"
    };
  }

  private materialAnswer(caseRecords: ReturnType<CaseService["listForCustomer"]>): AiAnswer {
    if (caseRecords.length === 0) {
      return { text: "目前没有在办案件，暂无材料清单。", sources: [] };
    }
    const lines: string[] = [];
    const sources: AiSource[] = [];
    for (const c of caseRecords) {
      const events = this.caseEvents(c.id).filter((e) => /材料|公证|认证|文件|补/.test(e.title));
      lines.push(`案件 ${c.id}（${STAGE_LABELS[c.stage]}）：`);
      if (events.length === 0) {
        lines.push("· 暂无材料相关的已核验更新，材料清单以「办理」页为准。");
      } else {
        for (const e of events.slice(-4)) {
          lines.push(`· ${e.title}`);
          sources.push({ level: e.level, title: e.title, ref: e.id });
        }
      }
    }
    return { text: lines.join("\n"), sources, next: "公证/海牙认证指引可在「办理」页材料清单中查看。" };
  }

  private feeAnswer(orderRecords: ReturnType<OrderService["customerOrders"]>): AiAnswer {
    if (orderRecords.length === 0) {
      return { text: "目前没有订单；方案确认后会生成订单并显示分项费用。", sources: [] };
    }
    const lines: string[] = [];
    const sources: AiSource[] = [];
    for (const o of orderRecords) {
      lines.push(`订单 ${o.id} 的分项费用（异币种不相加、无总价）：`);
      const items = (o.snapshots.feeSnapshot ?? []) as FeeItem[];
      for (const f of items) {
        const amount =
          f.amountMinor != null && f.currency ? `${fromMinor(BigInt(f.amountMinor), f.currency)} ${f.currency}` : CERTAINTY_LABELS[f.certainty];
        lines.push(`· ${NATURE_LABELS[f.nature]}：${amount}（${CERTAINTY_LABELS[f.certainty]}）${f.collector ? `，收取方：${f.collector}` : ""}`);
      }
      sources.push({ level: "co", title: `费表快照 ${o.id}`, ref: o.id });
    }
    return { text: lines.join("\n"), sources, next: "费用以已发布费表为准，顾问不可改价。" };
  }
}
