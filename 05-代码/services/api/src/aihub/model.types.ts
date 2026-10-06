/* AI 中枢：模型与任务类型定义（V4 P0） */

export type ModelTier = "fast" | "standard" | "large" | "vision" | "embed";

export type ModelCapability =
  | "classify"
  | "extract"
  | "draft"
  | "reason"
  | "vision"
  | "embed"
  | "chat";

export interface ModelRecord {
  /** Ollama 模型标签，如 qwen2.5:7b */
  tag: string;
  tier: ModelTier;
  capabilities: ModelCapability[];
  contextWindow?: number;
  provider: "ollama";
  /** 同档位首选标记 */
  preferred?: boolean;
  /** 备注（部署/硬件建议） */
  note?: string;
}

export interface ModelStatusView extends ModelRecord {
  /** 该标签是否已在目标 Ollama 实例安装 */
  available: boolean;
  /** 是否当前常驻内存 */
  loaded: boolean;
  sizeBytes?: number;
  quantization?: string;
  probedAt: string | null;
  error?: string;
}

export type AiTaskKind =
  | "classify"
  | "extract_simple"
  | "extract_complex"
  | "draft"
  | "reason"
  | "vision"
  | "embed"
  | "chat";

export interface RouteRequest {
  task: AiTaskKind;
  /** 可选：显式复杂度 0..1；不传则按 text 自动评分 */
  complexity?: number;
  text?: string;
  /** 密级：敏感任务禁止云模型 */
  sensitivity?: "normal" | "sensitive";
}

export interface RouteDecision {
  tier: ModelTier;
  candidateTags: string[];
  reason: string;
  /** 本次是否允许云第三档 */
  cloudAllowed: boolean;
  fallbackTier: ModelTier | "deterministic";
  complexity: number;
}
