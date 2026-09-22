/**
 * 审计哈希链（技术方案 §5/§8、PRD-M5 M5-01）
 *
 * 每条审计记录包含前一条记录的哈希，形成只追加链；
 * 任一历史记录被篡改，verifyChain 立即定位断点。
 * 内核不绑定 Node/RN 的哈希实现：HashFn 由宿主注入
 * （Node 用 node:crypto sha256，RN 用 expo-crypto/webcrypto 适配）。
 */

export interface AuditEntryData {
  /** 事件时间 ISO 字符串 */
  at: string;
  actor: string;
  realm: string;
  action: string;
  resource: string;
  result: "allow" | "deny" | "info";
  reason?: string;
  /** 关联业务对象（订单号/案件号等），不含 L3 原文 */
  subjectRef?: string;
}

export interface AuditRecord extends AuditEntryData {
  seq: number;
  prevHash: string;
  hash: string;
}

export type SyncHashFn = (canonicalLine: string) => string;

export const GENESIS_HASH = "0".repeat(64);

/** 规范化：字段固定顺序、键排序，保证不同机器算出同一哈希 */
export function canonicalize(rec: Omit<AuditRecord, "hash">): string {
  const ordered = {
    seq: rec.seq,
    at: rec.at,
    actor: rec.actor,
    realm: rec.realm,
    action: rec.action,
    resource: rec.resource,
    result: rec.result,
    reason: rec.reason ?? null,
    subjectRef: rec.subjectRef ?? null,
    prevHash: rec.prevHash
  };
  return JSON.stringify(ordered);
}

/** 在链尾追加一条记录（只追加；不提供修改/删除 API） */
export function appendAudit(chain: readonly AuditRecord[], data: AuditEntryData, hash: SyncHashFn): AuditRecord {
  const seq = chain.length === 0 ? 1 : chain[chain.length - 1]!.seq + 1;
  const prevHash = chain.length === 0 ? GENESIS_HASH : chain[chain.length - 1]!.hash;
  const base = { ...data, seq, prevHash };
  const rec: AuditRecord = { ...base, hash: hash(canonicalize(base)) };
  return rec;
}

export type ChainVerification =
  | { ok: true; count: number }
  | { ok: false; brokenAt: number; reason: string };

/** 校验整条链：哈希自洽 + seq 连续 + 起点正确 */
export function verifyChain(chain: readonly AuditRecord[], hash: SyncHashFn): ChainVerification {
  let prev = GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const rec = chain[i]!;
    const expectedSeq = i + 1;
    if (rec.seq !== expectedSeq) return { ok: false, brokenAt: rec.seq, reason: `seq 不连续：期望 ${expectedSeq}，实际 ${rec.seq}` };
    if (rec.prevHash !== prev) return { ok: false, brokenAt: rec.seq, reason: "prevHash 断链（可能被重排或删除）" };
    const { hash: actual, ...base } = rec;
    if (hash(canonicalize(base)) !== actual) return { ok: false, brokenAt: rec.seq, reason: "记录内容哈希不匹配（可能被篡改）" };
    prev = rec.hash;
  }
  return { ok: true, count: chain.length };
}
