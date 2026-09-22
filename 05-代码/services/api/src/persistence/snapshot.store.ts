import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

/**
 * 聚合投影快照存储（M1 切片 8）。
 * 事件溯源方向下的投影层：同一 (kind, aggregateId) 的每次修订写新版本行（不覆盖历史），
 * 当前态取最大 version。M2 交易聚合起直接采用本存储；M1 内存聚合的逐步迁移在 M2 首个迭代完成。
 */
@Injectable()
export class SnapshotStore {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return this.prisma.enabled;
  }

  async save(
    kind: string,
    aggregateId: string,
    version: number,
    state: string,
    snapshot: Prisma.InputJsonValue,
    createdBy?: string
  ): Promise<void> {
    if (!this.prisma.enabled) return;
    await this.prisma.db.aggregateSnapshot.upsert({
      where: { kind_aggregateId_version: { kind, aggregateId, version } },
      create: { kind, aggregateId, version, state, snapshot, createdBy: createdBy ?? null },
      update: { state, snapshot, createdBy: createdBy ?? null }
    });
  }

  async latest<T = unknown>(kind: string, aggregateId: string): Promise<{ version: number; state: string; snapshot: T } | null> {
    if (!this.prisma.enabled) return null;
    const row = await this.prisma.db.aggregateSnapshot.findFirst({
      where: { kind, aggregateId },
      orderBy: { version: "desc" }
    });
    return row ? { version: row.version, state: row.state, snapshot: row.snapshot as T } : null;
  }

  async listLatest<T = unknown>(kind: string): Promise<Array<{ aggregateId: string; version: number; state: string; snapshot: T }>> {
    if (!this.prisma.enabled) return [];
    const rows = await this.prisma.db.$queryRaw<Array<{ aggregate_id: string; version: number; state: string; snapshot: T }>>`
      SELECT DISTINCT ON (aggregate_id) aggregate_id, version, state, snapshot
      FROM aggregate_snapshots
      WHERE kind = ${kind}
      ORDER BY aggregate_id, version DESC
    `;
    return rows.map((r) => ({ aggregateId: r.aggregate_id, version: Number(r.version), state: r.state, snapshot: r.snapshot }));
  }
}
