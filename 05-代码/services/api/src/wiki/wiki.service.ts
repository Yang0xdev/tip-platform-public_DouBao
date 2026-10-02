import { HttpException, Injectable } from "@nestjs/common";
import { WordEngine } from "@tip/core";
import { AuditService } from "../audit.service.js";

/**
 * K1 知识编译层（Wiki）：
 *  L0 raw（不可变，只追加）→ L1 Wiki Markdown 主题页（frontmatter + 交叉引用）
 *  流程：ingest → compile → lint → submit → review（四眼）→ publish；
 *  L0 失效联动下架；全部操作留审计。
 *  LLM 编译草稿（Qwen Wiki 编译器）由端侧发起、服务端只接收草稿文本；
 *  无 sources 的草稿不可提交。
 */

export type SourceState = "raw" | "compiled" | "invalidated";
export type PageState = "draft" | "submitted" | "published" | "invalidated";

export interface WikiSource {
  id: string;
  kind: "document" | "regulation" | "fee" | "education";
  title: string;
  body: string;
  sourceRef: string;
  level: "cu" | "co" | "sp" | "off";
  state: SourceState;
  createdAt: string;
}

export interface PageHistoryEntry {
  state: PageState;
  at: string;
  actorId: string;
  note?: string;
}

export interface WikiPage {
  id: string;
  slug: string;
  title: string;
  markdown: string;
  sources: string[];
  version: number;
  authorId: string;
  reviewerId: string | null;
  state: PageState;
  compiledWith: "manual" | "qwen";
  lint: LintReport | null;
  publishedAt: string | null;
  history: PageHistoryEntry[];
  createdAt: string;
}

export interface LintReport {
  at: string;
  ok: boolean;
  brokenLinks: string[];
  unsourcedParagraphs: number;
  expiredSources: string[];
  wordViolations: string[];
}

class WikiError extends HttpException {
  constructor(status: number, code: string, message: string) {
    super({ code, message }, status);
  }
}

const wordEngine = new WordEngine("v1");

@Injectable()
export class WikiService {
  private sources = new Map<string, WikiSource>();
  private pages = new Map<string, WikiPage>();
  private srcSeq = 0;
  private pageSeq = 0;

  constructor(private readonly audit: AuditService) {}

  /* ---------------- L0 ---------------- */

  ingestSource(
    actorId: string,
    body: {
      kind: WikiSource["kind"];
      title: string;
      body: string;
      sourceRef: string;
      level?: WikiSource["level"];
    }
  ): WikiSource {
    if (!body.title?.trim() || !body.body?.trim() || !body.sourceRef?.trim()) {
      throw new WikiError(400, "44301", "标题、正文、来源凭据必填");
    }
    this.srcSeq += 1;
    const s: WikiSource = {
      id: `WS-${String(this.srcSeq).padStart(4, "0")}`,
      kind: body.kind,
      title: body.title.trim(),
      body: body.body,
      sourceRef: body.sourceRef.trim(),
      level: body.level ?? "co",
      state: "raw",
      createdAt: new Date().toISOString()
    };
    this.sources.set(s.id, s);
    this.audit.record({ actor: actorId, realm: "staff", action: "wiki.source.ingest", resource: s.id, result: "allow" });
    return s;
  }

  listSources(): { records: WikiSource[] } {
    return { records: [...this.sources.values()] };
  }

  /* ---------------- 编译 ---------------- */

  compileDraft(
    actorId: string,
    body: {
      title: string;
      slug: string;
      sourceIds: string[];
      markdown?: string;
      compiledWith?: "manual" | "qwen";
    }
  ): WikiPage {
    const sourceIds = [...new Set(body.sourceIds ?? [])];
    if (sourceIds.length === 0) {
      throw new WikiError(400, "44302", "至少绑定一个 L0 来源");
    }
    for (const id of sourceIds) {
      const s = this.sources.get(id);
      if (!s) throw new WikiError(400, "44303", `来源 ${id} 不存在`);
      if (s.state === "invalidated") throw new WikiError(400, "44304", `来源 ${id} 已失效`);
    }
    const slug = (body.slug || body.title || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\w\-\u4e00-\u9fa5]/g, "");
    if (!slug) throw new WikiError(400, "44305", "slug/标题必填");
    if ([...this.pages.values()].some((p) => p.slug === slug && p.state !== "invalidated")) {
      throw new WikiError(400, "44306", `slug ${slug} 已存在`);
    }

