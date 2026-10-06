/* AI 中枢：任务复杂度评分 + 模型路由（V4 P0）
 * 规则确定性、可解释；本地优先，云第三档默认关闭。 */

import { Injectable } from "@nestjs/common";
import { ModelRegistry } from "./model.registry.js";
import type { AiTaskKind, ModelTier, RouteDecision, RouteRequest } from "./model.types.js";

/** 多步/复杂任务标记词（中英） */
const COMPLEX_MARKERS = [
  "然后", "同时", "另外", "并且", "以及", "步骤", "组合", "多个", "综合", "对比",
  "and then", "additionally", "moreover", "step", "combine", "multiple", "compare",
  "furthermore", "also"
];

@Injectable()
export class ModelRouter {
  constructor(private registry: ModelRegistry) {}

  /** 基于文本的确定性复杂度评分 0..1 */
  scoreComplexity(text?: string): number {
    if (!text) return 0.35;
    const t = text.toLowerCase();
    let score = 0.15;
    // 长度因子（每 60 字符 +0.08，上限 0.4）
    score += Math.min(0.4, text.length / 60 * 0.08);
    // 多步标记
    let hits = 0;
    for (const m of COMPLEX_MARKERS) if (t.includes(m)) hits += 1;
    score += Math.min(0.3, hits * 0.1);
    // 问号数量（多子问题）
    const qCount = (text.match(/[?？]/g) ?? []).length;
    score += Math.min(0.15, qCount * 0.075);
    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }

  /** 云第三档总开关：默认关闭，需显式环境变量启用 */
  get cloudEnabled(): boolean {
    return process.env.AI_CLOUD_TIER === "1";
  }

  route(req: RouteRequest): RouteDecision {
    const complexity = req.complexity ?? this.scoreComplexity(req.text);
    const sensitive = req.sensitivity === "sensitive";

    let tier: ModelTier;
    let reason: string;
    switch (req.task) {
      case "embed":
        tier = "embed";
        reason = "向量化任务固定使用嵌入模型";
        break;
      case "vision":
        tier = "vision";
        reason = "图像/扫描件/表格理解固定使用视觉模型";
        break;
      case "classify":
      case "chat":
      case "extract_simple":
        tier = "fast";
        reason = `任务=${req.task}，优先快速小模型（复杂度 ${complexity}）`;
        break;
      case "draft":
      case "extract_complex":
        tier = "standard";
        reason = `任务=${req.task}，需要稳定结构化输出，使用日常中模型（复杂度 ${complexity}）`;
        break;
      case "reason":
        if (complexity >= 0.6) {
          tier = "large";
          reason = `多步推理且复杂度高（${complexity}），使用大模型`;
        } else {
          tier = "standard";
          reason = `推理任务复杂度中等（${complexity}），使用中模型`;
        }
        break;
      default: {
        const check: never = req.task;
        throw new Error(`未知任务类型: ${String(check)}`);
      }
    }

    const candidateTags = this.registry.tagsByTier(tier);
    // 敏感任务永不走云；云总开关默认关
    const cloudAllowed = this.cloudEnabled && !sensitive && tier !== "vision" && tier !== "embed";
    const fallbackTier: RouteDecision["fallbackTier"] =
      tier === "embed" || tier === "vision" ? "deterministic"
      : tier === "large" ? "standard"
      : tier === "standard" ? "fast"
      : "deterministic";

    return { tier, candidateTags, reason, cloudAllowed, fallbackTier, complexity };
  }
}
