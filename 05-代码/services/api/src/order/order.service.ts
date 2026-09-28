import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  contractMachine,
  type ContractState,
  type SubjectGateContext
} from "@tip/core";
import { EntityService } from "../entities/entity.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";
import { CommissionService } from "../commission/commission.service.js";
import { ProviderService } from "../provider/provider.service.js";
import type { ProposalRecord } from "../proposal/proposal.service.js";

/**
 * M2-09/10/13 订单 + 主体三要素门 + 合同五要素受控登记。
 * 铁律：
 *  - 订单由已客户确认方案生成，固化方案/费表/规则快照（M2-13）；
 *  - 三要素判定全平台唯一，四入口同关，无强制通过参数；
 *  - 合同五要素 + 逐条告知 Consent 缺一不可登记；核验人≠顾问；
 *  - D 门未开（D2 未拍板）仅影子环境可生效；
 *  - 点击/咨询/预约/方案确认均不产生可提现佣金（M4）。
 */

const BLOCK_ALERT_WINDOW_MS = 24 * 36_00_000;
const BLOCK_ALERT_THRESHOLD = 3;

export interface SubjectItem {
  key: "signing_entity" | "overseas_party" | "payee_account";
  label: string;
  pass: boolean;
  detail: string;
}

export interface ConsentItem {
  key: "fees" | "non_commitment" | "privacy";
  label: string;
  confirmedAt: string | null;
}

export interface ContractTemplate {
  id: string;
  version: number;
  title: string;
  /** 五要素齐备标记（模板内容在 A05 管理，M2 只做门控） */
  fiveElements: {
    scope: boolean; // 服务范围与边界
    refund: boolean; // 退款规则
    overseasNotice: boolean; // 境外段服务方告知
    guarantee: boolean; // 平台保障与平台外交易边界
    privacy: boolean; // 隐私与跨境告知
  };
  state: "draft" | "published";
}

export interface OrderConfig {
  /** 境外交付方：有效持牌方或自营交付部门（D2 拍板前可配置影子值） */
  overseasParty: { linked: boolean; name: string; licensed: boolean };
  /** 收款账户白名单：户名必须 = 签约主体 */
  payeeAccounts: Array<{ name: string; bank: string; account: string }>;
  /** D 门：境外方/合同文本决策未拍板 */
  doorsOpen: boolean;
  shadowEnv: boolean;
}

export interface OrderRecord {
  id: string;
  proposalId: string;
  customerRef: string;
  advisorId: string;
  projectCode: string;
  /** M2-13 规则快照（佣金规则仅槽位，M4 配置） */
  snapshots: {
    proposalRevision: number;
    feeVersion: number;
    feeSnapshot: ProposalRecord["feeSnapshot"];
    wordVersion: string;
    commissionRuleSlot: null;
    attribution: { source: string; relationship: string; commission: string };
  };
  contractState: ContractState;
  subject: {
    status: "unchecked" | "passed" | "blocked";
    items: SubjectItem[];
    checkedAt: string | null;
    checkedBy: string | null;
    blockedEvents: Array<{ at: string; by: string }>;
  };
  contractTemplateId: string | null;
  consents: ConsentItem[];
  registration: {
    method: "offline" | "esign" | null;
    signedAt: string | null;
    artifactRef: string | null;
    registrarId: string | null;
  };
  effectiveAt: string | null;
  cancelReason: string | null;
  /** M2-12 变更冻结支线 */
  freezeStatus: null | "change_pending" | "refund_pending";
  freezeRequestId: string | null;
  /** M2-11：首付核验通过 + 合同生效 → 待建案（M3 建案） */
  readyForCaseAt: string | null;
  createdAt: string;
  updatedAt: string;
}

class OrderError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class OrderService implements OnModuleInit {
  private orders = new Map<string, OrderRecord>();
  private seq = 0;
  private tplSeq = 0;
  private templates = new Map<string, ContractTemplate>();
  private config: OrderConfig = {
    overseasParty: { linked: false, name: "", licensed: false },
    payeeAccounts: [],
    doorsOpen: false,
    shadowEnv: true
  };

  constructor(
    private readonly entities: EntityService,
    private readonly engagements: EngagementService,
    private readonly audit: AuditService,
    private readonly snapshotsStore?: SnapshotStore,
    private readonly providers?: ProviderService,
    private readonly commission?: CommissionService
  ) {}

