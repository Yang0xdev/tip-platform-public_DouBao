import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { FolderWatcher, type IngestInput } from "./folder-watcher.service.js";
import { ImapCollector } from "./imap-collector.service.js";

const watchers: FolderWatcher[] = [];

function makeWatcher() {
  const dir = mkdtempSync(join(tmpdir(), "tip-watch-"));
  const got: Array<IngestInput & { actor: string }> = [];
  const w = new FolderWatcher(dir, 60, (actor, input) => got.push({ actor, ...input }));
  watchers.push(w);
  return { dir, got, w };
}

afterEach(() => {
  for (const w of watchers) w.stop();
});

test("文件夹采集：首次扫描只登记不回灌，新增文本文件入库", async () => {
  const { dir, got, w } = makeWatcher();
  writeFileSync(join(dir, "old.txt"), "历史文件内容");
  await w.scan(true);
  assert.equal(got.length, 0);

  writeFileSync(join(dir, "new.md"), "# 新政策\n居住要求：每年7天");
  const n = await w.scan(false);
  assert.equal(n, 1);
  assert.equal(got[0]!.title, "new");
  assert.match(got[0]!.content!, /居住要求/);
  assert.equal(got[0]!.sourceType, "folder");
});

test("文件夹采集：PDF 以 base64 入库，子目录递归", async () => {
  const { dir, got, w } = makeWatcher();
  await w.scan(true);
  mkdirSync(join(dir, "sub"), { recursive: true });
  // 最小合法 PDF 头的占位文件（采集器只负责搬运，解析在 refinery）
  writeFileSync(join(dir, "sub", "scan.pdf"), Buffer.from("%PDF-1.4 fake", "latin1"));
  const n = await w.scan(false);
  assert.equal(n, 1);
  assert.equal(got[0]!.title, "sub/scan");
  assert.ok(got[0]!.base64);
});

test("文件夹采集：入库回调抛错（如去重）不中断本轮扫描", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tip-watch-"));
  let attempts = 0;
  const w = new FolderWatcher(dir, 60, () => {
    attempts += 1;
    throw new Error("409 去重");
  });
  watchers.push(w);
  writeFileSync(join(dir, "a.txt"), "a");
  writeFileSync(join(dir, "b.txt"), "b");
  const n = await w.scan(false);
  // 入库失败不计成功数，但两个文件都被尝试（未中断）
  assert.equal(n, 0);
  assert.equal(attempts, 2);
});

test("邮箱采集：无配置时禁用且 start 不抛错", () => {
  const c = new ImapCollector(null, 300, () => {});
  assert.equal(c.enabled, false);
  assert.doesNotThrow(() => c.start());
  c.stop();
});

test("邮箱采集：配置齐全为启用；不可达主机轮询记录错误但不抛", async () => {
  const c = new ImapCollector(
    {
      host: "127.0.0.1", port: 1, secure: false,
      user: "x", pass: "y", mailbox: "INBOX"
    },
    300,
    () => {}
  );
  assert.equal(c.enabled, true);
  const n = await c.poll();
  assert.equal(n, 0);
  assert.ok(c.lastError);
  c.stop();
});
