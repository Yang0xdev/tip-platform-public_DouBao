/** 服务方门户 API：partner 领域；开发期身份经请求头模拟，后续替换为 JWT */

export const API_ORIGIN = "https://tip-api-niy0.onrender.com";

export async function call<T>(login: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_ORIGIN + path, {
    ...init,
    headers: {
      "x-tip-realm": "partner",
      "x-tip-user": login,
      ...(init?.method === "POST" ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败 ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface VisibleCase {
  caseId: string;
  scopes: string[];
  actions: string[];
}

export interface Watermark {
  name: string;
  org: string;
}

export interface ReaderSession {
  id: string;
  startedAt: string;
  presignExpiresAt: string;
}

export interface ReaderOpened {
  session: ReaderSession;
  watermark: Watermark;
}

export interface PdfResult {
  artifactRef: string;
  mark: string;
}
