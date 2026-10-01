import { HttpException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit.service.js";

class KnowledgeError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

/**
 * AI 知识与运营中心（初步）：
 *  知识条目四眼生命周期 draft → submitted → published → invalidated；
 *  失效条目立即从对客知识列表移除（失效联动）；
 *  本版为确定性内容治理，是后续 ChatProvider/知识编译层（K1–K3）的运营底座。
 */

export type KnowledgeKind = "education" | "faq" | "source";
export type KnowledgeState = "draft" | "submitted" | "published" | "invalidated";

export interface KnowledgeItem {
  id: string;
  title: string;
  kind: KnowledgeKind;
  body: string;
  sourceRef: string;
  level: "cu" | "co" | "sp" | "off";
  authorId: string;
  reviewerId: string | null;
  state: KnowledgeState;
  reason: string | null;
  createdAt: string;
  publishedAt: string | null;
}

@Injectable()
export class KnowledgeService {
  private items = new Map<string, KnowledgeItem>();
  private seq = 0;

  constructor(private readonly audit: AuditService) {}

  ingest(
    actor: string,
    body: { title: string; kind: KnowledgeKind; body: string; sourceRef: string; level?: KnowledgeItem["level"] }
  ): KnowledgeItem {
    if (!body.title?.trim() || !body.body?.trim() || !body.sourceRef?.trim()) {
      throw new KnowledgeError(400, "44201", "标题、正文、来源凭据必填");
    }
    this.seq += 1;
    const now = new Date().toISOString();
    const item: KnowledgeItem = {
      id: `KN-${String(this.seq).padStart(4, "0")}`,
      title: body.title.trim(),
      kind: body.kind ?? "education",
      body: body.body.trim(),
      sourceRef: body.sourceRef.trim(),
      level: body.level ?? "co",
      authorId: actor,
      reviewerId: null,
      state: "draft",
      reason: null,
      createdAt: now,
      publishedAt: null
    };
    this.items.set(item.id, item);
    this.audit.record({ actor, realm: "staff", action: "ai.knowledge.ingest", resource: item.id, result: "allow" });
    return item;
  }

  submit(id: string, actor: string): KnowledgeItem {
    const item = this.must(id);
    if (item.authorId !== actor) throw new KnowledgeError(403, "44202", "仅编制人可提交");
    if (item.state !== "draft") throw new KnowledgeError(409, "44203", "仅草稿可提交");
    item.state = "submitted";
    this.audit.record({ actor, realm: "staff", action: "ai.knowledge.submit", resource: id, result: "allow" });
    return item;
  }

  review(id: string, actor: string, decision: "approve" | "reject", reason?: string): KnowledgeItem {
    const item = this.must(id);
    if (item.state !== "submitted") throw new KnowledgeError(409, "44204", "仅待审条目可复核");
    if (item.authorId === actor) throw new KnowledgeError(403, "44205", "复核人不可与编制人相同");
    if (decision === "approve") {
      item.state = "published";
      item.reviewerId = actor;
      item.publishedAt = new Date().toISOString();
    } else {
      item.state = "draft";
      item.reason = reason?.trim() || "复核驳回";
    }
    this.audit.record({
      actor, realm: "staff", action: "ai.knowledge.review", resource: id,
      result: "allow", reason: decision
    });
    return item;
  }

  /** 失效：立即从对客列表移除 */
  invalidate(id: string, actor: string, reason: string): KnowledgeItem {
    const item = this.must(id);
    if (item.state !== "published") throw new KnowledgeError(409, "44206", "仅已发布条目可失效");
    if (!reason?.trim()) throw new KnowledgeError(400, "44207", "失效原因必填");
    item.state = "invalidated";
    item.reason = reason.trim();
    this.audit.record({ actor, realm: "staff", action: "ai.knowledge.invalidate", resource: id, result: "allow", reason });
    return item;
  }

  list(state?: KnowledgeState): { records: KnowledgeItem[] } {
    const all = [...this.items.values()].filter((i) => (state ? i.state === state : true));
    return { records: all };
  }

  /** 对客/AI 可用：仅 published */
  published(): { records: KnowledgeItem[] } {
    return { records: [...this.items.values()].filter((i) => i.state === "published") };
  }

  private must(id: string): KnowledgeItem {
    const item = this.items.get(id);
    if (!item) throw new KnowledgeError(404, "44208", "知识条目不存在");
    return item;
  }
}
