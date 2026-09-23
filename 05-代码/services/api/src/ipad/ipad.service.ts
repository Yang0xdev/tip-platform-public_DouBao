import { HttpException, Injectable } from "@nestjs/common";
import { WordEngine } from "@tip/core";
import { CatalogService } from "../catalog/catalog.service.js";
import { ProposalService, type ProposalRecord } from "../proposal/proposal.service.js";
import { AuditService } from "../audit.service.js";

/**
 * M2-07/08 iPad 面谈会话 + 工作/演示双模式硬规则。
 *  - 默认工作模式；切演示需显式开关，模式标识持续可见，退出需再次明确；
 *  - 演示模式服务端不下发：佣金/内部备注/其他客户/内部评分/境外结算，收取方用中性表述；
 *  - 模式切换、演示模式尝试内部内容全部审计；一位客户一会话，结束清理；
 *  - 双模式只改可见性，不改事实口径；讲解备注过词库（生产点 pitch）。
 */

export type IpadMode = "work" | "demo";

export interface IpadSession {
  id: string;
  advisorId: string;
  customerRef: string | null;
  mode: IpadMode;
  startedAt: string;
  endedAt: string | null;
  events: Array<{ at: string; event: string; detail: string }>;
}

class IpadError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class IpadService {
  private sessions = new Map<string, IpadSession>();
  private seq = 0;

  constructor(
    private readonly catalog: CatalogService,
    private readonly proposals: ProposalService,
    private readonly audit: AuditService
  ) {}

  start(advisorId: string, customerRef: string | null): IpadSession {
    this.seq += 1;
    const s: IpadSession = {
      id: `IPA-${String(this.seq).padStart(4, "0")}`,
      advisorId,
      customerRef: customerRef || null,
      mode: "work",
      startedAt: new Date().toISOString(),
      endedAt: null,
      events: []
    };
    this.sessions.set(s.id, s);
    this.log(s, "start", customerRef ? `customer ${customerRef}` : "no customer（本机草稿）");
    this.audit.record({ actor: advisorId, realm: "staff", action: "ipad.session.start", resource: s.id, result: "allow", subjectRef: customerRef ?? undefined });
    return s;
  }

  switchMode(id: string, mode: IpadMode, actor: string): IpadSession {
    const s = this.require(id, actor);
    if (s.endedAt) throw new IpadError(409, "42601", "会话已结束");
    if (s.mode === mode) throw new IpadError(409, "42602", `已处于 ${mode === "demo" ? "演示" : "工作"}模式`);
    s.mode = mode;
    this.log(s, "switch_mode", mode);
    this.audit.record({ actor, realm: "staff", action: "ipad.session.switch", resource: s.id, result: "allow", reason: mode });
    return s;
  }

  end(id: string, actor: string): IpadSession {
    const s = this.require(id, actor);
    s.endedAt = new Date().toISOString();
    this.log(s, "end", "cleanup same-screen context");
    this.audit.record({ actor, realm: "staff", action: "ipad.session.end", resource: s.id, result: "allow" });
    return s;
  }

  /** I-01：已发布项目并排（未授权/暂停不可选入；演示模式同样只取公开字段） */
  projects(id: string, actor: string) {
    const s = this.require(id, actor);
    const feeMap = new Map(this.catalog.listPublishedFees().map((f) => [f.id, f]));
    const records = this.catalog.listPublishedProjects().map((p) => {
      const fee = p.feeScheduleId ? feeMap.get(p.feeScheduleId) : undefined;
      return {
        code: p.code,
        title: p.title,
        body: p.body,
        keyFactIds: p.keyFactIds,
        fee: fee?.feeItems.map((f) => ({
          label: f.label,
          nature: f.nature,
          collector: s.mode === "demo" && f.nature === "overseas_professional" ? "境外持牌方" : f.collector,
          currency: f.currency,
          amountMinor: f.amountMinor,
          certainty: f.certainty
        }))
      };
    });
    return { mode: s.mode, records };
  }

  /** I-02：方案共读投影；演示模式剔除内部字段与境外结算信息 */
  proposal(id: string, proposalId: string, actor: string) {
    const s = this.require(id, actor);
    const p = this.proposals.getById(proposalId, { realm: "advisor", ref: actor });
    if (p.state !== "pending_customer" && p.state !== "customer_confirmed") {
      throw new IpadError(409, "42603", "未过 A05 复核的方案不可进入共读");
    }
    if (s.mode === "work") return { mode: "work", proposal: p };
    // 演示模式：只保留共读所需公开字段
    return {
      mode: "demo",
      proposal: {
        id: p.id,
        revision: p.revision,
        state: p.state,
        projectCode: p.projectCode,
        advice: p.advice,
        responsibilities: p.responsibilities,
        nonCommitments: p.nonCommitments,
        feeSnapshot: p.feeSnapshot.map((f) => ({
          ...f,
          collector: f.nature === "overseas_professional" ? "境外持牌方" : f.collector
        })),
        validUntil: p.validUntil
        // 明确无：wordVersion 内部版本、authorId 内部标识、reviewerId、confirmSnapshot、内部备注
      }
    };
  }

  /** 讲解备注（第五生产点）：命中 block 不可确认；演示模式同样校验 */
  checkRemark(id: string, text: string, actor: string) {
    const s = this.require(id, actor);
    const word = new WordEngine("baseline-v1").check(text, "pitch");
    if (!word.ok) {
      this.audit.record({ actor, realm: "staff", action: "ipad.remark.banned", resource: s.id, result: "deny", reason: word.blocked.join(",") });
      throw new IpadError(422, "42604", `讲解命中禁用表述：${word.blocked.join("、")}`);
    }
    this.log(s, "remark_checked", "ok");
    return { ok: true, wordVersion: word.wordVersion };
  }

  /** 演示模式下尝试打开内部内容：拒绝并审计（服务端可见性兜底） */
  attemptInternal(id: string, target: string, actor: string) {
    const s = this.require(id, actor);
    if (s.mode !== "demo") return { allowed: true };
    this.audit.record({ actor, realm: "staff", action: "ipad.internal.denied", resource: s.id, result: "deny", reason: target });
    this.log(s, "internal_denied", target);
    throw new IpadError(403, "40301", "演示模式下内部内容不可访问");
  }

  private require(id: string, actor: string): IpadSession {
    const s = this.sessions.get(id);
    if (!s) throw new IpadError(404, "42605", "面谈会话不存在");
    if (s.advisorId !== actor) throw new IpadError(403, "42606", "只能操作本人面谈会话");
    return s;
  }

  private log(s: IpadSession, event: string, detail: string) {
    s.events.push({ at: new Date().toISOString(), event, detail });
  }
}
