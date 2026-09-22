import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogService, CatalogError, type DraftInput } from "./catalog.service.js";

/** M1 内容目录服务测试（PRD-M1：M1-02/04/05/06；AT01/AT02 发布四眼、词库闸门） */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    assert.ok(e instanceof CatalogError, `应为 CatalogError，实际 ${(e as Error).constructor.name}`);
    assert.equal((e as CatalogError).bizCode, bizCode);
  }
}

test("项目版本四眼发布：同人复核被拒，异人员工通过后才对客可见", () => {
  const svc = new CatalogService();
  const draft: DraftInput = { code: "A-TECH", title: "A国技术居留项目", body: "透明收费、阶段可核验。" };
  const d = svc.createDraft("project", draft, "editor-1");
  assert.equal(d.state, "draft");

  svc.submit(d.id, "editor-1");
  // 编制人自己复核 → 拒绝
  expectError(() => svc.review(d.id, "approve", "editor-1", true), "REVIEWER_IS_AUTHOR");
  // 草稿/在审版本不对客可见
  assert.equal(svc.listPublished("project").length, 0);

  const published = svc.review(d.id, "approve", "reviewer-2", true);
  assert.equal(published.state, "published");
  assert.equal(svc.listPublished("project").length, 1);
  assert.equal(svc.getPublished(d.id).reviewerId, "reviewer-2");
});

test("禁用词在素材生产点拦截，不能进发布流程", () => {
  const svc = new CatalogService();
  expectError(
    () => svc.createDraft("project", { code: "X1", title: "投资居留", body: "我们包过，100%成功" }, "editor-1"),
    "42201"
  );
});

test("警示词允许起草，但通过复核需显式知情确认", () => {
  const svc = new CatalogService();
  const d = svc.createDraft("project", { code: "X2", title: "最快通道项目", body: "材料清单透明" }, "editor-1");
  assert.ok(d.warnings.length > 0);
  svc.submit(d.id, "editor-1");
  expectError(() => svc.review(d.id, "approve", "reviewer-2", false), "42202");
  assert.equal(svc.review(d.id, "approve", "reviewer-2", true).state, "published");
});

test("收费方案：tbc 不得填金额；多币种合法且无总价", () => {
  const svc = new CatalogService();
  expectError(
    () =>
      svc.createDraft(
        "fee_schedule",
        {
          code: "F-A-TECH",
          title: "A国技术居留收费 v1",
          body: "分项列明",
          feeItems: [
            { code: "official_fee", label: "官方申请费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52500n, certainty: "confirmed", timing: "递交时" },
            { code: "unknown_fee", label: "待补费用", nature: "third_party", collector: null, currency: null, amountMinor: 100n, certainty: "tbc", timing: "待定" }
          ]
        },
        "editor-1"
      ),
    "MONEY_TBC_HAS_AMOUNT"
  );

  const ok = svc.createDraft(
    "fee_schedule",
    {
      code: "F-A-TECH2",
      title: "A国技术居留收费 v2",
      body: "分项列明，异币种不合计",
      feeItems: [
        { code: "platform_fee", label: "平台服务费", nature: "platform_service", collector: "示例出入境咨询（北京）有限公司", currency: "CNY", amountMinor: 8800000n, certainty: "confirmed", timing: "签约时" },
        { code: "official_fee", label: "官方申请费", nature: "official", collector: "A国官方", currency: "USD", amountMinor: 52500n, certainty: "estimated", timing: "递交时" }
      ]
    },
    "editor-1"
  );
  assert.equal(ok.feeItems.length, 2);
  assert.equal("total" in ok, false);
  const view = JSON.stringify(ok.feeItems.map((f) => ({ ...f, amountMinor: f.amountMinor?.toString() })));
  assert.ok(view.includes("8800000"));
});

test("非法状态迁移被白名单拒绝；驳回后修订必须重走四眼", () => {
  const svc = new CatalogService();
  const d = svc.createDraft("project", { code: "Y1", title: "项目Y", body: "正文" }, "editor-1");
  expectError(() => svc.review(d.id, "approve", "reviewer-2", true), "40901");

  svc.submit(d.id, "editor-1");
  svc.review(d.id, "reject", "reviewer-2", true);
  const revised = svc.revise(d.id, "editor-1");
  assert.equal(revised.state, "draft");
  assert.equal(revised.reviewerId, null);
});

test("下架（suspend）后对客不可见", () => {
  const svc = new CatalogService();
  const d = svc.createDraft("project", { code: "Z1", title: "项目Z", body: "正文" }, "editor-1");
  svc.submit(d.id, "editor-1");
  svc.review(d.id, "approve", "reviewer-2", true);
  assert.equal(svc.listPublished("project").length, 1);
  svc.review(d.id, "suspend", "reviewer-2", true);
  assert.equal(svc.listPublished("project").length, 0);
});
