import { HttpException, Injectable, type OnModuleInit } from "@nestjs/common";
import {
  proposalMachine,
  WordEngine,
  type FeeItem,
  type ProposalState
} from "@tip/core";
import { CatalogService } from "../catalog/catalog.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { EngagementService } from "../engagement/engagement.service.js";
import { AuditService } from "../audit.service.js";
import { SnapshotStore } from "../persistence/snapshot.store.js";

/**
 * M2-04/05/06/13 方案编制、版本化、A05 报价复核、客户确认、规则快照。
 * 铁律：
 *  - 前置：项目/费表 published + 顾问授权有效 + 关系 active（core proposalPrereq）；
 *  - 顾问无改价入口：费表只读快照；偏离仅允许减免/分期，不得新增收费方；
 *  - 方案为第四词库生产点：block 强拦截；超模板个性化结论必须人工署名；
 *  - 复核人≠编制人；大额减免需第二复核人（阈值影子期配置，初始 10%）；
 *  - 客户只能确认 pending_customer 且有效期内版本；任何变更出新版本，旧确认失效；
 *  - 确认即固化规则快照（词库/项目/费表版本），供订单永久留痕。
 */

const WORD_VERSION = "baseline-v1";
const NON_COMMITMENT_TEMPLATE = "TPL-NC-v1";
/** 初始参数：减免比例超过该值需第二复核人；影子期校准 */
const SECOND_REVIEW_THRESHOLD = 0.1;
const DEFAULT_VALID_DAYS = 14;

export interface AdviceItem {
  text: string;
  /** 追溯项目条件版本：填 sourceRef；否则必须人工署名 */
  sourceRef?: string;
  manualSignature?: { name: string; signedAt: string };
}

export interface FeeDeviation {
  type: "discount" | "installment";
  itemCode: string;
  /** 减免后的金额（仅可小于原金额）；分期不改总额，只填计划说明 */
  adjustedAmountMinor?: string;
  note: string;
}

export interface ProposalDraftInput {
  customerRef: string;
  projectCode: string;
  advice: AdviceItem[];
  responsibilities: string;
  nonCommitments?: string[];
  deviations?: FeeDeviation[];
  validDays?: number;
}

export interface ProposalRecord {
  id: string;
  revision: number;
  supersedesId: string | null;
  customerRef: string;
  advisorId: string;
  projectCode: string;
  projectVersion: number;
  feeScheduleId: string;
  feeVersion: number;
  feeSnapshot: FeeItem[];
  advice: AdviceItem[];
  responsibilities: string;
  nonCommitments: string[];
  nonCommitmentTemplate: string;
  deviations: FeeDeviation[];
  validDays: number;
  validUntil: string | null;
  state: ProposalState;
  authorId: string;
  reviewerId: string | null;
  secondReviewerId: string | null;
  reviewReasons: string[];
  wordVersion: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmSnapshot: Record<string, unknown> | null;
  customerRevisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

class ProposalError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

@Injectable()
export class ProposalService implements OnModuleInit {
  private proposals = new Map<string, ProposalRecord>();
  private seq = 0;
  private readonly words = new WordEngine(WORD_VERSION);

  constructor(
    private readonly catalog: CatalogService,
    private readonly grants: AuthorizationService,
    private readonly engagements: EngagementService,
    private readonly audit: AuditService,
    private readonly snapshots?: SnapshotStore
  ) {}

  async onModuleInit() {
    if (!this.snapshots?.enabled) return;
    const rows = await this.snapshots.listLatest<ProposalRecord>("proposal");
    for (const r of rows) this.proposals.set(r.aggregateId, { ...r.snapshot, state: r.state as ProposalState });
  }

  private persist(p: ProposalRecord) {
    if (!this.snapshots?.enabled) return;
    void this.snapshots.save("proposal", p.id, p.revision, p.state, p as never, p.authorId);
  }

  private newId() {
    this.seq += 1;
    return `PROP-${String(this.seq).padStart(4, "0")}`;
  }

