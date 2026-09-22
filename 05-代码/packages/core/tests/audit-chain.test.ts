import { describe, it, expect } from "vitest";
import { appendAudit, verifyChain, canonicalize, GENESIS_HASH, type AuditRecord, type SyncHashFn } from "../src/audit-chain.js";

/** 测试用确定性哈希（生产环境由 Node/RN 注入 sha256） */
const fakeHash: SyncHashFn = (s) => "h" + String(s.length).padStart(4, "0");

function build(n: number): AuditRecord[] {
  const chain: AuditRecord[] = [];
  for (let i = 0; i < n; i++) {
    chain.push(appendAudit(chain, {
      at: `2026-09-22T0${i}:00:00Z`, actor: `u${i}`, realm: "staff",
      action: "GET /x", resource: "/x", result: i % 2 ? "deny" : "allow"
    }, fakeHash));
  }
  return chain;
}

describe("审计哈希链", () => {
  it("首条记录 seq=1 且 prevHash 为创世哈希", () => {
    const [first] = build(1);
    expect(first!.seq).toBe(1);
    expect(first!.prevHash).toBe(GENESIS_HASH);
  });

  it("完整链校验通过", () => {
    const r = verifyChain(build(10), fakeHash);
    expect(r.ok).toBe(true);
  });

  it("篡改中间记录可被定位", () => {
    const chain = build(5);
    chain[2] = { ...chain[2]!, result: "deny" }; // 原始为 allow
    const r = verifyChain(chain, fakeHash);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.brokenAt).toBe(3);
  });

  it("删除/重排记录造成 prevHash 断链", () => {
    const chain = build(5);
    const removed = chain.filter((_, i) => i !== 2);
    const r = verifyChain(removed, fakeHash);
    expect(r.ok).toBe(false);
  });

  it("规范化输出字段顺序稳定", () => {
    const base = { seq: 1, at: "t", actor: "a", realm: "staff", action: "x", resource: "y", result: "allow" as const, prevHash: GENESIS_HASH };
    expect(canonicalize(base)).toBe(canonicalize({ ...base }));
    expect(canonicalize(base)).toContain('"seq":1');
  });
});
