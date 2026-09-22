import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { AuditService } from "../audit.service.js";
import { PrismaService } from "./prisma.service.js";
import { SnapshotStore } from "./snapshot.store.js";

/**
 * M1 切片 8 集成测试：真实 PostgreSQL（embedded-postgres 15 / docker PG15 均可）。
 * 默认跳过；运行方式见 package.json test:pg（先 migrate deploy）。
 * 验证：审计哈希链落库后跨“重启”连续可校验；聚合快照版本化读写。
 */
const url = process.env.DATABASE_URL;
const enabled = process.env.TIP_TEST_PG === "1" && Boolean(url);

let db: PrismaClient;

before(async () => {
  if (!enabled) return;
  db = new PrismaClient({ datasources: { db: { url } } });
  await db.$executeRawUnsafe("TRUNCATE audit_events, aggregate_snapshots RESTART IDENTITY CASCADE");
});

function prismaStub(client: PrismaClient): PrismaService {
  return { enabled: true, db: client } as unknown as PrismaService;
}

test("审计链落库并在重启后重放连续（seq 接续、verify 通过）", { skip: !enabled }, async () => {
  // 第一次“启动”
  const a1 = new AuditService(prismaStub(db));
  await a1.onModuleInit();
  a1.record({ actor: "s-author", realm: "staff", action: "project.submit", resource: "PRJ-T1", result: "allow" });
  a1.record({ actor: "s-verifier", realm: "staff", action: "project.approve", resource: "PRJ-T1", result: "allow" });
  await a1.flush();
  assert.equal(a1.verify().ok, true);
  const tail1 = a1.tail(10);
  assert.equal(tail1.length, 2);

  // “重启”：新实例从 audit_events 重放
  const a2 = new AuditService(prismaStub(db));
  await a2.onModuleInit();
  assert.equal(a2.verify().ok, true);
  const tail2 = a2.tail(10);
  assert.deepEqual(
    tail2.map((r) => ({ seq: r.seq, hash: r.hash })),
    tail1.map((r) => ({ seq: r.seq, hash: r.hash }))
  );

  // seq 接续，不重复主键
  const rec = a2.record({ actor: "s-publisher", realm: "staff", action: "project.publish", resource: "PRJ-T1", result: "allow" });
  await a2.flush();
  assert.equal(rec.seq, 3);
  assert.equal(a2.verify().ok, true);

  const count = await db.auditEvent.count();
  assert.equal(count, 3);
  await db.$disconnect();
});

test("聚合快照：同 id 多版本保留历史，latest/listLatest 取当前态", { skip: !enabled }, async () => {
  const d = new PrismaClient({ datasources: { db: { url } } });
  const store = new SnapshotStore(prismaStub(d));
  await store.save("project_version", "PRJ-S1", 1, "draft", { title: "旧版" }, "s-author");
  await store.save("project_version", "PRJ-S1", 2, "published", { title: "新版" }, "s-publisher");
  await store.save("project_version", "PRJ-S2", 1, "draft", { title: "另一项目" }, "s-author");

  const latest = await store.latest<{ title: string }>("project_version", "PRJ-S1");
  assert.equal(latest?.version, 2);
  assert.equal(latest?.state, "published");
  assert.equal(latest?.snapshot.title, "新版");

  const all = await store.listLatest<{ title: string }>("project_version");
  assert.equal(all.length, 2);
  const s1 = all.find((x) => x.aggregateId === "PRJ-S1");
  assert.equal(s1?.version, 2);

  // 历史版本行未被覆盖
  const rows = await d.aggregateSnapshot.findMany({ where: { kind: "project_version", aggregateId: "PRJ-S1" } });
  assert.equal(rows.length, 2);
  await d.$disconnect();
});

test("未配置 DATABASE_URL 时 SnapshotStore 静默降级（内存模式）", async () => {
  const off = { enabled: false } as unknown as PrismaService;
  const store = new SnapshotStore(off);
  assert.equal(store.enabled, false);
  assert.equal(await store.latest("x", "y"), null);
  assert.deepEqual(await store.listLatest("x"), []);
});