  /** 顾问创建草稿（含前置门校验） */
  draft(input: ProposalDraftInput, advisorId: string): ProposalRecord {
    // 关系门：active 且主责为该顾问（冲突期直接 409）
    this.engagements.assertWritable(input.customerRef, advisorId);
    // 授权门
    this.grants.assertCanPitch(advisorId, input.projectCode);
    // 项目/费表门
    const project = this.catalog.listPublishedProjects().find((p) => p.code === input.projectCode);
    if (!project) throw new ProposalError(409, "42301", "项目无已发布版本，不可编制方案");
    if (!project.feeScheduleId) throw new ProposalError(409, "42302", "项目未关联已发布收费方案");
    const fee = this.catalog.getPublishedFee(project.feeScheduleId);

    if (!input.advice?.length) throw new ProposalError(422, "42303", "至少一条个性化建议");
    if (!input.responsibilities?.trim()) throw new ProposalError(422, "42304", "责任分工必填");

    // 偏离校验：只允许减免/分期；不得新增收费方/收费项；减免额只能更低
    const deviations = input.deviations ?? [];
    for (const d of deviations) {
      const item = fee.feeItems.find((f) => f.code === d.itemCode);
      if (!item) throw new ProposalError(422, "42305", "偏离项必须来自标准费表，不允许新增收费项");
      if (d.type === "discount") {
        if (item.amountMinor === null) throw new ProposalError(422, "42306", "待确认费用不可申请减免");
        const adjusted = BigInt(d.adjustedAmountMinor ?? "-1");
        if (adjusted < 0n || adjusted > BigInt(item.amountMinor)) {
          throw new ProposalError(422, "42307", "减免后金额不可为负或高于原金额");
        }
      }
      if (!d.note?.trim()) throw new ProposalError(422, "42308", "偏离必须填写说明");
    }

    const now = new Date().toISOString();
    const p: ProposalRecord = {
      id: this.newId(),
      revision: 1,
      supersedesId: null,
      customerRef: input.customerRef,
      advisorId,
      projectCode: input.projectCode,
      projectVersion: project.version,
      feeScheduleId: fee.id,
      feeVersion: fee.version,
      feeSnapshot: fee.feeItems.map((f) => ({ ...f })),
      advice: input.advice,
      responsibilities: input.responsibilities,
      nonCommitments: input.nonCommitments ?? [],
      nonCommitmentTemplate: NON_COMMITMENT_TEMPLATE,
      deviations,
      validDays: input.validDays ?? DEFAULT_VALID_DAYS,
      validUntil: null,
      state: "advisor_draft",
      authorId: advisorId,
      reviewerId: null,
      secondReviewerId: null,
      reviewReasons: [],
      wordVersion: WORD_VERSION,
      confirmedAt: null,
      confirmedBy: null,
      confirmSnapshot: null,
      customerRevisionNote: null,
      createdAt: now,
      updatedAt: now
    };
    this.assertContentClean(p);
    this.proposals.set(p.id, p);
    this.persist(p);
    this.audit.record({ actor: advisorId, realm: "staff", action: "proposal.draft", resource: p.id, result: "allow", subjectRef: input.customerRef });
    return p;
  }

  /** 词库 + 人工署名门（第四生产点） */
  private assertContentClean(p: ProposalRecord) {
    const parts = [
      ...p.advice.map((a) => a.text),
      p.responsibilities,
      ...p.nonCommitments,
      ...p.deviations.map((d) => d.note)
    ].join("\n");
    const r = this.words.check(parts, "proposal");
    if (!r.ok) {
      throw new ProposalError(422, "42310", `方案文案命中禁用词：${r.blocked.map((b) => b.matched).join("、")}`);
    }
    for (const a of p.advice) {
      if (!a.sourceRef && !(a.manualSignature?.name && a.manualSignature.signedAt)) {
        throw new ProposalError(422, "42311", "超模板个性化结论必须人工署名（姓名+时间戳），或追溯项目条件版本");
      }
    }
  }

  /** 顾问提交复核 */
  submitReview(id: string, advisorId: string): ProposalRecord {
    const p = this.requireOwned(id, advisorId);
    if (p.state !== "advisor_draft") throw new ProposalError(409, "42312", `当前状态 ${p.state} 不可提交复核`);
    this.assertContentClean(p);
    // 重新校验前置（项目可能已暂停）
    this.apply(p, "submit_review", advisorId);
    return p;
  }

  /** A05 复核通过；大额减免需第二复核人 */
  approve(id: string, reviewerId: string, secondReviewerId?: string): ProposalRecord {
    const p = this.require(id);
    if (p.state !== "pending_review") throw new ProposalError(409, "42313", "仅待复核方案可通过");
    if (reviewerId === p.authorId) throw new ProposalError(403, "42314", "复核人不得为编制顾问（四眼原则）");
    const needsSecond = this.needsSecondReview(p);
    if (needsSecond) {
      if (!secondReviewerId) throw new ProposalError(422, "42315", "减免超过影子期阈值，需第二复核人");
      if (secondReviewerId === p.authorId || secondReviewerId === reviewerId) {
        throw new ProposalError(403, "42316", "第二复核人必须独立于编制人与第一复核人");
      }
      p.secondReviewerId = secondReviewerId;
    }
    this.apply(p, "approve", reviewerId, { actorId: reviewerId, verifierId: reviewerId, publisherId: reviewerId });
    p.reviewerId = reviewerId;
    p.validUntil = new Date(Date.now() + p.validDays * 86_400_000).toISOString();
    this.persist(p);
    this.audit.record({ actor: reviewerId, realm: "staff", action: "proposal.approve", resource: p.id, result: "allow", subjectRef: p.customerRef });
    return p;
  }

