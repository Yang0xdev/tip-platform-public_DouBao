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

export interface ProbeResult {
  reachable: boolean;
  allModels: string[];
  vlModels: string[];
  error?: string;
}

/** 自检：浏览器 → 本机 Ollama 连通性与视觉模型清单 */
export async function probeOllama(): Promise<ProbeResult> {
  let tags: { models?: Array<{ name: string }> };
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    tags = await r.json();
  } catch {
    return {
      reachable: false, allModels: [], vlModels: [],
      error:
        "连不上本机 Ollama。请确认：① Ollama 已启动；② 已执行 launchctl setenv OLLAMA_ORIGINS 放行本站并重启 Ollama"
    };
  }
  const allModels = (tags.models ?? []).map((m) => m.name);
  const vlModels = allModels.filter((n) => /vl/i.test(n));
  return { reachable: true, allModels, vlModels };
}

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
  // 极简 prompt：实测对 Qwen2.5-VL（3b/7b）最稳健；任何加长规则反而导致只输出标题
  const prompt = '逐字转录，只输出 JSON：{"blocks":[{"type":"heading|paragraph|list|table","text":"..."}]}';
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
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    // 用 PNG（无损）：实测 JPEG 压缩伪影会让 3b 模型把整页合并成一块；
    // 白底文字页 PNG 仅约 300KB，体积可接受
    const img = canvas.toDataURL("image/png").split(",")[1]!;
    const pageBlocks = await transcribePage(model, img, p);
    blocks.push(...pageBlocks);
  }
  return { blocks, truncated };
}
