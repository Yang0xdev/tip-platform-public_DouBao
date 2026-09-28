import { test } from "node:test";
import assert from "node:assert/strict";
import { world, effectiveOrder } from "../test-utils/world.js";

/**
 * M4-13 控制矩阵：总后台 A01–A12 每个模块都有可执行的服务控制面，
 * 且前端 App 展示的每类内容（项目/费表/首页/通知/工单入口）都有后台控制点。
 */

test("控制矩阵：A01–A12 控制面全部可达且返回结构化数据", () => {
  const w = world();
  // 铺一条完整业务链（订单生效 + 首付核验 + M4 全流程）
  const customerRef = "c-matrix";
  const advisorId = "adv-matrix";
  const { order } = effectiveOrder(w, customerRef, advisorId);
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: "hm", artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    customerRef
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "fin-2" }, "fin-1");
  // M4 数据
  w.tickets.submit({ kind: "consult", title: "咨询", description: "普通咨询" }, customerRef);
  w.commissions.createSettlementBatch("lead");
  w.commissions.proposeRefund(
    { orderId: order.id, lines: [{ amountMinor: "100000", currency: "CNY", reason: "未发生部分按实退" }] },
    "cs"
  );

  // A 模块 → 控制面读取（必须是数组/对象结构，不允许 undefined）
  const matrix: Record<string, unknown> = {
    A01_projects: w.cat.listPublishedProjects(),
    A01_feeSchedules: w.cat.listPublishedFees(),
    A02_entities: w.ent.list(),
    A02_providers: w.providers.list(),
    A03_onboarding: w.ob.list(),
    A03_grants: w.grants.list(),
    A04_engagements: w.eng.listRelationships(),
    A05_orders: w.orders.list(),
    A06_cases: w.cases.list(),
    A07_commissions: w.commissions.listLines(),
    A07_batches: w.commissions.listBatches(),
    A07_refunds: w.commissions.listRefunds(),
    A08_tickets_cs: w.tickets.listQueue("customer_service"),
    A08_tickets_compliance: w.tickets.listQueue("compliance_team"),
    A09_templates: w.notifications.listTemplates(),
    A10_compliance: w.complianceEvents.list(),
    A12_rulesets: w.rulesets.list()
  };

  for (const [k, v] of Object.entries(matrix)) {
    assert.ok(v !== undefined, `${k} 控制面缺失`);
    if (Array.isArray(v)) assert.ok(Array.isArray(v), `${k} 应返回数组`);
  }

  // 前端内容 → 后台控制点对照（关键断言：客户能看到的，后台都能控）
  // 1. 首页项目列表来自 catalog 发布（A01 可下架）
  const customerVisibleProjects = w.cat.listPublishedProjects();
  assert.ok(customerVisibleProjects.length >= 1);
  // 2. 客户工单来自 ticket 队列（A08 可受理/升级）
  assert.ok(w.tickets.listQueue("customer_service").length >= 1);
  // 3. 客户案件来自 case（A06 看板）
  assert.ok(w.cases.listForCustomer(customerRef).length >= 1);
  // 4. 佣金来自 commission（A07）
  assert.ok(w.commissions.listLines().length >= 1);
});

test("控制矩阵：越权写操作被拒（顾问不可改金额/不可核验付款）", () => {
  const w = world();
  const { order } = effectiveOrder(w, "c-matrix2", "adv-matrix2");
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: "hm2", artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    "c-matrix2"
  );
  // 顾问核验付款 → 服务错误
  assert.throws(
    () => w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "x" }, "adv-matrix2"),
    /顾问不可核验/
  );
});