  /** 复核驳回（必填原因，回顾问草稿） */
  reject(id: string, reviewerId: string, reasons: string[]): ProposalRecord {
    const p = this.require(id);
    if (!reasons?.length || reasons.some((r) => !r.trim())) throw new ProposalError(422, "42317", "驳回必须逐条填写原因");
    if (reviewerId === p.authorId) throw new ProposalError(403, "42314", "复核人不得为编制顾问");
    this.apply(p, "reject", reviewerId, { actorId: reviewerId, verifierId: reviewerId, publisherId: reviewerId });
    p.reviewReasons.push(...reasons);
    this.apply(p, "revise", reviewerId, { actorId: reviewerId, verifierId: reviewerId, publisherId: reviewerId });
    p.updatedAt = new Date().toISOString();
    this.persist(p);
    this.audit.record({ actor: reviewerId, realm: "staff", action: "proposal.reject", resource: p.id, result: "allow", reason: reasons.join("；") });
    return p;
  }

  /** 客户确认本版本 → customer_confirmed，固化快照（订单切片据此生成订单草稿） */
  confirm(id: string, customerRef: string): ProposalRecord {
    const p = this.require(id);
    if (p.customerRef !== customerRef) throw new ProposalError(403, "42318", "只能确认本人方案");
    if (p.state !== "pending_customer") throw new ProposalError(409, "42319", "该版本不可确认（未复核/已失效/旧版）");
    this.apply(p, "confirm", customerRef, { validUntil: p.validUntil, now: new Date().toISOString() });
    p.confirmedAt = new Date().toISOString();
    p.confirmedBy = customerRef;
    p.confirmSnapshot = {
      proposalId: p.id,
      revision: p.revision,
      fullText: { advice: p.advice, responsibilities: p.responsibilities, nonCommitments: p.nonCommitments },
      feeSnapshot: p.feeSnapshot,
      deviations: p.deviations,
      projectCode: p.projectCode,
      projectVersion: p.projectVersion,
      feeVersion: p.feeVersion,
      wordVersion: p.wordVersion,
      nonCommitmentTemplate: p.nonCommitmentTemplate,
      confirmedAt: p.confirmedAt
    };
    this.persist(p);
    this.audit.record({ actor: customerRef, realm: "customer", action: "proposal.confirm", resource: p.id, result: "allow", subjectRef: customerRef });
    return p;
  }

  /** 客户"我要修改"：旧版归档，生成同号新版本草稿（重走复核） */
  requestRevision(id: string, customerRef: string, note: string): ProposalRecord {
    if (!note?.trim()) throw new ProposalError(422, "42320", "请填写修改点");
    const old = this.require(id);
    if (old.customerRef !== customerRef) throw new ProposalError(403, "42321", "只能修改本人方案");
    if (old.state !== "pending_customer" && old.state !== "customer_confirmed") {
      throw new ProposalError(409, "42322", "仅待确认/已确认版本可申请修改");
    }
    if (old.state === "pending_customer" || old.state === "customer_confirmed") {
      this.apply(old, "revise", customerRef, {}, true);
    } else {
      throw new ProposalError(409, "42322", "仅待确认/已确认版本可申请修改");
    }

    this.seq += 1;
    const now = new Date().toISOString();
    const next: ProposalRecord = {
      ...old,
      id: this.newId(),
      revision: old.revision + 1,
      supersedesId: old.id,
      state: "advisor_draft",
      reviewerId: null,
      secondReviewerId: null,
      reviewReasons: [],
      validUntil: null,
      confirmedAt: null,
      confirmedBy: null,
      confirmSnapshot: null,
      customerRevisionNote: note,
      createdAt: now,
      updatedAt: now
    };
    this.proposals.set(next.id, next);
    this.persist(old);
    this.persist(next);
    this.audit.record({ actor: customerRef, realm: "customer", action: "proposal.request_revision", resource: next.id, result: "allow", reason: note });
    return next;
  }

  /** 项目暂停/超期：在途方案批量失效（由内容治理侧调用） */
  invalidateForProject(projectCode: string, reason: string, actor: string): number {
    let n = 0;
    for (const p of this.proposals.values()) {
      if (p.projectCode !== projectCode) continue;
      if (p.state === "advisor_draft" || p.state === "pending_review" || p.state === "pending_customer") {
        this.apply(p, "invalidate", actor, {}, true);
        p.customerRevisionNote = `项目侧失效：${reason}`;
        this.persist(p);
        n += 1;
      }
    }
    return n;
  }