  async onModuleInit() {
    if (!this.snapshotsStore?.enabled) return;
    const rows = await this.snapshotsStore.listAll<OrderRecord>("order");
    let maxSeq = 0;
    for (const r of rows) {
      this.orders.set(r.aggregateId, { ...r.snapshot, contractState: r.state as ContractState });
      const n = Number(r.aggregateId.replace("ORD-", ""));
      if (n > maxSeq) maxSeq = n;
    }
    this.seq = maxSeq;
  }

  private persist(o: OrderRecord, actor: string) {
    if (!this.snapshotsStore?.enabled) return;
    void this.snapshotsStore.save("order", o.id, 1, o.contractState, o as never, actor);
  }

  private newId() {
    this.seq += 1;
    return `ORD-${String(this.seq).padStart(4, "0")}`;
  }

  /* ---------------- 配置（后台） ---------------- */

  getConfig(): OrderConfig {
    return this.config;
  }

  updateConfig(patch: Partial<OrderConfig>, actor: string): OrderConfig {
    this.config = { ...this.config, ...patch };
    this.audit.record({ actor, realm: "staff", action: "order.config.update", resource: "config", result: "allow" });
    return this.config;
  }

  /* ---------------- 合同模板（后台） ---------------- */

  createTemplateDraft(input: { title: string }, actor: string): ContractTemplate {
    this.tplSeq += 1;
    const t: ContractTemplate = {
      id: `TPL-${String(this.tplSeq).padStart(4, "0")}`,
      version: 1,
      title: input.title,
      fiveElements: { scope: false, refund: false, overseasNotice: false, guarantee: false, privacy: false },
      state: "draft"
    };
    this.templates.set(t.id, t);
    this.audit.record({ actor, realm: "staff", action: "contract.template.draft", resource: t.id, result: "allow" });
    return t;
  }

  updateTemplate(id: string, patch: Partial<ContractTemplate["fiveElements"]>, actor: string): ContractTemplate {
    const t = this.requireTemplate(id);
    if (t.state === "published") throw new OrderError(409, "42240", "已发布模板不可改，需出新版本");
    t.fiveElements = { ...t.fiveElements, ...patch };
    this.audit.record({ actor, realm: "staff", action: "contract.template.update", resource: id, result: "allow" });
    return t;
  }

  publishTemplate(id: string, actor: string): ContractTemplate {
    const t = this.requireTemplate(id);
    const f = t.fiveElements;
    const all = Object.values(f).every(Boolean);
    if (!all) throw new OrderError(422, "42202", "合同五要素未齐备，不可发布");
    t.state = "published";
    this.audit.record({ actor, realm: "staff", action: "contract.template.publish", resource: id, result: "allow" });
    return t;
  }

  listTemplates(): ContractTemplate[] {
    return [...this.templates.values()];
  }

  private requireTemplate(id: string): ContractTemplate {
    const t = this.templates.get(id);
    if (!t) throw new OrderError(404, "42241", "合同模板不存在");
    return t;
  }

  /* ---------------- 订单生成（M2-09/13） ---------------- */

