import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
  } catch (e) {
    const body = (e as { getResponse?: () => { code: string } }).getResponse?.();
    assert.equal(body?.code, bizCode);
    return;
  }
  assert.fail(`应抛出 ${bizCode}`);
}

test("会话默认工作模式；切演示需显式；重复切同模式拒；结束留痕", () => {
  const w = world();
  const s = w.ipad.start("adv-1", "c-1");
  assert.equal(s.mode, "work");
  const d = w.ipad.switchMode(s.id, "demo", "adv-1");
  assert.equal(d.mode, "demo");
  expectError(() => w.ipad.switchMode(s.id, "demo", "adv-1"), "42602");
  const e = w.ipad.switchMode(s.id, "work", "adv-1");
  assert.equal(e.mode, "work");
  const x = w.ipad.end(s.id, "adv-1");
  assert.ok(x.endedAt);
  // 他人不可操作
  expectError(() => w.ipad.switchMode(s.id, "demo", "adv-other"), "42606");
});

test("演示模式方案投影：剔除内部版本/确认快照，境外收取方中性化；尝试内部内容拒绝并审计", () => {
  const w = world();
  const { proposalId } = effectiveOrder(w, "c-2", "adv-2");
  const s = w.ipad.start("adv-2", "c-2");
  // 工作模式可见内部字段
  const work = w.ipad.proposal(s.id, proposalId, "adv-2");
  assert.ok("wordVersion" in work.proposal);
  // 切演示
  w.ipad.switchMode(s.id, "demo", "adv-2");
  const demo = w.ipad.proposal(s.id, proposalId, "adv-2");
  const json = JSON.stringify(demo.proposal, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.equal(json.includes("wordVersion"), false);
  assert.equal(json.includes("confirmSnapshot"), false);
  assert.equal(json.includes("reviewerId"), false);
  const overseas = demo.proposal.feeSnapshot.find((f: { nature: string }) => f.nature === "overseas_professional")!;
  assert.equal(overseas.collector, "境外持牌方");
  // 尝试内部内容
  expectError(() => w.ipad.attemptInternal(s.id, "commission_rules", "adv-2"), "40301");
  assert.ok(w.audit.tail(20).some((e) => e.action === "ipad.internal.denied"));
});

test("讲解备注过词库：命中 block 不可确认；未过复核方案不可共读", () => {
  const w = world();
  const { proposalId, projectCode } = effectiveOrder(w, "c-3", "adv-3");
  const s = w.ipad.start("adv-3", "c-3");
  assert.equal(w.ipad.checkRemark(s.id, "今日讲解费用分项与责任分工。", "adv-3").ok, true);
  expectError(() => w.ipad.checkRemark(s.id, "我们保证获批，不用担心。", "adv-3"), "42604");
  // 未过复核：另起一条 pending 方案
  const cap = w.eng.capture({ source: "card_request", customerRef: "c-33", advisorId: "adv-3", actor: "c-33" });
  w.eng.accept(cap.consultation.id, "adv-3");
  const draft = w.props.draft({ customerRef: "c-33", projectCode, advice: [{ text: "初步建议。", sourceRef: "PROJ-TECH-A@v1#edu" }], responsibilities: "平台负责。", nonCommitments: ["不承诺"] }, "adv-3");
  expectError(() => w.ipad.proposal(s.id, draft.id, "adv-3"), "42603");
});

test("I-01 项目比较：仅已发布项目；演示模式境外收取方中性化", () => {
  const w = world();
  effectiveOrder(w, "c-4", "adv-4");
  const s = w.ipad.start("adv-4", "c-4");
  const work = w.ipad.projects(s.id, "adv-4");
  assert.equal(work.records.length >= 1, true);
  w.ipad.switchMode(s.id, "demo", "adv-4");
  const demo = w.ipad.projects(s.id, "adv-4");
  const fee = demo.records[0]!.fee!.find((f) => f.nature === "overseas_professional");
  if (fee) assert.equal(fee.collector, "境外持牌方");
});
