#!/usr/bin/env node
/**
 * 开发/CI 用嵌入式 PostgreSQL 15（无需 Docker、无需系统 PG）。
 * 数据持久化在 services/api/.embedded-pg（已加入 .gitignore）。
 *
 * 用法：
 *   node scripts/dev-pg.mjs start   # 初始化（首次）并启动，监听 127.0.0.1:55432
 *   node scripts/dev-pg.mjs stop    # 停止
 *   node scripts/dev-pg.mjs status  # 探测是否在运行
 *
 * 连接串：postgresql://tip:tip@127.0.0.1:55432/tip
 * 生产仍使用 infra/docker-compose.yml 的 PG15 与托管数据库；本脚本仅服务本机开发与集成测试。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import EmbeddedPostgres from "embedded-postgres";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = Number(process.env.TIP_PG_PORT ?? 55432);
const DIR = process.env.TIP_PG_DIR ?? join(root, ".embedded-pg");
const PID_FILE = join(tmpdir(), `tip-embedded-pg-${PORT}.pid`);

const pg = new EmbeddedPostgres({
  databaseDir: DIR,
  user: "tip",
  password: "tip",
  port: PORT,
  persistent: true,
  // 开发库关闭 fsync 提速；数据安全由生产托管库与 WORM 审计归档保证
  postgresFlags: ["-c", "fsync=off", "-c", "synchronous_commit=off"]
});

async function start() {
  if (existsSync(PID_FILE)) {
    console.log(`embedded-pg 已在运行（pid=${readFileSync(PID_FILE, "utf8").trim()}），端口 ${PORT}`);
    return;
  }
  if (!existsSync(DIR)) {
    mkdirSync(DIR, { recursive: true });
    await pg.initialise();
  }
  await pg.start();
  const c = pg.getPgClient();
  await c.connect();
  const db = await c.query("select 1 from pg_database where datname='tip'");
  if (db.rowCount === 0) await pg.createDatabase("tip");
  const v = await c.query("select version()");
  await c.end();
  writeFileSync(PID_FILE, String(process.pid));
  console.log(`embedded-pg 已启动：postgresql://tip:tip@127.0.0.1:${PORT}/tip`);
  console.log(v.rows[0].version);
  console.log("按 Ctrl+C 停止（或 node scripts/dev-pg.mjs stop）");
  process.on("SIGINT", async () => {
    await pg.stop().catch(() => {});
    rmSync(PID_FILE, { force: true });
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await pg.stop().catch(() => {});
    rmSync(PID_FILE, { force: true });
    process.exit(0);
  });
}

async function stop() {
  await pg.stop().catch(() => {});
  rmSync(PID_FILE, { force: true });
  console.log("embedded-pg 已停止");
}

async function status() {
  try {
    if (!existsSync(DIR)) {
      console.log("未初始化");
      process.exit(1);
    }
    await pg.start();
    const c = pg.getPgClient();
    await c.connect();
    const r = await c.query("select 1");
    await c.end();
    console.log(r.rowCount === 1 ? `运行中，端口 ${PORT}` : "异常");
    await pg.stop();
  } catch (e) {
    console.log("未运行:", e?.message ?? e);
    process.exit(1);
  }
}

const cmd = process.argv[2] ?? "start";
if (cmd === "start") await start();
else if (cmd === "stop") await stop();
else if (cmd === "status") await status();
else {
  console.error("未知命令：", cmd);
  process.exit(1);
}