  needsSecondReview(p: ProposalRecord): boolean {
    for (const d of p.deviations) {
      if (d.type !== "discount" || !d.adjustedAmountMinor) continue;
      const item = p.feeSnapshot.find((f) => f.code === d.itemCode);
      if (item?.amountMinor) {
        const orig = Number(item.amountMinor);
        const adj = Number(d.adjustedAmountMinor);
        if ((orig - adj) / orig > SECOND_REVIEW_THRESHOLD) return true;
      }
    }
    return false;
  }

  /* ---------------- 查询 ---------------- */

  advisorList(advisorId: string) {
    return [...this.proposals.values()].filter((p) => p.advisorId === advisorId);
  }

  customerList(customerRef: string) {
    // 客户只看每条版本链的最新版本；旧版只读、无确认入口
    const byId = this.proposals;
    const rootOf = (p: ProposalRecord): string => {
      let cur = p;
      while (cur.supersedesId && byId.has(cur.supersedesId)) cur = byId.get(cur.supersedesId)!;
      return cur.id;
    };
    const latest = new Map<string, ProposalRecord>();
    for (const p of this.proposals.values()) {
      if (p.customerRef !== customerRef) continue;
      const root = rootOf(p);
      const cur = latest.get(root);
      if (!cur || p.revision > cur.revision) latest.set(root, p);
    }
    return [...latest.values()];
  }

  reviewQueue() {
    return [...this.proposals.values()].filter((p) => p.state === "pending_review");
  }

  getById(id: string, viewer: { realm: "staff" | "customer" | "advisor"; ref: string }): ProposalRecord {
    const p = this.require(id);
    if (viewer.realm === "customer" && p.customerRef !== viewer.ref) {
      this.audit.record({ actor: viewer.ref, realm: "customer", action: "proposal.view", resource: id, result: "deny", reason: "越权查看他人方案" });
      throw new ProposalError(403, "42323", "无权查看该方案");
    }
    if (viewer.realm === "advisor" && p.advisorId !== viewer.ref) {
      this.audit.record({ actor: viewer.ref, realm: "staff", action: "proposal.view", resource: id, result: "deny", reason: "越权查看他人方案" });
      throw new ProposalError(403, "42323", "无权查看该方案");
    }
    return p;
  }

  private require(id: string): ProposalRecord {
    const p = this.proposals.get(id);
    if (!p) throw new ProposalError(404, "42324", "方案不存在");
    return p;
  }

  private requireOwned(id: string, advisorId: string): ProposalRecord {
    const p = this.require(id);
    if (p.advisorId !== advisorId) {
      this.audit.record({ actor: advisorId, realm: "staff", action: "proposal.edit", resource: id, result: "deny", reason: "非本人方案" });
      throw new ProposalError(403, "42325", "只能编辑自己编制的方案");
    }
    return p;
  }

  /** 走 core 状态机（含前置/四眼/有效期守卫） */
  private buildCtx(p: ProposalRecord, actor: string, overrides: Record<string, unknown> = {}) {
    const project = this.catalog.listPublishedProjects().find((x) => x.code === p.projectCode);
    return {
      editorId: p.authorId,
      verifierId: p.reviewerId ?? "",
      publisherId: p.reviewerId ?? "",
      actorId: actor,
      projectPublished: Boolean(project),
      feePublished: Boolean(project?.feeScheduleId),
      advisorAuthorized: this.relgrants(p.advisorId, p.projectCode),
      relationshipActive: true, // assertWritable 已在写入口校验
      validUntil: p.validUntil,
      now: new Date().toISOString(),
      ...overrides
    };
  }

  private relgrants(advisorId: string, projectCode: string): boolean {
    try {
      this.grants.assertCanPitch(advisorId, projectCode);
      return true;
    } catch {
      return false;
    }
  }

  private apply(
    p: ProposalRecord,
    event: Parameters<typeof proposalMachine.transition>[2],
    actor: string,
    ctxOverrides: Record<string, unknown> = {},
    skipGuard = false
  ) {
    // invalidate/revise 等无守卫迁移仍走状态机白名单，只是放宽上下文
    const ctx = (skipGuard
      ? {
          editorId: actor,
          verifierId: actor,
          publisherId: actor,
          actorId: actor,
          projectPublished: true,
          feePublished: true,
          advisorAuthorized: true,
          relationshipActive: true,
          validUntil: p.validUntil,
          now: new Date().toISOString()
        }
      : this.buildCtx(p, actor, ctxOverrides)) as never;
    const out = proposalMachine.transition(ctx, p.state, event);
    if (!out.ok) throw new ProposalError(409, "42326", out.reason ?? "状态迁移被拒绝");
    p.state = out.to as ProposalState;
    p.updatedAt = new Date().toISOString();
  }
}
