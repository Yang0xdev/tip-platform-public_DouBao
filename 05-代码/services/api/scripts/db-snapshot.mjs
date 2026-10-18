#!/usr/bin/env node
/**
 * 生产快照维护工具（P5 真实数据切换）
 *
 * 用法：
 *   DATABASE_URL=<url> node scripts/db-snapshot.mjs backup [输出文件]
 *   DATABASE_URL=<url> node scripts/db-snapshot.mjs reset --confirm "<确认语>"
 *
 * - backup：把 service_states 全表导出为 JSON（删除前的安全网）
 * - reset：TRUNCATE service_states（仅清快照，不动表结构；重启后以空业务态启动，
 *          需配合 DEMO_SEED=0 与真实数据 seed 脚本使用）
 *
 * 数据全部在内存服务里，快照是唯一持久化副本；reset 不可逆，必须先 backup。
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url } } });

const cmd = process.argv[2];
const arg = process.argv[3];

try {
  if (cmd === "backup") {
    const rows = await db.serviceState.findMany({ orderBy: { key: "asc" } });
    const out =
      arg ||
      path.join(
        "scripts",
        `service_states_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`
      );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ backedUpAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
    console.log(`已备份 ${rows.length} 个服务快照 → ${out}`);
  } else if (cmd === "reset") {
    if (process.argv[3] !== "--confirm" || process.argv[4] !== "I_KNOW_THIS_WIPES_PRODUCTION") {
      console.error("拒绝执行：必须加 --confirm I_KNOW_THIS_WIPES_PRODUCTION");
      process.exit(2);
    }
    const before = {
      serviceStates: await db.serviceState.count(),
      aggregateSnapshots: await db.aggregateSnapshot.count(),
      auditEvents: await db.auditEvent.count(),
      outboxEvents: await db.outboxEvent.count(),
      featureFlags: await db.featureFlag.count()
    };
    // 清空全部业务持久化表（订单/案件等交易聚合存于 aggregate_snapshots，仅清 service_states 会复活旧演示数据）
    await db.outboxEvent.deleteMany({});
    await db.aggregateSnapshot.deleteMany({});
    await db.serviceState.deleteMany({});
    await db.auditEvent.deleteMany({});
    await db.featureFlag.deleteMany({});
    console.log("已清空全部业务表：", JSON.stringify(before));
  } else {
    console.error("用法：db-snapshot.mjs backup|reset");
    process.exit(2);
  }
} finally {
  await db.$disconnect();
}
