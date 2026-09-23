import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import { WordEngine } from "@tip/core";
import { EngagementService } from "../engagement/engagement.service.js";
import { ProposalService } from "../proposal/proposal.service.js";
import { OrderService } from "../order/order.service.js";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";

/**
 * M2-03 顾问客户详情（方案域）+ 跟进记录。
 *  - 三页签 biz / follow / scope；字段级 DTO：支付明细/账户、投诉正文、其他客户不可见；
 *  - 跟进记录过词库（生产点 pitch）；不可删除，只能更正（旧条留存）；
 *  - 事实节点对客可见，内部质检标签不对客。
 */

export interface FollowUpRecord {
  id: string;
  customerRef: string;
  advisorId: string;
  text: string;
  kind: "fact" | "internal"; // fact 对客可见；internal 含质检标签不对客
  createdAt: string;
  correctedOf: string | null;
  correctionNote: string | null;
  corrected: boolean;
  wordVersion: string;
}

class ClientDetailError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class ClientDetailService implements OnModuleInit {
  private follows = new Map<string, FollowUpRecord>();
  private seq = 0;

  constructor(
    private readonly engagements: EngagementService,
    private readonly proposals: ProposalService,
    private readonly orders: OrderService,
    private readonly audit: AuditService,
    private readonly snapshotsStore?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.snapshotsStore?.enabled) return;
    const rows = await this.snapshotsStore.listAll<FollowUpRecord>("followup");
    let max = 0;
    for (const r of rows) {
      this.follows.set(r.aggregateId, r.snapshot);
      const n = Number(r.aggregateId.replace("FUP-", ""));
      if (n > max) max = n;
    }
    this.seq = max;
  }

  /* ---------------- 跟进记录 ---------------- */

  addFollow(
    customerRef: string,
    body: { text: string; kind?: "fact" | "internal" },
    advisorId: string
  ): FollowUpRecord {
    const text = body.text?.trim();
    if (!text) throw new ClientDetailError(422, "42501", "跟进内容不能为空");
    // 关系必须 active 且顾问为该客户主责
    this.engagements.assertWritable(customerRef, advisorId);
    // 词库（生产点 pitch：顾问话术/跟进）
    const word = new WordEngine("baseline-v1").check(text, "pitch");
    if (!word.ok) {
      this.audit.record({ actor: advisorId, realm: "staff", action: "followup.banned", resource: customerRef, result: "deny", reason: word.blocked.join(",") });
      throw new ClientDetailError(422, "42503", `跟进命中禁用表述：${word.blocked.join("、")}`);
    }
    this.seq += 1;
    const rec: FollowUpRecord = {
      id: `FUP-${String(this.seq).padStart(4, "0")}`,
      customerRef,
      advisorId,
      text,
      kind: body.kind === "internal" ? "internal" : "fact",
      createdAt: new Date().toISOString(),
      correctedOf: null,
      correctionNote: null,
      corrected: false,
      wordVersion: word.wordVersion
    };
    this.follows.set(rec.id, rec);
    if (this.snapshotsStore?.enabled) {
      void this.snapshotsStore.save("followup", rec.id, 1, "active", rec as never, advisorId);
    }
    this.audit.record({ actor: advisorId, realm: "staff", action: "followup.add", resource: rec.id, result: "allow", subjectRef: customerRef });
    return rec;
  }

  /** 更正：旧条留存并标记，新条关联旧条；不可删除 */
  correctFollow(id: string, body: { text: string; note: string }, advisorId: string): FollowUpRecord {
    const old = this.requireFollow(id);
    if (old.advisorId !== advisorId) throw new ClientDetailError(403, "42504", "只能更正本人跟进");
    if (!body.text?.trim() || !body.note?.trim()) {
      throw new ClientDetailError(422, "42505", "更正需新内容与更正原因");
    }
    const word = new WordEngine("baseline-v1").check(body.text, "pitch");
    if (!word.ok) throw new ClientDetailError(422, "42503", `更正命中禁用表述：${word.blocked.join("、")}`);
    old.corrected = true;
    this.seq += 1;
    const rec: FollowUpRecord = {
      id: `FUP-${String(this.seq).padStart(4, "0")}`,
      customerRef: old.customerRef,
      advisorId,
      text: body.text.trim(),
      kind: old.kind,
      createdAt: new Date().toISOString(),
      correctedOf: old.id,
      correctionNote: body.note.trim(),
      corrected: false,
      wordVersion: word.wordVersion
    };
    this.follows.set(rec.id, rec);
    if (this.snapshotsStore?.enabled) {
      void this.snapshotsStore.save("followup", rec.id, 1, "active", rec as never, advisorId);
    }
    this.audit.record({ actor: advisorId, realm: "staff", action: "followup.correct", resource: rec.id, result: "allow", reason: `from ${old.id}` });
    return rec;
  }

  private requireFollow(id: string): FollowUpRecord {
    const r = this.follows.get(id);
    if (!r) throw new ClientDetailError(404, "42506", "跟进记录不存在");
    return r;
  }

  listFollows(customerRef: string): FollowUpRecord[] {
    return [...this.follows.values()].filter((f) => f.customerRef === customerRef);
  }

  /** 对客视图：仅 fact 且字段级过滤（无内部质检标签） */
  customerFollows(customerRef: string) {
    return this.listFollows(customerRef)
      .filter((f) => f.kind === "fact")
      .map((f) => ({ id: f.id, text: f.text, createdAt: f.createdAt, corrected: f.corrected }));
  }

  /* ---------------- 客户详情三页签 ---------------- */

  /** S-07 客户详情：biz / follow / scope；显式排除支付与投诉字段 */
  detail(customerRef: string, advisorId: string) {
    // 越权：仅本人 active 客户（pending 客户不在客户列表，详情也拒）
    try {
      this.engagements.assertWritable(customerRef, advisorId);
    } catch {
      this.audit.record({ actor: advisorId, realm: "staff", action: "clientdetail.view", resource: customerRef, result: "deny", reason: "非本人active客户" });
      throw new ClientDetailError(403, "42507", "无权查看该客户详情");
    }
    return {
      customerRef,
      tabs: {
        biz: this.bizTab(customerRef, advisorId),
        follow: { records: this.listFollows(customerRef) },
        scope: this.scopeTab(customerRef)
      }
    };
  }

  /** 列表按 relationshipId 进入：先校验归属再取详情 */
  detailByRelationship(relationshipId: string, advisorId: string) {
    const view = this.engagements.advisorClientView(advisorId, relationshipId);
    return this.detail(view.relationship.customerRef, advisorId);
  }

  private bizTab(customerRef: string, advisorId: string) {
    const proposals = this.proposals
      .advisorList(advisorId)
      .filter((p) => p.customerRef === customerRef)
      .map((p) => ({ id: p.id, revision: p.revision, state: p.state, validUntil: p.validUntil }));
    const orders = this.orders
      .advisorOrders(advisorId)
      .filter((o) => o.customerRef === customerRef)
      // 不含支付明细/账户；只回编号与合同态、冻结态
      .map((o) => ({ id: o.id, contractState: o.contractState, freezeStatus: o.freezeStatus, readyForCaseAt: o.readyForCaseAt }));
    return {
      proposals,
      orders,
      officialReceipts: "官方回执类节点随 M3 案件开放，本期只读占位"
      // 明确无：支付账户、到账明细、投诉正文、服务方结算
    };
  }

  private scopeTab(customerRef: string) {
    return {
      visible: [
        "客户主动提供的问卷与初评结论",
        "本人编制的方案与跟进记录",
        "已发布项目公开字段",
        "关系与授权状态"
      ],
      notVisible: [
        "支付账户与到账明细（财务域）",
        "其他客户信息",
        "服务方结算信息",
        "投诉正文（M4）",
        "证件原件（M3 批次受控申请）"
      ],
      originalBatchApply: "办理阶段开放（M3）"
    };
  }
}