  /** 由已确认方案生成订单草稿（自动 + 顾问重建/异常通道） */
  createFromProposal(proposal: ProposalRecord, actor: string): OrderRecord {
    if (proposal.state !== "customer_confirmed") {
      throw new OrderError(409, "42230", "仅客户已确认方案可生成订单");
    }
    // 一名客户同一方案只允许一条未取消订单
    for (const o of this.orders.values()) {
      if (o.proposalId === proposal.id && o.contractState !== "cancelled") {
        throw new OrderError(409, "42231", "该方案已存在订单，不可重复生成");
      }
    }
    const now = new Date().toISOString();
    const o: OrderRecord = {
      id: this.newId(),
      proposalId: proposal.id,
      customerRef: proposal.customerRef,
      advisorId: proposal.advisorId,
      projectCode: proposal.projectCode,
      snapshots: {
        proposalRevision: proposal.revision,
        feeVersion: proposal.feeVersion,
        feeSnapshot: proposal.feeSnapshot.map((f) => ({ ...f })),
        wordVersion: proposal.wordVersion,
        commissionRuleSlot: null,
        attribution: { source: proposal.projectCode, relationship: proposal.customerRef, commission: "not_accrued" }
      },
      contractState: "draft",
      subject: { status: "unchecked", items: [], checkedAt: null, checkedBy: null, blockedEvents: [] },
      contractTemplateId: null,
      consents: [
        { key: "fees", label: "费用逐项知悉", confirmedAt: null },
        { key: "non_commitment", label: "不承诺结果知悉", confirmedAt: null },
        { key: "privacy", label: "隐私与跨境告知知悉", confirmedAt: null }
      ],
      registration: { method: null, signedAt: null, artifactRef: null, registrarId: null },
      effectiveAt: null,
      cancelReason: null,
      freezeStatus: null,
      freezeRequestId: null,
      readyForCaseAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.orders.set(o.id, o);
    this.persist(o, actor);
    this.audit.record({ actor, realm: "staff", action: "order.draft", resource: o.id, result: "allow", subjectRef: o.customerRef });
    return o;
  }

  /* ---------------- 主体三要素门（M2-09） ---------------- */

  /** 三要素判定（唯一实现；客户付款/下单、顾问发起、财务核验共享） */
  private evaluateSubject(o: OrderRecord): SubjectItem[] {
    // 1 签约方 = 境内备案有效主体（经关系/顾问所在机构；M2 取顾问授权机构）
    let entityOk = false;
    let entityDetail = "未找到有效备案机构";
    try {
      const list = this.entities.list().filter((e) => e.usable);
      const hit = list[0];
      if (hit) {
        entityOk = true;
        entityDetail = `${hit.name}（备案 ${hit.filingNo ?? "—"}，有效）`;
      }
    } catch { /* ignore */ }

    // 2 境外交付方已关联（持牌方或自营交付部门）：A02 准入联动
    const op = this.config.overseasParty;
    const usable = this.providers?.findUsableOverseas();
    const overseasOk = Boolean(
      usable ?? (op.linked && op.name && (op.licensed || op.name.includes("自营")))
    );
    const overseasDetail = usable
      ? `${usable.name}（A02 准入有效，${usable.type === "inhouse_delivery" ? "自营交付部门" : "持牌已核验"}）`
      : overseasOk
        ? `${op.name}${op.licensed ? "（持牌已核验）" : "（自营交付部门）"}`
        : "境外交付方未关联或资质未核验（D2 决策门）";

    // 3 收款账户户名 = 签约主体
    let payeeOk = false;
    let payeeDetail = "收款账户白名单未配置";
    try {
      const ent = this.entities.list().find((e) => e.usable);
      const hit = this.config.payeeAccounts.find((a) => ent && a.name === ent.name);
      if (hit) {
        payeeOk = true;
        payeeDetail = `${hit.name} · ${hit.bank} ${hit.account}（户名=签约主体）`;
      } else if (ent) {
        payeeDetail = `白名单账户户名与签约主体「${ent.name}」不一致`;
      }
    } catch { /* ignore */ }

    return [
      { key: "signing_entity", label: "签约方为境内备案主体", pass: entityOk, detail: entityDetail },
      { key: "overseas_party", label: "境外交付方已关联", pass: overseasOk, detail: overseasDetail },
      { key: "payee_account", label: "收款账户户名一致", pass: payeeOk, detail: payeeDetail }
    ];
  }

  /** 跑主体门：通过 → gate_passed；阻断 → 留差异、计数，四入口同关 */
  runSubjectCheck(id: string, actor: string): OrderRecord {
    const o = this.require(id);
    if (o.contractState !== "draft") throw new OrderError(409, "42232", `当前状态 ${o.contractState} 无需再跑主体门`);
    const items = this.evaluateSubject(o);
    const now = new Date().toISOString();
    o.subject.items = items;
    o.subject.checkedAt = now;
    o.subject.checkedBy = actor;
    if (items.every((i) => i.pass)) {
      this.transition(o, "pass_gate", this.gateCtx(o));
      o.subject.status = "passed";
      this.persist(o, actor);
      this.audit.record({ actor, realm: "staff", action: "order.subject.pass", resource: o.id, result: "allow" });
      return o;
    }
    // 阻断：无强制通过；记录计数与 24h 告警
    o.subject.status = "blocked";
    o.subject.blockedEvents.push({ at: now, by: actor });
    const recent = o.subject.blockedEvents.filter((e) => new Date(now).getTime() - new Date(e.at).getTime() <= BLOCK_ALERT_WINDOW_MS);
    this.audit.record({
      actor, realm: "staff", action: "order.subject.block", resource: o.id, result: "deny",
      reason: items.filter((i) => !i.pass).map((i) => i.key).join(",")
    });
    if (recent.length >= BLOCK_ALERT_THRESHOLD) {
      this.audit.record({ actor: "system", realm: "staff", action: "order.subject.blocked_alert", resource: o.id, result: "deny", reason: "24h内反复提交阻断≥3次，转A10告警与合规线索" });
    }
    this.persist(o, actor);
    return o;
  }

  /** S-08a 顾问阻断详情（无强制通过按钮） */
  blockReason(id: string, viewer: { realm: "advisor" | "staff"; ref: string }) {
    const o = this.authView(id, viewer);
    return {
      id: o.id,
      status: o.subject.status,
      items: o.subject.items,
      forcedPath: ["停止任何收款引导", "已收款按原路退回指引（D8 流程）", "转 A05/合规台", "按结论重建订单"],
      note: "不存在强制通过参数；收费主体/账户未配置不可下单。"
    };
  }

  /* ---------------- 合同签署登记（M2-10） ---------------- */

  /** gate_passed → pending_sign，需已发布且五要素齐备模板 */
  startSigning(id: string, templateId: string, actor: string): OrderRecord {
    const o = this.require(id);
    if (o.contractState !== "gate_passed") throw new OrderError(409, "42233", "主体门通过后才可进入签署");
    const t = this.requireTemplate(templateId);
    if (t.state !== "published" || !Object.values(t.fiveElements).every(Boolean)) {
      throw new OrderError(422, "42202", "合同模板未发布或五要素缺失");
    }
    this.transition(o, "sign_register", undefined as never);
    o.contractTemplateId = t.id;
    this.persist(o, actor);
    this.audit.record({ actor, realm: "staff", action: "order.sign.start", resource: o.id, result: "allow" });
    return o;
  }

  /** 客户逐条告知确认（Consent，时间戳） */
  addConsent(id: string, key: ConsentItem["key"], customerRef: string): OrderRecord {
    const o = this.require(id);
    if (o.customerRef !== customerRef) throw new OrderError(403, "42234", "只能对本人订单作告知确认");
    const c = o.consents.find((x) => x.key === key);
    if (!c) throw new OrderError(422, "42235", "未知告知项");
    c.confirmedAt = new Date().toISOString();
    this.persist(o, customerRef);
    this.audit.record({ actor: customerRef, realm: "customer", action: "order.consent", resource: o.id, result: "allow", reason: key });
    return o;
  }

  /** 线下/外部签署受控登记（通道A）；核验人≠顾问；电子签通道B 供应商未定不开发 */
  registerSigned(
    id: string,
    input: { signedAt: string; artifactRef: string; method?: "offline" | "esign"; registrarId: string },
    actor: string
  ): OrderRecord {
    const o = this.require(id);
    if (o.contractState !== "pending_sign") throw new OrderError(409, "42236", "仅待签署订单可登记");
    if (!input.signedAt || !input.artifactRef) throw new OrderError(422, "42237", "登记需签署时间与签署完成件引用");
    if (!input.registrarId) throw new OrderError(422, "42238", "缺少合同核验人");
    if (input.registrarId === o.advisorId) throw new OrderError(403, "42239", "合同核验人不得为顾问本人");
    o.registration.method = input.method ?? "offline";
    o.registration.signedAt = input.signedAt;
    o.registration.artifactRef = input.artifactRef;
    o.registration.registrarId = input.registrarId;
    const ctx: SubjectGateContext = {
      ...this.gateCtx(o),
      contractHasFiveElements: true,
      consentsComplete: o.consents.every((c) => c.confirmedAt !== null),
      registrarId: input.registrarId
    };
    this.transition(o, "make_effective", ctx);
    this.persist(o, actor);
    this.audit.record({ actor, realm: "staff", action: "order.contract.register", resource: o.id, result: "allow" });
    return o;
  }

  /** signed_registered → effective（D 门：仅影子或决策已开） */
  makeEffective(id: string, actor: string): OrderRecord {
    const o = this.require(id);
    if (o.contractState !== "signed_registered") throw new OrderError(409, "42242", "仅已签署登记订单可生效");
    this.transition(o, "make_effective", this.gateCtx(o));
    o.effectiveAt = new Date().toISOString();
    this.commission?.onOrderEffective(
      { id: o.id, advisorId: o.advisorId, plan: o.snapshots.feeSnapshot },
      actor
    );
    this.persist(o, actor);
    this.audit.record({ actor, realm: "staff", action: "order.effective", resource: o.id, result: "allow" });
    return o;
  }

  cancel(id: string, actor: string, reason: string): OrderRecord {
    const o = this.require(id);
    if (!reason?.trim()) throw new OrderError(422, "42243", "取消需填写原因");
    this.transition(o, "cancel", undefined as never);
    o.cancelReason = reason;
    this.persist(o, actor);
    this.audit.record({ actor, realm: "staff", action: "order.cancel", resource: o.id, result: "allow", reason });
    return o;
  }

  /* ---------------- M2-11/12 冻结与待建案（供 PaymentService 调用） ---------------- */

  /** M2-12：变更/退款申请提交即冻结订单，不可并行付款/改方案；执行在 M4 */
  freezeFor(id: string, status: "change_pending" | "refund_pending", requestId: string, actor: string): OrderRecord {
    const o = this.require(id);
    if (o.contractState === "cancelled") throw new OrderError(409, "42250", "已取消订单不可提交变更");
    if (o.freezeStatus) throw new OrderError(409, "42251", `订单已在 ${o.freezeStatus}，不可并行申请`);
    o.freezeStatus = status;
    o.freezeRequestId = requestId;
    o.updatedAt = new Date().toISOString();
    this.persist(o, actor);
    this.audit.record({ actor, realm: "customer", action: "order.freeze", resource: o.id, result: "allow", reason: `${status}:${requestId}` });
    return o;
  }

  /** M2-11：首付到账核验通过且合同生效 → 待建案 */
  markReadyForCase(id: string, actor: string): OrderRecord {
    const o = this.require(id);
    if (o.contractState !== "effective") throw new OrderError(409, "42252", "合同生效后才可进入待建案");
    o.readyForCaseAt = new Date().toISOString();
    this.persist(o, actor);
    return o;
  }

  /* ---------------- 查询 ---------------- */

  list(): OrderRecord[] {
    return [...this.orders.values()];
  }

  advisorOrders(advisorId: string): OrderRecord[] {
    return this.list().filter((o) => o.advisorId === advisorId);
  }

  customerOrders(customerRef: string): OrderRecord[] {
    return this.list().filter((o) => o.customerRef === customerRef);
  }

  getById(id: string, viewer: { realm: "staff" | "customer" | "advisor"; ref: string }): OrderRecord {
    const o = this.require(id);
    if (viewer.realm === "customer" && o.customerRef !== viewer.ref) {
      this.audit.record({ actor: viewer.ref, realm: "customer", action: "order.view", resource: id, result: "deny", reason: "越权" });
      throw new OrderError(403, "42244", "无权查看该订单");
    }
    if (viewer.realm === "advisor" && o.advisorId !== viewer.ref) {
      this.audit.record({ actor: viewer.ref, realm: "staff", action: "order.view", resource: id, result: "deny", reason: "越权" });
      throw new OrderError(403, "42244", "无权查看该订单");
    }
    return o;
  }

  private authView(id: string, viewer: { realm: "advisor" | "staff"; ref: string }): OrderRecord {
    const o = this.require(id);
    if (viewer.realm === "advisor" && o.advisorId !== viewer.ref) {
      throw new OrderError(403, "42244", "无权查看该订单");
    }
    return o;
  }

  private require(id: string): OrderRecord {
    const o = this.orders.get(id);
    if (!o) throw new OrderError(404, "42245", "订单不存在");
    return o;
  }

  /* ---------------- 状态机 ---------------- */

  private gateCtx(o: OrderRecord): SubjectGateContext {
    return {
      signingEntityRegistered: o.subject.items.find((i) => i.key === "signing_entity")?.pass ?? false,
      overseasPartyLinked: o.subject.items.find((i) => i.key === "overseas_party")?.pass ?? false,
      payeeNameMatches: o.subject.items.find((i) => i.key === "payee_account")?.pass ?? false,
      contractHasFiveElements: false,
      registrarId: null,
      advisorId: o.advisorId,
      consentsComplete: false,
      doorsOpen: this.config.doorsOpen,
      shadowEnv: this.config.shadowEnv
    };
  }

  private transition(o: OrderRecord, event: Parameters<typeof contractMachine.transition>[2], ctx: SubjectGateContext) {
    const out = contractMachine.transition(ctx as never, o.contractState, event);
    if (!out.ok) throw new OrderError(409, "42246", out.reason ?? "状态迁移被拒绝");
    o.contractState = out.to as ContractState;
    o.updatedAt = new Date().toISOString();
  }
}
