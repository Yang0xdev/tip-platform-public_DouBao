/**
 * 对客 API（M1：游客只读 + 无状态初评）
 * - dev 默认本机 api；模拟器/真机用 EXPO_PUBLIC_API_BASE 覆盖（Android 模拟器用 http://10.0.2.2:3100）
 * - 游客端点不需要身份头；M2 登录后由 Keycloak customer realm 注入 Bearer。
 */
export const API_BASE =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.EXPO_PUBLIC_API_BASE ??
  "http://localhost:3100";

export interface ProjectView {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  state: string;
  feeScheduleId: string | null;
  keyFactIds: string[];
}

export interface FeeItemView {
  code: string;
  label: string;
  nature: string;
  collector: string | null;
  collectorTbc?: boolean;
  currency: string | null;
  amountMinor: string | null;
  certainty: "confirmed" | "estimated" | "tbc" | "not_incurred";
}

export interface FeeScheduleView {
  id: string;
  code: string;
  version: number;
  title: string;
  body: string;
  feeItems: FeeItemView[];
}

export interface Question {
  code: string;
  group: string;
  title: string;
  type: "single" | "multi" | "number" | "text" | "choice";
  required: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface Questionnaire {
  id: string;
  code: string;
  version: number;
  title: string;
  content: { questions: Question[] };
}

export interface DimensionResultView {
  code: string;
  label: string;
  status: "met" | "gap" | "unconfirmed";
  reasons: string[];
}

export interface EvaluateResponse {
  projectCode: string;
  outcome: "eligible" | "gap" | "unconfirmed" | "not_committed";
  questionnaireVersion: string;
  ruleVersion: string;
  sections: {
    met: DimensionResultView[];
    gap: DimensionResultView[];
    unconfirmed: DimensionResultView[];
    sources: { note: string; ruleVersion: string };
  };
  notCommittedNote: string | null;
  needsManualNote: string | null;
  disclaimer: string;
}

export interface GlobalAccessStatus {
  key: string;
  available: boolean;
  title?: string;
  body?: string;
  pages?: string[];
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => getJson<{ records: ProjectView[] }>("/v1/catalog/projects"),
  getProject: (id: string) => getJson<ProjectView>(`/v1/catalog/projects/${id}`),
  getFeeSchedule: (id: string) => getJson<FeeScheduleView>(`/v1/catalog/fee-schedules/${id}`),
  getQuestionnaire: () => getJson<Questionnaire>("/v1/assessment/questionnaire"),
  evaluate: (projectCode: string, answers: Record<string, string | number | undefined>) =>
    postJson<EvaluateResponse>("/v1/assessment/evaluate", { projectCode, answers }),
  globalAccessStatus: (key: string) => getJson<GlobalAccessStatus>(`/v1/global-access/${key}/status`)
};
