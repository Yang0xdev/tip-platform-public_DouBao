/**
 * 对客 API（M1：游客只读 + 无状态初评）
 * - dev 默认本机 api；模拟器/真机用 EXPO_PUBLIC_API_BASE 覆盖（Android 模拟器用 http://10.0.2.2:3100）
 * - 游客端点不需要身份头；M2 登录后由 Keycloak customer realm 注入 Bearer。
 */
declare const process: { env: Record<string, string | undefined> };
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3100";

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

/** dev 客户身份（M2 后由 Keycloak customer realm Bearer 替换） */
const CUSTOMER_ID = "c-1980";
const customerHeaders = (extra?: Record<string, string>) => ({
  "x-tip-realm": "customer",
  "x-tip-user": CUSTOMER_ID,
  ...(extra ?? {})
});

async function getJson<T>(path: string, asCustomer = false): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, asCustomer ? { headers: customerHeaders() } : undefined);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

async function postJson<T>(path: string, payload: unknown, asCustomer = false): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: customerHeaders({ "content-type": "application/json" }),
    body: asCustomer ? JSON.stringify(payload) : JSON.stringify(payload)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

export interface CaseView {
  id: string;
  customerRef: string;
  advisorId: string;
  stage: string;
  exceptions: Array<{ kind: string; reason: string; active?: boolean }>;
}
export interface TaskView {
  id: string;
  caseId: string;
  title: string;
  ownerId: string;
  dueAt: string;
  state: string;
}
export interface TimelineEventView {
  id: string;
  level: string;
  title: string;
  occurredAt: string;
}
export interface MaterialView {
  id: string;
  personRef: string;
  title: string;
  state: string;
}

export const api = {
  listProjects: () => getJson<{ records: ProjectView[] }>("/v1/catalog/projects"),
  getProject: (id: string) => getJson<ProjectView>(`/v1/catalog/projects/${id}`),
  getFeeSchedule: (id: string) => getJson<FeeScheduleView>(`/v1/catalog/fee-schedules/${id}`),
  getQuestionnaire: () => getJson<Questionnaire>("/v1/assessment/questionnaire"),
  evaluate: (projectCode: string, answers: Record<string, string | number | undefined>) =>
    postJson<EvaluateResponse>("/v1/assessment/evaluate", { projectCode, answers }),
  globalAccessStatus: (key: string) => getJson<GlobalAccessStatus>(`/v1/global-access/${key}/status`),
  listCases: () => getJson<{ records: CaseView[] }>("/v1/cases", true),
  getCase: (id: string) => getJson<CaseView>(`/v1/cases/${id}`, true),
  listTasks: () => getJson<{ records: TaskView[] }>("/v1/tasks/mine", true),
  listTimeline: (caseId: string) => getJson<{ records: TimelineEventView[] }>(`/v1/timeline?caseId=${caseId}`, true),
  listMaterials: (caseId: string) => getJson<{ records: MaterialView[] }>(`/v1/materials?caseId=${caseId}`, true),
  listNotifications: () => getJson<{ records: unknown[] }>("/v1/notifications", true),
  listTickets: () => getJson<{ records: Array<{ id: string; kind: string; title: string; state: string; complaintCategory: string | null; createdAt: string }> }>("/v1/tickets/mine", true),
  createTicket: (body: { kind: string; title: string; description: string }) =>
    postJson<{ id: string }>("/v1/tickets", body, true)
};
