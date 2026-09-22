import { Injectable } from "@nestjs/common";

/**
 * 审计服务（M0 抽象层）
 * M0：结构化日志输出；M1 起替换为哈希链审计写入（audit_events 表 + WORM Object Lock）。
 * 所有越权拒绝必须在此留痕（红线：前端隐藏不是控制，拒绝必须可审计）。
 */
@Injectable()
export class AuditService {
  record(entry: {
    actor: string;
    realm: string;
    action: string;
    resource: string;
    result: "allow" | "deny";
    reason?: string;
    at?: string;
  }): void {
    const line = {
      type: "audit",
      at: entry.at ?? new Date().toISOString(),
      actor: entry.actor,
      realm: entry.realm,
      action: entry.action,
      resource: entry.resource,
      result: entry.result,
      reason: entry.reason ?? null
    };
    // M1 替换为持久化；M0 保证拒绝事件不静默
    console.log(JSON.stringify(line));
  }
}
