/* 浏览器侧扫描件视觉解析（V4 P3）
 * pdfjs 渲染 PDF 页 → canvas → 本机 Ollama Qwen-VL 转录版面块 → 回传 refinery
 * 全程在操作者浏览器与本机模型之间完成，不上传图像到云端。
 */

import * as pdfjsLib from "pdfjs-dist";
// Vite：把 worker 作为静态资源 URL
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface VisionBlock {
  id: string;
  page: number;
  type: "heading" | "paragraph" | "list" | "table";
  text: string;
}

const OLLAMA = "http://127.0.0.1:11434";
const MAX_PAGES = 12;

/** 探测本机 Ollama 上可用的视觉模型；不可达抛错（含配置指引） */
export async function pickVisionModel(): Promise<string> {
  let tags: { models?: Array<{ name: string }> };
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    tags = await r.json();
  } catch {
    throw new Error(
      "连不上本机 Ollama（127.0.0.1:11434）。请确认：① 已启动 Ollama；② 已拉取视觉模型（ollama pull qwen2.5vl:7b）；③ OLLAMA_ORIGINS 已放行 https://demo.hbwhere.com"
    );
  }
  const names = (tags.models ?? []).map((m) => m.name);
  const pref = [
    /^qwen2\.5vl:7b/, /^qwen2\.5vl/, /^qwen2-vl/, /vl/i
  ];
  for (const re of pref) {
    const hit = names.find((n) => re.test(n));
    if (hit) return hit;
  }
  throw new Error("本机 Ollama 未发现视觉模型，请执行：ollama pull qwen2.5vl:7b");
}

async function transcribePage(
  model: string, imageBase64: string, page: number
): Promise<VisionBlock[]> {
  const prompt = [
    "你是严谨的文档转录引擎。逐字转录图片中的文档内容，按版面结构分块输出。",
    "只输出 JSON：{\"blocks\":[{\"type\":\"heading|paragraph|list|table\",\"text\":\"逐字内容\"}]}。",
    "规则：标题用 heading；普通段落用 paragraph；多条目清单合并为一个 list（条目间用换行）；表格用 table 并保留行列文字；",
    "不得总结、不得补全、不得翻译、不得添加图片中没有的内容；看不清的文字不要输出。"
  ].join("");
  const r = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model, prompt, images: [imageBase64],
      stream: false, format: "json",
      options: { temperature: 0 }
    })
  });
  if (!r.ok) throw new Error(`视觉模型调用失败（p${page}）：HTTP ${r.status}`);
  const data = (await r.json()) as { response?: string };
  let parsed: { blocks?: Array<{ type?: string; text?: string }> };
  try {
    parsed = JSON.parse(data.response ?? "{}");
  } catch {
    throw new Error(`视觉模型 p${page} 未返回合法 JSON`);
  }
  const out: VisionBlock[] = [];
  let n = 0;
  for (const b of parsed.blocks ?? []) {
    const text = (b.text ?? "").trim();
    if (!text) continue;
    const t = String(b.type ?? "paragraph").toLowerCase();
    const type = (["heading", "list", "table"].includes(t) ? t : "paragraph") as VisionBlock["type"];
    n += 1;
    out.push({ id: `b-p${page}-${n}`, page, type, text });
  }
  return out;
}

/** 渲染并解析整个扫描件；onProgress 回传“当前页/总页” */
export async function visionParsePdf(
  file: File,
  model: string,
  onProgress?: (cur: number, total: number) => void
): Promise<{ blocks: VisionBlock[]; truncated: boolean }> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = Math.min(pdf.numPages, MAX_PAGES);
  const truncated = pdf.numPages > MAX_PAGES;
  const blocks: VisionBlock[] = [];
  for (let p = 1; p <= total; p++) {
    onProgress?.(p, total);
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const img = canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
    const pageBlocks = await transcribePage(model, img, p);
    blocks.push(...pageBlocks);
  }
  return { blocks, truncated };
}
