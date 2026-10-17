/* AI 数据工厂：版面解析（V4 P1）
 * - text/html/markdown：确定性分块（标题/段落/列表）
 * - PDF：pdfjs-dist 抽取文本与页码（数字 PDF）
 * - 扫描件/复杂图文：视觉模型适配器（Ollama qwen-vl，可用时；无则如实标记）
 */

import { Injectable } from "@nestjs/common";
import type { LayoutBlock } from "./refinery.types.js";

@Injectable()
export class LayoutParser {
  /** 文本类内容分块 */
  parseText(content: string, format: "text/plain" | "text/html" | "text/markdown" | "spreadsheet"): {
    blocks: LayoutBlock[];
    tool: string;
  } {
    let text = content;
    if (format === "text/html") text = this.stripHtml(content);
    const lines = text.split(/\r?\n/);
    const blocks: LayoutBlock[] = [];
    let para: string[] = [];
    let seq = 0;
    const page = 1;

    const flushPara = () => {
      const t = para.join(" ").trim();
      if (t) blocks.push(this.mk(`b${seq++}`, page, "para", t, 0.99));
      para = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) { flushPara(); continue; }
      // Markdown/短行标题
      const mdHead = /^#{1,4}\s+(.*)$/.exec(line);
      if (mdHead) {
        flushPara();
        blocks.push(this.mk(`b${seq++}`, page, "heading", mdHead[1]!.trim(), 0.98));
        continue;
      }
      if (/^\s*[-*•]\s+/.test(line)) {
        flushPara();
        blocks.push(this.mk(`b${seq++}`, page, "list", line.replace(/^\s*[-*•]\s+/, ""), 0.97));
        continue;
      }
      if (/\t|\|/.test(line) && (line.match(/\t|\|/g) ?? []).length >= 1) {
        flushPara();
        blocks.push(this.mk(`b${seq++}`, page, "table", line, 0.9));
        continue;
      }
      // 全短行 + 无句号视为标题
      if (line.length <= 30 && !/[。.？?]$/.test(line) && !line.includes("，")) {
        flushPara();
        blocks.push(this.mk(`b${seq++}`, page, "heading", line, 0.85));
      } else {
        para.push(line);
      }
    }
    flushPara();
    return { blocks, tool: format === "spreadsheet" ? "text-table" : "text-parser" };
  }

  /** PDF：pdfjs-dist 按页抽取（数字 PDF 坐标重建；扫描件文本极少时返回 needsVision 标记） */
  async parsePdf(bytes: Uint8Array): Promise<{
    blocks: LayoutBlock[];
    tool: string;
    needsVision: boolean;
  }> {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // 中文 PDF 常用 CID 字体（如 STSong），必须提供 cMap 否则文字抽取为空
    let pdfjsDir = "";
    try {
      // CJS 产物下 require 可用；pdfjs 为直接依赖，可定位包内 cmaps/standard_fonts
      const pkg = require.resolve("pdfjs-dist/package.json");
      pdfjsDir = require("node:path").dirname(pkg);
    } catch { /* 走默认 cMapUrl（浏览器场景无需） */ }
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true,
      ...(pdfjsDir
        ? {
            cMapUrl: `${pdfjsDir}/cmaps/`, cMapPacked: true,
            standardFontDataUrl: `${pdfjsDir}/standard_fonts/`
          }
        : {})
    }).promise;
    const blocks: LayoutBlock[] = [];
    let seq = 0;
    let totalChars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // 带坐标的文本片段（PDF 坐标：原点左下，y 向上）
      const items = (content.items as Array<any>)
        .map((it) => ({
          x: Number(it.transform[4]) || 0,
          y: Number(it.transform[5]) || 0,
          str: String(it.str ?? "").replace(/\s+/g, " ").trim()
        }))
        .filter((it) => it.str);
      // 按 y 容差聚行（混排字号下同行基线也可能差 1–3pt）
      const rows = this.clusterRows(items);
      const table = this.buildTableRows(rows);
      const pageBlocks: LayoutBlock[] = table
        ? table.map((t) =>
            this.mk(
              `b${seq++}`,
              p,
              t.type === "table" ? "table" : t.text.length <= 30 && !/[。.]$/.test(t.text) ? "heading" : "para",
              t.text,
              t.type === "table" ? 0.9 : 0.92
            )
          )
        : rows.map((r) => {
            const t = this.cleanCjk(r.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
            const type: LayoutBlock["type"] = t.length <= 30 && !/[。.]$/.test(t) ? "heading" : "para";
            return this.mk(`b${seq++}`, p, type, t, 0.92);
          });
      for (const b of pageBlocks) {
        if (b.text) { blocks.push(b); totalChars += b.text.length; }
      }
    }
    // 平均每页文本极少 → 疑似扫描件，需要视觉/OCR
    const needsVision = doc.numPages > 0 && totalChars / doc.numPages < 60;
    return { blocks, tool: needsVision ? "pdfjs(needs-vision)" : "pdfjs", needsVision };
  }

  /** 清理 pdfjs 中文抽取的伪空格（CJK 字符间的空格是排版假象，保留中英文之间空格） */
  private cleanCjk(t: string): string {
    let out = t;
    for (let i = 0; i < 4; i++) {
      const next = out.replace(/([\u4e00-\u9fff，。、；：（）「」])\s+(?=[\u4e00-\u9fff，。、；：（）「」])/g, "$1");
      if (next === out) break;
      out = next;
    }
    return out;
  }

  /** y 坐标容差聚类为视觉行（PDF 坐标 y 向下递减，输出从上到下） */
  private clusterRows(items: Array<{ x: number; y: number; str: string }>): Array<{ y: number; items: Array<{ x: number; y: number; str: string }> }> {
    const Y_TOL = 4;
    const sorted = [...items].sort((a, b) => b.y - a.y);
    const rows: Array<{ y: number; items: Array<{ x: number; y: number; str: string }> }> = [];
    for (const it of sorted) {
      const cur = rows[rows.length - 1];
      if (cur && Math.abs(cur.y - it.y) <= Y_TOL) {
        cur.items.push(it);
        cur.y = Math.max(cur.y, it.y);
      } else {
        rows.push({ y: it.y, items: [it] });
      }
    }
    for (const r of rows) r.items.sort((a, b) => a.x - b.x);
    return rows;
  }

  /** 一维点聚类（用于列 x 起点），tol 内合并，输出中心点（升序） */
  private clusterCenters(values: number[], tol: number): number[] {
    const sorted = [...values].sort((a, b) => a - b);
    const centers: number[] = [];
    let bucket: number[] = [];
    for (const v of sorted) {
      const last = bucket[bucket.length - 1];
      if (bucket.length && last !== undefined && v - last > tol) {
        centers.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);
        bucket = [];
      }
      bucket.push(v);
    }
    if (bucket.length) centers.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);
    return centers;
  }

  /**
   * 表格检测与重建：列起点聚类（≥2 列、多列行≥3 且占比≥40%）→ 逻辑行。
   * 首列（事项/项目名）出现为锚点行；无首列的续行按 x 归入上一锚点行的对应单元格（解决单元格换行被打散）。
   * 表格区前的标题行保持 heading/para。
   */
  private buildTableRows(
    rows: Array<{ y: number; items: Array<{ x: number; y: number; str: string }> }>
  ): Array<{ type: "table" | "other"; text: string }> | null {
    if (rows.length < 3) return null;
    const X_TOL = 14;
    const xHits = rows.flatMap((r) => r.items.map((i) => i.x));
    const centers = this.clusterCenters(xHits, X_TOL);
    if (centers.length < 2) return null;

    const assignCol = (x: number): number => {
      let best = 0; let bestD = Infinity;
      centers.forEach((c, idx) => {
        const d = Math.abs(x - c);
        if (d < bestD) { bestD = d; best = idx; }
      });
      return best;
    };

    // 每行的列占用情况
    const rowCols = rows.map((r) => {
      const set = new Set(r.items.map((i) => assignCol(i.x)));
      return set;
    });
    const multiCol = rowCols.filter((s) => s.size >= 2).length;
    if (multiCol < 3 || multiCol / rows.length < 0.4) return null;

    // 首列中心（左边界）；连续的左侧文本行视为锚点
    const firstCol = 0;
    let firstMulti = rowCols.findIndex((s) => s.size >= 2);
    if (firstMulti < 0) firstMulti = 0;

    const out: Array<{ type: "table" | "other"; text: string }> = [];
    // 表格前的标题行（保持 heading/para）
    for (let i = 0; i < firstMulti; i++) {
      const t = this.cleanCjk(rows[i]!.items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim());
      if (t) out.push({ type: "other", text: t });
    }
    // 逻辑行重建（含表头）
    let cells: string[] = [];
    const flush = () => {
      if (cells.some((c) => c.trim())) {
        const text = cells.map((c) => this.cleanCjk(c.replace(/\s+/g, " ").trim())).join(" | ");
        out.push({ type: "table", text });
      }
      cells = [];
    };
    for (let i = firstMulti; i < rows.length; i++) {
      const row = rows[i]!;
      const cols = [...rowCols[i]!];
      const hasAnchor = cols.includes(firstCol);
      if (hasAnchor) {
        flush();
        cells = new Array(centers.length).fill("");
      } else if (!cells.length) {
        cells = new Array(centers.length).fill("");
      }
      for (const it of row.items) {
        const c = assignCol(it.x);
        const prev = cells[c] ?? "";
        cells[c] = prev ? `${prev} ${it.str}` : it.str;
      }
    }
    flush();
    return out.length >= 3 ? out : null;
  }

  /** 视觉模型适配器（扫描件 OCR/版面）：目标 Ollama VL，不可用则抛错由上层标记 */
  async parseVision(
    base64: string,
    ollamaBase: string,
    model: string
  ): Promise<{ blocks: LayoutBlock[]; tool: string }> {
    const res = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt:
          "请逐页识别这份资料，按 JSON 输出：[{\"page\":1,\"type\":\"heading|para|table\",\"text\":\"...\"}]，只输出 JSON。",
        images: [base64],
        stream: false
      })
    });
    if (!res.ok) throw new Error(`vision http ${res.status}`);
    const json = (await res.json()) as { response: string };
    const match = /\[.*\]/s.exec(json.response);
    if (!match) throw new Error("vision 输出无结构");
    const parsed = JSON.parse(match[0]) as Array<{ page: number; type: string; text: string }>;
    let seq = 0;
    const blocks: LayoutBlock[] = parsed.map((b) => ({
      id: `b${seq++}`,
      page: b.page,
      type: (["heading", "para", "table", "list"].includes(b.type) ? b.type : "para") as LayoutBlock["type"],
      text: b.text,
      conf: 0.7
    }));
    return { blocks, tool: `ollama:${model}` };
  }

  private mk(id: string, page: number, type: LayoutBlock["type"], text: string, conf: number): LayoutBlock {
    return { id, page, type, text, conf };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }
}
