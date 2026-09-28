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

import { COMMITMENT_KEYS } from "../advisors/onboarding.service.js";

/** 入驻 + 授权第二名顾问（同一项目） */
function authorizeSecond(w: ReturnType<typeof world>, advisorId: string, projectCode: string) {
  const ent = w.ent.list()[0]!;
  const d = w.ob.createDraft(
    { phone: `139${Math.floor(Math.random() * 1e8)}`, entityId: ent.id, realName: "新顾问", materialRefs: ["m1"], selfIntro: "x", title: "顾问", yearsOfPractice: 5, filingNo: "BJ-2026-020" },
    advisorId
  );
  for (const k of COMMITMENT_KEYS) w.ob.signCommitment(d.id, k, advisorId);
  w.ob.confirmTraining(d.id, advisorId);
  w.ob.submit(d.id, advisorId);
  w.ob.approve(d.id, "admin2");
  w.grants.start(advisorId, projectCode);
  for (const m of ["project_rules", "banned_words", "fee_script"] as const)
    w.grants.confirmMaterial(advisorId, projectCode, m);
  w.grants.submit(advisorId, projectCode, 500);
  w.grants.approve("admin2", advisorId, projectCode);
}

test("发起门：顾问自行转客户拒绝；强制交接双人复核；缺原因拒绝", () => {
  const w = world();
  const { projectCode } = effectiveOrder(w, "c-ho", "adv-ho");
  const rel = w.eng.listRelationships("c-ho")[0]!;
  expectError(
    () => w.handovers.start({ relationshipId: rel.id, reason: "我要转走" }, "adv-ho", "staff"),
    "43304"
  );
  expectError(
    () =>
      w.handovers.start(
        { relationshipId: rel.id, reason: "调查", forced: true, reviewers: ["r1"] },
        "admin",
        "staff"
      ),
    "43302"
  );
  // 合规强制：双人复核
  w.handovers.start(
    { relationshipId: rel.id, reason: "调查暂停", forced: true, reviewers: ["r1", "r2"] },
    "admin",
    "staff"
  );
});

test("五步全流程：客户发起→冻结停新（新方案被接口拒绝）→清单→新顾问接受→切换通知", () => {
  const w = world();
  const ref = "c-ho2";
  const oldAdvisor = "adv-old";
  const newAdvisor = "adv-new";
  const { projectCode } = effectiveOrder(w, ref, oldAdvisor);
  authorizeSecond(w, newAdvisor, projectCode);
  const rel = w.eng.listRelationships(ref)[0]!;

  // 步骤1 客户发起
  const h = w.handovers.start(
    { relationshipId: rel.id, toAdvisorId: newAdvisor, reason: "希望换顾问" },
    ref,
    "customer"
  );
  // 跳步拒绝
  expectError(() => w.handovers.checklist(h.id, "admin"), "43303");
  // 步骤2 冻结
  w.handovers.freeze(h.id, "admin");
  // 停新：冻结期发起新方案/订单接口级拒绝（42121）
  expectError(() => w.eng.assertWritable(ref, oldAdvisor), "42121");
  // 步骤3 清单
  w.handovers.checklist(h.id, "admin");
  // 步骤4 新顾问本人接受；他人代接受拒
  expectError(() => w.handovers.accept(h.id, newAdvisor, "someone"), "43304");
  w.handovers.accept(h.id, newAdvisor, newAdvisor);
  // 步骤5 完成切换
  w.handovers.complete(h.id, "admin");
  const after = w.eng.listRelationships(ref)[0]!;
  assert.equal(after.state, "active");
  assert.equal(after.advisorId, newAdvisor);
  // 新顾问可写，旧顾问不可写
  w.eng.assertWritable(ref, newAdvisor);
  expectError(() => w.eng.assertWritable(ref, oldAdvisor), "42120");
});

test("五步未齐不可切换；完成前旧顾问担在办责任（冻结态旧顾问仍只读可见在办）", () => {
  const w = world();
  const ref = "c-ho3";
  const { order, projectCode } = effectiveOrder(w, ref, "adv-o3");
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  authorizeSecond(w, "adv-n3", projectCode);
  const rel = w.eng.listRelationships(ref)[0]!;
  const h = w.handovers.start({ relationshipId: rel.id, reason: "离职" }, ref, "customer");
  w.handovers.freeze(h.id, "admin");
  expectError(() => w.handovers.complete(h.id, "admin"), "43303");
  // 在办案件对旧顾问只读可见（案件列表不按顾问关系隐藏）
  assert.equal(w.cases.list().some((c) => c.customerRef === ref), true);
});
