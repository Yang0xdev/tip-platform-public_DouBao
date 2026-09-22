import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditService } from "../audit.service.js";
import { EngagementService } from "./engagement.service.js";

/** M2-01/02：咨询捕获、分配队列、关系双向确认、冲突锁定、越权拒绝 */

function expectError(fn: () => unknown, bizCode: string) {
  try {
    fn();
    assert.fail("应当抛错");
  } catch (e) {
    const body = (e as { getResponse?: () => unknown }).getResponse?.() as { code?: string } | undefined;
    assert.equal(body?.code, bizCode, `期望 ${bizCode}，实际 ${body?.code}：${(e as Error).message}`);
  }
}

function svc() {
  return new EngagementService(new AuditService());
}

test("预约沟通只产生咨询，不成立关系、不授权问卷", () => {
  const s = svc();
  const { consultation, relationship } = s.capture({ source: "card_appointment", customerRef: "c-1", actor: "c-1" });
  assert.equal(consultation.state, "pending_assign");
  assert.equal(relationship, null);
  assert.equal(consultation.questionnaireGranted, false);
});

test("分享链接落地不自动成立关系", () => {
  const s = svc();
  const { relationship } = s.capture({ source: "share_link", customerRef: "c-2", actor: "c-2" });
  assert.equal(relationship, null);
});

test("指定顾问请求服务：客户发起+顾问接受双向确认后 active", () => {
  const s = svc();
  const { consultation } = s.capture({ source: "card_request", customerRef: "c-3", advisorId: "a-1", actor: "c-3" });
  assert.equal(consultation.state, "pending_accept");
  const { relationship } = s.accept(consultation.id, "a-1");
  assert.equal(relationship.state, "active");
  assert.ok(relationship.customerEventAt);
  assert.ok(relationship.advisorAcceptedAt);
});

test("平台分配：顾问在客户确认前接受被拒（双向确认门）", () => {
  const s = svc();
  const { consultation } = s.capture({ source: "manual", customerRef: "c-4", actor: "staff-1" });
  s.assign(consultation.id, "a-2", "staff-1");
  expectError(() => s.accept(consultation.id, "a-2"), "42108");
  s.confirmAssignment(consultation.id, "c-4");
  const { relationship } = s.accept(consultation.id, "a-2");
  assert.equal(relationship.state, "active");
});

test("客户可在顾问接受前撤回；撤回后关系不成立", () => {
  const s = svc();
  const { consultation } = s.capture({ source: "card_request", customerRef: "c-5", advisorId: "a-3", actor: "c-5" });
  s.withdraw(consultation.id, "c-5");
  const after = s["getConsultation"](consultation.id);
  assert.equal(after.state, "closed");
  expectError(() => s.accept(consultation.id, "a-3"), "42107");
});

test("转分配必填原因；转后回队列，可重新分配", () => {
  const s = svc();
  const { consultation } = s.capture({ source: "card_request", customerRef: "c-6", advisorId: "a-4", actor: "c-6" });
  expectError(() => s.reassign(consultation.id, "a-4", ""), "42109");
  s.reassign(consultation.id, "a-4", "专业不匹配");
  assert.equal(s["getConsultation"](consultation.id).state, "reassigned");
  s.assign(consultation.id, "a-5", "staff-1");
  s.confirmAssignment(consultation.id, "c-6");
  assert.equal(s.accept(consultation.id, "a-5").relationship.state, "active");
});

test("重复线索（同证件哈希、不同渠道客户标识）进冲突队列，裁决前锁方案/订单", () => {
  const s = svc();
  const first = s.capture({ source: "card_request", customerRef: "c-7", advisorId: "a-6", duplicateKey: "hash-xyz", actor: "c-7" });
  s.accept(first.consultation.id, "a-6");
  const dup = s.capture({ source: "manual", customerRef: "c-7-dup", advisorId: "a-7", duplicateKey: "hash-xyz", actor: "staff-1" });
  assert.equal(dup.consultation.state, "conflict_pending");
  expectError(() => s.assertWritable("c-7-dup", "a-7"), "42118");
  s.resolveConflict(dup.consultation.id, "staff-1", "a-6", "裁决与既有关系归并");
  assert.equal(s["getConsultation"](dup.consultation.id).state, "pending_accept");
});

test("一名客户仅一名主责：向第二位顾问请求服务被拒", () => {
  const s = svc();
  const r1 = s.capture({ source: "card_request", customerRef: "c-8", advisorId: "a-8", actor: "c-8" });
  s.accept(r1.consultation.id, "a-8");
  expectError(
    () => s.capture({ source: "assessment_explain", customerRef: "c-8", advisorId: "a-9", actor: "c-8" }),
    "42102"
  );
  // assertWritable 只认主责顾问（关系存在但顾问不匹配 → 42120）
  expectError(() => s.assertWritable("c-8", "a-9"), "42120");
  assert.equal(s.assertWritable("c-8", "a-8").state, "active");
});

test("顾问只能看自己的客户：越权查看 403", () => {
  const s = svc();
  const r = s.capture({ source: "card_request", customerRef: "c-9", advisorId: "a-10", actor: "c-9" });
  s.accept(r.consultation.id, "a-10");
  const rels = s.adminListRelationships();
  const relId = rels[rels.length - 1]!.id;
  expectError(() => s.advisorClientView("a-11", relId), "42117");
  assert.equal(s.advisorClientView("a-10", relId).relationship.state, "active");
});

test("顾问队列不返回他人咨询；chips 过滤生效", () => {
  const s = svc();
  const mine = s.capture({ source: "card_request", customerRef: "c-10", advisorId: "a-12", actor: "c-10" });
  s.capture({ source: "card_request", customerRef: "c-11", advisorId: "a-13", actor: "c-11" });
  const q = s.advisorQueue("a-12", "pending_accept");
  assert.deepEqual(q.map((x) => x.id), [mine.consultation.id]);
});

test("问卷解读授权默认关闭，可授予也可撤回，与关系状态解耦", () => {
  const s = svc();
  const { consultation } = s.capture({ source: "assessment_explain", customerRef: "c-12", advisorId: "a-14", actor: "c-12" });
  assert.equal(consultation.questionnaireGranted, false);
  s.setQuestionnaireGrant(consultation.id, "c-12", true);
  assert.equal(s["getConsultation"](consultation.id).questionnaireGranted, true);
  s.setQuestionnaireGrant(consultation.id, "c-12", false);
  assert.equal(s["getConsultation"](consultation.id).questionnaireGranted, false);
});
