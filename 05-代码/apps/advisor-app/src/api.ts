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

export const api = {
  queue: (chip: string) =>
    req<{ records: ConsultationView[] }>(`/advisor/engagements/queue?chip=${chip}`),
  clients: () => req<{ records: RelationshipView[] }>("/advisor/clients"),
  accept: (id: string) => req<unknown>(`/advisor/engagements/${id}/accept`, { method: "POST" }),
  proposals: () => req<{ records: ProposalView[] }>("/advisor/proposals/mine"),
  createProposal: (body: unknown) =>
    req<ProposalView>("/advisor/proposals/drafts", { method: "POST", body: JSON.stringify(body) }),
  submitProposal: (id: string) =>
    req<ProposalView>(`/advisor/proposals/${id}/submit`, { method: "POST" })
};
