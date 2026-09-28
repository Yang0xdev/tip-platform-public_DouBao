import { Injectable } from "@nestjs/common";
import { AuditService } from "../audit.service.js";

/**
 * M5-09 邀请灰度门
 *  - doorsOpen=false 期间注册/顾问入驻/服务方开户均须有效邀请；
 *  - 邀请一次性、绑定用途与有效期；使用即核销；
 *  - 影子运行：真实流程但不对外放量；邀请名单由运营登记。
 */

export type InvitePurpose = "customer" | "advisor" | "provider";

export interface Invite {
  id: string;
  token: string;
  purpose: InvitePurpose;
  email: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedBy: string | null;
  createdBy: string;
}

export class InviteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

@Injectable()
export class InviteService {
  private invites = new Map<string, Invite>();
  private seq = 0;

  constructor(private readonly audit: AuditService) {}

  create(
    body: { purpose: InvitePurpose; email?: string; ttlDays?: number },
    actor: string
  ): Invite {
    const ttl = body.ttlDays ?? 30;
    this.seq += 1;
    const inv: Invite = {
      id: `INV-${String(this.seq).padStart(4, "0")}`,
      token: `inv-${Math.random().toString(36).slice(2, 12)}`,
      purpose: body.purpose,
      email: body.email ?? null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttl * 864e5).toISOString(),
      consumedAt: null,
      consumedBy: null,
      createdBy: actor
    };
    this.invites.set(inv.id, inv);
    this.audit.record({ realm: "staff", action: "invite.created", resource: inv.id, result: "info", reason: inv.purpose, actor });
    return inv;
  }

  /** 核销（用途必须匹配、未过期、未使用） */
  consume(token: string, purpose: InvitePurpose, consumerRef: string, nowIso: string): Invite {
    const inv = [...this.invites.values()].find((x) => x.token === token);
    if (!inv) throw new InviteError("44001", "邀请无效");
    if (inv.purpose !== purpose) throw new InviteError("44002", "邀请用途不匹配");
    if (inv.consumedAt) throw new InviteError("44003", "邀请已被使用");
    if (Date.parse(nowIso) > Date.parse(inv.expiresAt))
      throw new InviteError("44004", "邀请已过期");
    inv.consumedAt = nowIso;
    inv.consumedBy = consumerRef;
    this.audit.record({ realm: "staff", action: "invite.consumed", resource: inv.id, result: "allow", actor: consumerRef });
    return inv;
  }

  list(): Invite[] {
    return [...this.invites.values()];
  }
}
