/** 顾问端 API（dev 身份头；Keycloak 接入后替换为 OIDC 令牌） */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const API_BASE = env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3100";
const ADVISOR_ID = env.EXPO_PUBLIC_ADVISOR_ID ?? "adv-chen";

const H = {
  "content-type": "application/json",
  "x-tip-realm": "staff",
  "x-tip-user": ADVISOR_ID
};

export const advisorId = ADVISOR_ID;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: H, ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `请求失败 ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ConsultationView {
  id: string;
  customerRef: string;
  source: string;
  projectCode: string | null;
  state: string;
  note: string | null;
  advisorId: string | null;
  createdAt: string;
}

export interface RelationshipView {
  id: string;
  customerRef: string;
  customerEventAt: string | null;
  advisorAcceptedAt: string | null;
  consultationId: string;
}

export interface ProposalView {
  id: string;
  revision: number;
  customerRef: string;
  projectCode: string;
  state: string;
  validUntil: string | null;
  updatedAt: string;
}

export interface FollowView {
  id: string;
  text: string;
  kind: "fact" | "internal";
  createdAt: string;
  correctedOf: string | null;
  correctionNote: string | null;
  corrected: boolean;
}

export interface ClientDetailView {
  customerRef: string;
  tabs: {
    biz: {
      proposals: Array<{ id: string; revision: number; state: string; validUntil: string }>;
      orders: Array<{ id: string; contractState: string; freezeStatus: string | null; readyForCaseAt: string | null }>;
      officialReceipts: string;
    };
    follow: { records: FollowView[] };
    scope: { visible: string[]; notVisible: string[]; originalBatchApply: string };
  };
}

export interface CaseRow {
  id: string;
  customerRef: string;
  advisorId: string;
  stage: string;
  exceptions: Array<{ kind: string; reason: string; active?: boolean }>;
}
export interface TaskRow {
  id: string;
  caseId: string;
  title: string;
  ownerId: string;
  dueAt: string;
  state: string;
}
export interface MaterialRow {
  id: string;
  personRef: string;
  title: string;
  state: string;
}

export const api = {
  queue: (chip: string) =>
    req<{ records: ConsultationView[] }>(`/advisor/engagements/queue?chip=${chip}`),
  clients: () => req<{ records: RelationshipView[] }>("/advisor/clients"),
  accept: (id: string) => req<unknown>(`/advisor/engagements/${id}/accept`, { method: "POST" }),
  proposals: () => req<{ records: ProposalView[] }>("/advisor/proposals/mine"),
  createProposal: (body: unknown) =>
    req<ProposalView>("/advisor/proposals/drafts", { method: "POST", body: JSON.stringify(body) }),
  submitProposal: (id: string) =>
    req<ProposalView>(`/advisor/proposals/${id}/submit`, { method: "POST" }),
  clientDetail: (relationshipId: string) =>
    req<ClientDetailView>(`/advisor/clients/${relationshipId}/detail`),
  addFollow: (customerRef: string, text: string, kind: "fact" | "internal") =>
    req<FollowView>(`/advisor/clients/${customerRef}/follow-ups`, {
      method: "POST",
      body: JSON.stringify({ text, kind })
    }),
  correctFollow: (id: string, text: string, note: string) =>
    req<FollowView>(`/advisor/follow-ups/${id}/correct`, {
      method: "POST",
      body: JSON.stringify({ text, note })
    }),
  cases: () => req<{ records: CaseRow[] }>("/advisor/cases"),
  case: (id: string) => req<CaseRow>(`/advisor/cases/${id}`),
  tasks: () => req<{ records: TaskRow[] }>("/advisor/tasks/mine"),
  materials: (caseId: string) => req<{ records: MaterialRow[] }>(`/advisor/materials?caseId=${caseId}`),
  commissions: () => req<{ records: Array<{ id: string; orderId: string; feeItemCode: string; amountMinor: string; currency: string; state: string; settlementBatchId: string | null }> }>("/advisor/commissions/mine")
};
