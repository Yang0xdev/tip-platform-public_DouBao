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

  /** PDF：pdfjs-dist 按页抽取（数字 PDF；扫描件文本极少时返回 needsVision 标记） */
  async parsePdf(bytes: Uint8Array): Promise<{
    blocks: LayoutBlock[];
    tool: string;
    needsVision: boolean;
  }> {
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true
    }).promise;
    const blocks: LayoutBlock[] = [];
    let seq = 0;
    let totalChars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines = new Map<string, string[]>();
      for (const item of content.items as Array<any>) {
        const y = Math.round(item.transform[5]);
        const key = `${p}:${y}`;
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key)!.push(item.str);
      }
      const ys = [...lines.keys()].sort((a, b) => Number(b.split(":")[1]) - Number(a.split(":")[1]));
      for (const key of ys) {
        const t = (lines.get(key) ?? []).join(" ").replace(/\s+/g, " ").trim();
        if (!t) continue;
        totalChars += t.length;
        const type: LayoutBlock["type"] = t.length <= 30 && !/[。.]$/.test(t) ? "heading" : "para";
        blocks.push({ id: `b${seq++}`, page: p, type, text: t, conf: 0.92 });
      }
    }
    // 平均每页文本极少 → 疑似扫描件，需要视觉/OCR
    const needsVision = doc.numPages > 0 && totalChars / doc.numPages < 60;
    return { blocks, tool: needsVision ? "pdfjs(needs-vision)" : "pdfjs", needsVision };
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
