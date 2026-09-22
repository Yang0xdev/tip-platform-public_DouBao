import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { appendAudit, verifyChain, type AuditRecord, type SyncHashFn } from "@tip/core";

/**
 * 审计服务（M0 内存链实现）
 * - M0：进程内哈希链 + 结构化输出，证明防篡改机制；
 * - M1：替换为 audit_events 表（只追加）+ WORM Object Lock，每日定时 verifyChain 校验、断链告警。
 * 所有越权拒绝必须留痕（前端隐藏不是控制，拒绝必须可审计）。
 */
@Injectable()
export class AuditService {
  private chain: AuditRecord[] = [];
  private readonly sha256: SyncHashFn = (line) => createHash("sha256").update(line, "utf8").digest("hex");

  record(entry: {
    actor: string;
    realm: string;
    action: string;
    resource: string;
    result: "allow" | "deny" | "info";
    reason?: string;
    subjectRef?: string;
    at?: string;
  }): AuditRecord {
    const rec = appendAudit(this.chain, {
      at: entry.at ?? new Date().toISOString(),
      actor: entry.actor,
      realm: entry.realm,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      reason: entry.reason,
      subjectRef: entry.subjectRef
    }, this.sha256);
    this.chain.push(rec);
    console.log(JSON.stringify({ type: "audit", ...rec }));
    return rec;
  }

  verify() {
    return verifyChain(this.chain, this.sha256);
  }

  tail(limit = 20): AuditRecord[] {
    return this.chain.slice(-limit);
  }
}
