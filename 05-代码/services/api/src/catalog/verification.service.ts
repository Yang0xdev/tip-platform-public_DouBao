import { HttpException, Injectable } from "@nestjs/common";

/**
 * 事实核验台账（PRD-M1 M1-03）
 * 每条关键事实一条记录；项目版本发布要求全部关键事实为 verified，
 * 且核验人 ≠ 版本最后编辑人（SoD）。invalid 自动阻断对客展示。
 * M1 来源引用为 URL/文本；附件 L3 存储在 M3 接入。
 */

export type FactType = "policy" | "condition" | "official_fee" | "license" | "timeline";
export type SourceType = "official_url" | "official_doc" | "licensee_written";
export type VerificationState = "verified" | "due" | "invalid";

export interface VerificationInput {
  fact: string;
  factType: FactType;
  sourceType: SourceType;
  sourceRef: string;
  sourcePublishedAt?: string | null;
  /** 初始节拍（天）：政策类 90，其他 180；费用类随官方公布，初始也按 180，A11 校准 */
  nextReviewDays?: number;
}

export interface VerificationRecord {
  id: string;
  fact: string;
  factType: FactType;
  sourceType: SourceType;
  sourceRef: string;
  sourcePublishedAt: string | null;
  verifierId: string;
  verifiedAt: string;
  nextReviewAt: string;
  state: VerificationState;
}

const DEFAULT_CADENCE_DAYS: Record<FactType, number> = {
  policy: 90,
  condition: 180,
  official_fee: 180,
  license: 90,
  timeline: 180
};

export class VerificationError extends HttpException {
  constructor(status: number, bizCode: string, message: string, details?: unknown) {
    super({ code: bizCode, message, details }, status);
  }
}

@Injectable()
export class VerificationService {
  private records = new Map<string, VerificationRecord>();
  private seq = 0;

  register(input: VerificationInput, verifierId: string, now = new Date()): VerificationRecord {
    if (!input.fact?.trim() || !input.sourceRef?.trim()) {
      throw new VerificationError(400, "40010", "事实描述与来源引用必填");
    }
    if (input.sourceType === "official_url" && !/^https?:\/\//.test(input.sourceRef)) {
      throw new VerificationError(400, "40011", "官方链接必须为 http(s) URL");
    }
    this.seq += 1;
    const verifiedAt = now.toISOString();
    const days = input.nextReviewDays ?? DEFAULT_CADENCE_DAYS[input.factType];
    const next = new Date(now.getTime() + days * 86_400_000);
    const rec: VerificationRecord = {
      id: `VR-${String(this.seq).padStart(4, "0")}`,
      fact: input.fact.trim(),
      factType: input.factType,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef.trim(),
      sourcePublishedAt: input.sourcePublishedAt ?? null,
      verifierId,
      verifiedAt,
      nextReviewAt: next.toISOString(),
      state: "verified"
    };
    this.records.set(rec.id, rec);
    return { ...rec };
  }

  invalidate(id: string, reason: string): VerificationRecord {
    const rec = this.require(id);
    if (!reason?.trim()) throw new VerificationError(400, "40012", "标记失效必须填写原因");
    rec.state = "invalid";
    return { ...rec };
  }

  /** 定时任务节拍：到期置 due（临期看板；due 仍可见，invalid 才阻断） */
  refreshDue(now = new Date()): string[] {
    const due: string[] = [];
    for (const rec of this.records.values()) {
      if (rec.state === "verified" && new Date(rec.nextReviewAt) <= now) {
        rec.state = "due";
        due.push(rec.id);
      }
    }
    return due;
  }

  list(): VerificationRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  get(id: string): VerificationRecord {
    return { ...this.require(id) };
  }

  /**
   * 项目版本发布门：事实全部存在且 verified；核验人不得是版本最后编辑人。
   * due（临期）允许发布但进看板；invalid/缺失拒绝。
   */
  assertPublishable(factIds: string[], editorId: string): void {
    if (factIds.length === 0) throw new VerificationError(422, "KEY_FACTS_REQUIRED", "项目版本至少登记一条关键事实");
    const problems: string[] = [];
    const verifiers = new Set<string>();
    for (const fid of factIds) {
      const rec = this.records.get(fid);
      if (!rec) { problems.push(`${fid}: 核验记录不存在`); continue; }
      if (rec.state === "invalid") problems.push(`${fid}: 来源已失效`);
      verifiers.add(rec.verifierId);
    }
    if (verifiers.size === 1 && [...verifiers][0] === editorId) {
      throw new VerificationError(422, "VERIFIER_IS_EDITOR", "核验人不得为该版本最后编辑人（职责分离）");
    }
    if (problems.length) throw new VerificationError(422, "KEY_FACTS_UNVERIFIED", "存在未核验/失效关键事实", problems);
  }

  /** 对客可见性：published 版本关联事实出现 invalid 即隐藏 */
  allUsable(factIds: string[]): boolean {
    return factIds.every((id) => this.records.get(id)?.state === "verified" || this.records.get(id)?.state === "due");
  }

  private require(id: string): VerificationRecord {
    const rec = this.records.get(id);
    if (!rec) throw new VerificationError(404, "40410", "核验记录不存在");
    return rec;
  }
}
