import { Injectable, type OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import { appendAudit, verifyChain, type AuditRecord, type SyncHashFn } from "@tip/core";
import { PrismaService } from "./persistence/prisma.service.js";

/**
 * 审计服务
 * - 内存哈希链始终保留（同步计算哈希、供 verify/tail 即时读取）；
 * - 配置 DATABASE_URL 时（M1 切片 8）：启动从 audit_events 重放重建链，
 *   每条记录按序只追加落库；重启后链连续、可校验，断链即拒绝启动。
 * - 无 DATABASE_URL（单测/无 PG 演示）：纯内存链，行为与 M0 一致。
 * 所有越权拒绝必须留痕（前端隐藏不是控制，拒绝必须可审计）。
 */
@Injectable()
export class AuditService implements OnModuleInit {
  private chain: AuditRecord[] = [];
  private writeQueue: Promise<unknown> = Promise.resolve();
  private hydrated = false;
  private readonly sha256: SyncHashFn = (line) => createHash("sha256").update(line, "utf8").digest("hex");

  constructor(private readonly prisma?: PrismaService) {}

  async onModuleInit() {
    if (this.prisma?.enabled) {
      const rows = await this.prisma.db.auditEvent.findMany({ orderBy: { seq: "asc" } });
      this.chain = rows.map((r) => ({
        seq: Number(r.seq),
        at: r.at.toISOString(),
        actor: r.actor,
        realm: r.realm,
        action: r.action,
        resource: r.resource,
        result: r.result,
        reason: r.reason ?? undefined,
        subjectRef: r.subjectRef ?? undefined,
        prevHash: r.prevHash,
        hash: r.hash
      }));
      const v = verifyChain(this.chain, this.sha256);
      if (!v.ok) throw new Error(`审计哈希链重放校验失败：${v.brokenAt ?? "未知位置"}，拒绝启动`);
    }
    this.hydrated = true;
  }

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

    if (this.prisma?.enabled) {
      // 串行写入，保证 seq 与落库顺序一致；写入失败不阻断业务请求，但会在日志暴露并需人工排查
      this.writeQueue = this.writeQueue
        .then(() => this.prisma!.db.auditEvent.create({
          data: {
            seq: BigInt(rec.seq),
            at: new Date(rec.at),
            actor: rec.actor,
            realm: rec.realm as never,
            action: rec.action,
            resource: rec.resource,
            result: rec.result as never,
            reason: rec.reason ?? null,
            subjectRef: rec.subjectRef ?? null,
            prevHash: rec.prevHash,
            hash: rec.hash
          }
        }))
        .catch((e) => console.error("[audit] 落库失败（内存链仍在，需人工排查）：", (e as Error).message));
    }
    return rec;
  }

  /** 等待当前队列中的审计落库完成（集成测试/优雅停机用） */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  isHydrated(): boolean {
    return this.hydrated;
  }

  verify() {
    return verifyChain(this.chain, this.sha256);
  }

  tail(limit = 20): AuditRecord[] {
    return this.chain.slice(-limit);
  }

  /** 按 action（可选 reason）计数，供运营指标使用 */
  countAction(action: string, reason?: string): number {
    return this.chain.filter((r) => r.action === action && (reason === undefined || r.reason === reason)).length;
  }
}
