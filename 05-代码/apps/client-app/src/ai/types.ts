/**
 * AI 混合（U1）类型定义——增量模块，不改动现有确定性 AI 调用。
 */

export type AiMode = "L" | "S" | "D";

export interface ContextFragment {
  type: string;
  [k: string]: unknown;
}

export interface ContextKnowledge {
  id: string;
  title: string;
  excerpt: string;
}

export interface ContextEnvelope {
  version: "ctx-v1";
  kind:
    | "progress"
    | "fees"
    | "materials"
    | "contract"
    | "interview"
    | "compare"
    | "general";
  caseId?: string;
  fragments: ContextFragment[];
  knowledge: ContextKnowledge[];
  disallowed: string[];
}

export interface ChatChunk {
  kind: "delta" | "done";
  text?: string;
}

export interface ChatRequest {
  system: string;
  envelope: ContextEnvelope;
  question: string;
  model?: string;
  signal?: AbortSignal;
}

export interface ChatProvider {
  readonly mode: AiMode;
  detect(): Promise<boolean>;
  chat(req: ChatRequest): AsyncIterable<ChatChunk>;
}

/** Orchestrator 统一返回（与现有 AiAnswerView 兼容 + 流式元信息） */
export interface AiResult {
  mode: AiMode;
  model?: string;
  text: string;
  sources: Array<{ level: string; title: string; ref: string }>;
  next?: string;
  needConsent?: boolean;
  grounded: boolean;
}