    // 确定性人工编译草稿：把来源正文结构化，逐段带来源引用（LLM 草稿可直接传入 markdown）
    const markdown =
      body.markdown?.trim() ??
      [
        `# ${body.title.trim()}`,
        "",
        ...sourceIds.flatMap((id) => {
          const s = this.sources.get(id)!;
          const paras = s.body
            .trim()
            .split(/\n{2,}|\n/)
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => `${x}（来源：${id}）`);
          return [`## ${s.title}`, "", ...paras, ""];
        }),
        "<!-- 相关主题：使用 [[slug]] 添加交叉引用 -->"
      ].join("\n");

    this.pageSeq += 1;
    const now = new Date().toISOString();
    const page: WikiPage = {
      id: `WP-${String(this.pageSeq).padStart(4, "0")}`,
      slug,
      title: body.title.trim(),
      markdown,
      sources: sourceIds,
      version: 1,
      authorId: actorId,
      reviewerId: null,
      state: "draft",
      compiledWith: body.compiledWith ?? "manual",
      lint: null,
      publishedAt: null,
      history: [{ state: "draft", at: now, actorId, note: "compile" }],
      createdAt: now
    };
    this.pages.set(page.id, page);
    for (const id of sourceIds) {
      const s = this.sources.get(id)!;
      if (s.state === "raw") s.state = "compiled";
    }
    this.audit.record({ actor: actorId, realm: "staff", action: "wiki.page.compile", resource: page.id, result: "allow" });
    return page;
  }

  /* ---------------- Lint（确定性四检查） ---------------- */

  lint(actorId: string, pageId: string): LintReport {
    const p = this.must(pageId);
    const brokenLinks: string[] = [];
    // 剔除 HTML 注释（含占位说明）后再做链接检查
    const visible = p.markdown.replace(/<!--[\s\S]*?-->/g, "");
    const refs = [...visible.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => (m[1] ?? "").trim());
    const slugs = new Set([...this.pages.values()].filter((x) => x.state !== "invalidated").map((x) => x.slug));
    for (const r of refs) if (!slugs.has(r)) brokenLinks.push(r);

    // 无来源段落：正文段落（非标题/列表/注释）不含来源 id
    const paragraphs = p.markdown
      .split(/\n{2,}/)
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith("#") && !x.startsWith("<!--") && !x.startsWith("|"));
    let unsourced = 0;
    for (const para of paragraphs) {
      if (!p.sources.some((id) => para.includes(id))) unsourced += 1;
    }

    const expiredSources = p.sources.filter((id) => this.sources.get(id)?.state === "invalidated");

    const word = wordEngine.check(p.markdown, "proposal");
    const wordViolations = word.blocked.map((b) => b.matched);

    const report: LintReport = {
      at: new Date().toISOString(),
      ok: brokenLinks.length === 0 && unsourced === 0 && expiredSources.length === 0 && wordViolations.length === 0,
      brokenLinks,
      unsourcedParagraphs: unsourced,
      expiredSources,
      wordViolations
    };
    p.lint = report;
    this.audit.record({
      actor: actorId,
      realm: "staff",
      action: "wiki.page.lint",
      resource: p.id,
      result: report.ok ? "allow" : "deny"
    });
    return report;
  }

  /* ---------------- 四眼发布 ---------------- */

  submit(actorId: string, pageId: string): WikiPage {
    const p = this.must(pageId);
    if (p.authorId !== actorId) throw new WikiError(403, "44307", "仅编制人可提交");
    if (p.state !== "draft") throw new WikiError(400, "44308", "仅草稿可提交");
    if (!p.lint) throw new WikiError(400, "44309", "提交前必须先 Lint");
    if (!p.lint.ok) throw new WikiError(400, "44310", "Lint 未通过，不能提交");
    p.state = "submitted";
    p.history.push({ state: "submitted", at: new Date().toISOString(), actorId });
    this.audit.record({ actor: actorId, realm: "staff", action: "wiki.page.submit", resource: p.id, result: "allow" });
    return p;
  }

  review(actorId: string, pageId: string, approve: boolean, reason?: string): WikiPage {
    const p = this.must(pageId);
    if (p.state !== "submitted") throw new WikiError(400, "44311", "仅待复核可复核");
    if (actorId === p.authorId) throw new WikiError(403, "44312", "复核人不可与编制人相同");
    if (!approve && !reason?.trim()) throw new WikiError(400, "44313", "驳回必填原因");
    if (approve) {
      p.state = "published";
      p.reviewerId = actorId;
      p.publishedAt = new Date().toISOString();
    } else {
      p.state = "draft";
    }
    p.history.push({ state: p.state, at: new Date().toISOString(), actorId, note: reason });
    this.audit.record({
      actor: actorId,
      realm: "staff",
      action: approve ? "wiki.page.publish" : "wiki.page.reject",
      resource: p.id,
      result: approve ? "allow" : "deny"
    });
    return p;
  }

  /** L0 失效：联动下架已发布页 */
  invalidateForSource(actorId: string, sourceId: string, reason: string): { affected: string[] } {
    const s = this.sources.get(sourceId);
    if (!s) throw new WikiError(404, "44314", "来源不存在");
    if (!reason?.trim()) throw new WikiError(400, "44315", "失效原因必填");
    s.state = "invalidated";
    const affected: string[] = [];
    for (const p of this.pages.values()) {
      if (p.sources.includes(sourceId) && p.state === "published") {
        p.state = "invalidated";
        p.history.push({ state: "invalidated", at: new Date().toISOString(), actorId, note: reason });
        affected.push(p.id);
      }
    }
    this.audit.record({
      actor: actorId,
      realm: "staff",
      action: "wiki.source.invalidate",
      resource: sourceId,
      result: "deny",
      reason
    });
    return { affected };
  }

  listPages(state?: PageState): { records: WikiPage[] } {
    const records = [...this.pages.values()].filter((p) => !state || p.state === state);
    return { records };
  }

  publishedPages(): WikiPage[] {
    return [...this.pages.values()].filter((p) => p.state === "published");
  }

  /** 知识缺口：raw 来源中尚未被任何有效页引用的 */
  gaps(): { records: WikiSource[] } {
    const covered = new Set<string>();
    for (const p of this.pages.values()) {
      if (p.state === "published" || p.state === "submitted" || p.state === "draft") {
        for (const s of p.sources) covered.add(s);
      }
    }
    return { records: [...this.sources.values()].filter((s) => s.state !== "invalidated" && !covered.has(s.id)) };
  }

  private must(id: string): WikiPage {
    const p = this.pages.get(id);
    if (!p) throw new WikiError(404, "44316", "Wiki 页不存在");
    return p;
  }
}
