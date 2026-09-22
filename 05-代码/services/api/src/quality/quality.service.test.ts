import { test } from "node:test";
import assert from "node:assert/strict";
import { DataSourceService } from "../globalaccess/data-source.service.js";
import { QualityService } from "./quality.service.js";
import { VerificationService } from "../catalog/verification.service.js";
import { CatalogService } from "../catalog/catalog.service.js";
import { EntityService } from "../entities/entity.service.js";
import { OnboardingService } from "../advisors/onboarding.service.js";
import { AuthorizationService } from "../advisors/authorization.service.js";
import { RuleSetService } from "../assessment/ruleset.service.js";
import { AssessmentTemplateService } from "../assessment/template.service.js";

/** M1 切片 5：Q6 数据源开关门 + 质量基线看板（M1-16/17） */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    assert.equal(body?.code, bizCode, `期望 ${bizCode}，实际 ${body?.code}`);
  }
}

test("Q6：内置数据源强制 off，缺授权要件不能开启；off 时对客只有维护态无数据", () => {
  const ds = new DataSourceService();
  assert.equal(ds.list()[0]!.state, "off");
  expectError(() => ds.configure("visa_passport_data", { state: "on" }), "42280");
  const pub = ds.publicStatus("visa_passport_data");
  assert.equal(pub.available, false);
  assert.ok("pages" in pub && !("countries" in pub));
  // 要件补齐且合同期有效才可开
  ds.configure("visa_passport_data", {
    provider: "示例数据方",
    scope: "visa-requirements,read",
    contractValidUntil: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    refreshCadence: "24h",
    attribution: "© 示例数据方",
    cacheTtlHours: 24,
    state: "on"
  });
  assert.equal(ds.publicStatus("visa_passport_data").available, true);
  // 合同过期后对客回维护态
  ds.configure("visa_passport_data", { contractValidUntil: new Date(Date.now() - 86_400_000).toISOString() });
  assert.equal(ds.publicStatus("visa_passport_data").available, false);
});

test("M1-17 看板：聚合覆盖率/机构/入驻/授权/漏斗；小样本显样本积累中；无成功率字段", () => {
  const vr = new VerificationService();
  const cat = new CatalogService(vr);
  const ent = new EntityService();
  const ob = new OnboardingService(ent);
  const g = new AuthorizationService(ob, ent);
  const tpl = new AssessmentTemplateService();
  const rs = new RuleSetService(vr, cat);
  const q = new QualityService(vr, cat, ent, ob, g, rs);

  const empty = q.dashboard();
  assert.ok(!("successRate" in empty));
  assert.deepEqual(empty.assessmentFunnel.completionRate, { note: "样本积累中", sample: 0 });
  assert.equal(empty.content.verificationCoverage && (empty.content.verificationCoverage as { note?: string }).note, "样本积累中");

  // 发布一个项目（1 条事实）→ 覆盖率 100%
  const fee = cat.createFeeDraft({ code: "F-A", title: "f", body: "", feeItems: [{ code: "p", label: "平台服务费", nature: "platform_service", collector: "境内主体", currency: "CNY", amountMinor: 1n, certainty: "confirmed", timing: "签约时" }] }, "e1");
  cat.submitFee(fee.id, "e1");
  cat.reviewFee(fee.id, "approve", "r2");
  const fact = vr.register({ fact: "条件", factType: "policy", sourceType: "official_url", sourceRef: "https://g.example/x" }, "v3");
  const p = cat.createProjectDraft({ code: "A", title: "项目A", body: "x", keyFactIds: [fact.id], feeScheduleId: fee.id }, "e1");
  cat.submitProjectForVerification(p.id, "e1");
  cat.passVerification(p.id, "v3");
  cat.approvePublication(p.id, "b4");

  const d = q.dashboard();
  const cov = d.content.verificationCoverage as { verified: number; total: number; rate: number };
  assert.equal(cov.total, 1);
  assert.equal(cov.rate, 1);
  assert.equal(d.content.publishedProjects, 1);
  assert.deepEqual(d.prohibited.length, 3);
});
