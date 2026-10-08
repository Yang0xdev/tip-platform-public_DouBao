/* AI 数据工厂：类型定义（V4 P1） */

export type DocType =
  | "regulation"
  | "project_doc"
  | "fee_schedule"
  | "contract"
  | "id_document"
  | "report"
  | "email"
  | "spreadsheet"
  | "other";

export type RefineryStage =
  | "ingested"
  | "classified"
  | "parsed"
  | "extracted"
  | "normalized"
  | "awaiting_review"
  | "rejected"
  | "published";

export interface LayoutBlock {
  id: string;
  page: number;
  bbox?: [number, number, number, number];
  type: "heading" | "para" | "table" | "list";
  text: string;
  conf: number;
}

export type FieldState = "found" | "absent" | "uncertain";

export interface ExtractionField {
  key: string;
  label: string;
  kind?: "text" | "date" | "money" | "list";
  value: string | null;
  state: FieldState;
  conf: number;
  evidence: { blockId: string; page: number; snippet: string } | null;
  /** 人工修正标记 */
  manual?: boolean;
}

export interface ValidationFinding {
  code: string;
  level: "block" | "warn";
  message: string;
  fieldKey?: string;
}

export interface RawSource {
  id: string;
  sourceType: "folder" | "scan" | "email" | "export" | "manual" | "api";
  title: string;
  contentType: "text/plain" | "text/html" | "text/markdown" | "application/pdf" | "spreadsheet";
  hash: string;
  sensitivity: "normal" | "sensitive";
  ingestedAt: string;
  stage: RefineryStage;
  /** 文档类型（分诊结果） */
  docType?: DocType;
  classifyConf?: number;
  classifyModel?: string;
  blocks?: LayoutBlock[];
  parseTool?: string;
  fields?: ExtractionField[];
  extractModel?: string;
  normalization?: Array<{ fieldKey: string; from: string; to: string; rule: string }>;
  findings?: ValidationFinding[];
  llmDisagreements?: string[];
  reviewerId?: string;
  publishedId?: string;
  history: Array<{ stage: RefineryStage; at: string; actorId: string; note?: string }>;
  /** 示例标记（种子数据） */
  sample?: boolean;
  /** 文本类 L0 字节内容（内存态；PDF 不存字节，仅存解析块） */
  text?: string;
}

export interface CanonicalRecord {
  id: string;
  type: DocType;
  title: string;
  payload: Record<string, unknown>;
  sourceIds: string[];
  version: number;
  status: "published" | "superseded" | "retracted";
  publishedAt: string;
  publisherId: string;
  wikiSourceId?: string;
}

export interface RefineryDashboard {
  totals: Record<RefineryStage, number>;
  byDocType: Array<{ type: DocType; count: number }>;
  metrics: {
    ingested: number;
    published: number;
    autoClassified: number;
    manualInterventions: number;
    avgFieldConf: number;
  };
  gaps: Array<{ key: string; count: number; lastAt: string }>;
}
