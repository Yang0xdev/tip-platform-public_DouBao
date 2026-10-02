/**
 * 顾问端 AI 混合（U2）类型。
 */

export type AiMode = "L" | "S" | "D";

export interface AdvisorContextEnvelope {
  version: "ctx-v1";
  kind: string;
  anchor: { customerRef: string | null; stage: string | null };
  fragments: Array<Record<string, unknown>>;
  knowledge: Array<{ id: string; title: string; excerpt: string }>;
  disallowed: string[];
}

export interface ChatChunk {
  kind: "delta" | "done";
  text?: string;
}

/* ---------- 草稿（须顾问确认才入库） ---------- */

export interface FollowDraft {
  kind: "follow";
  text: string;
  visibility: "fact" | "internal";
}

export interface TaskDraft {
  kind: "task";
  caseId: string;
  title: string;
  ownerId: string;
  dueAt: string;
  source: "official" | "contract" | "sla";
  t0: boolean;
}

export interface MessageDraft {
  kind: "message";
  text: string;
}

export type Draft = FollowDraft | TaskDraft | MessageDraft;

export interface AdvisorAiResult {
  mode: AiMode;
  model?: string;
  text: string;
  sources: Array<{ level: string; title: string; ref: string }>;
  next?: string;
  drafts: Draft[];
  grounded: boolean;
}
