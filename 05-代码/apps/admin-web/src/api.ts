/** M0 开发期 API：身份经请求头模拟；M1 替换为 Keycloak JWT（Authorization Bearer） */
export interface Actor {
  user: string;
  realm: "staff" | "service";
}

export const API_ORIGIN = "https://tip-api-niy0.onrender.com";
export async function api<T>(path: string, actor: Actor, init?: RequestInit): Promise<T> {
  const res = await fetch(API_ORIGIN + path, {
    ...init,
    headers: {
      "x-tip-realm": actor.realm,
      "x-tip-user": actor.user,
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `请求失败 ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface MachinesMeta {
  machines: string[];
  states: Record<string, string[]>;
}

export interface AuditVerify {
  ok: boolean;
  count: number;
  brokenAt?: number;
  reason?: string;
}

export interface FeatureFlag {
  key: string;
  state: "off" | "shadow" | "on";
  doorRef: string;
  note: string;
}

export const LS_ACTOR = "tip-admin-actor";
