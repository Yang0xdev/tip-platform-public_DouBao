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

function setup() {
  const w = world();
  const ref = "c-nt";
  const { order } = effectiveOrder(w, ref, "adv-nt");
  w.payments.uploadVoucher(
    order.id,
    { installmentSeq: 1, fileHash: `h-${order.id}`, artifactRef: "L3://v.jpg", amountMinor: "8800000", currency: "CNY" },
    ref
  );
  w.payments.verify(order.id, { installmentSeq: 1, decision: "verified", secondVerifierId: "f2" }, "f1");
  const c = w.cases.list().find((x) => x.orderId === order.id)!;
  w.materials.generateChecklist(c.id, "cw");
  return { w, c, ref };
}

/** 走完整四眼发布一个 T0 模板 */
function publishT0Template(w: ReturnType<typeof world>, code: string, author = "tpl-author") {
  const t = w.notifications.createTemplate(
    {
      code,
      category: "t0",
      title: "请补充办理材料",
      body: "请在时限内上传补件",
      safeSummary: "您有一条新的办理提醒",
      channels: ["app", "sms", "email"],
      authorId: author
    },
    author
  );
  w.notifications.submitTemplate(t.id, author);
  w.notifications.reviewTemplate(t.id, "published", "tpl-reviewer");
  return w.notifications.listTemplates().find((x) => x.id === t.id)!;
}

test("模板四眼：非编制人提交/编制人自审拒绝；发布后才可用", () => {
  const { w } = setup();
  const t = w.notifications.createTemplate(
    {
      code: "x",
      category: "general",
      title: "T",
      body: "B",
      safeSummary: "通知",
      channels: ["app"],
      authorId: "a1"
    },
    "a1"
  );
  expectError(() => w.notifications.submitTemplate(t.id, "a2"), "43102");
  w.notifications.submitTemplate(t.id, "a1");
  expectError(() => w.notifications.reviewTemplate(t.id, "published", "a1"), "43104");
  w.notifications.reviewTemplate(t.id, "published", "a2");
  assert.equal(w.notifications.listTemplates().find((x) => x.id === t.id)!.state, "published");
});

test("T0 任务自动触发通知：材料退回即产生 App 送达记录；模板缺失只登记运营缺口不崩溃", () => {
  const { w, c, ref } = setup();
  // 先上传护照
  w.materials.upload(
    c.id,
    ref,
    "passport",
    { fileHash: "h1", artifactRef: "L3://p.jpg", mime: "image/jpeg", sizeBytes: 1_000_000 },
    ref
  );
  // 无模板时退回：不抛错，登记 missing
  const m = w.materials.listForCase(c.id).find((x) => x.itemCode === "passport")!;
  w.materials.review(m.id, "return", { reason: "r", requirement: "q", deadlineAt: "2026-10-05T00:00:00Z" }, "staff-1");
  assert.equal(
    w.audit.tail(200).some((a) => a.action === "notification.template.missing"),
    true
  );
  // 发布模板后再次退回 → 自动送达
  publishT0Template(w, "material_supplement");
  w.materials.upload(
    c.id,
    ref,
    "passport",
    { fileHash: "h2", artifactRef: "L3://p2.jpg", mime: "image/jpeg", sizeBytes: 1_000_000 },
    ref
  );
  const m2 = w.materials.listForCase(c.id).find((x) => x.itemCode === "passport")!;
  w.materials.review(m2.id, "return", { reason: "r2", requirement: "q2", deadlineAt: "2026-10-06T00:00:00Z" }, "staff-1");
  const dlv = w.notifications.listForCase(c.id);
  assert.equal(dlv.length, 1);
  assert.equal(dlv[0]!.channel, "app");
  assert.equal(dlv[0]!.state, "sent");
});

test("手工 T0 拒绝（43106）；general 模板可手工发送；通道全关拒绝（43105）", () => {
  const { w, c } = setup();
  const t0 = publishT0Template(w, "material_supplement");
  expectError(() => w.notifications.sendManual(c.id, t0.id, c.customerRef, "staff"), "43106");
  const g = w.notifications.createTemplate(
    { code: "g1", category: "general", title: "系统维护", body: "今晚维护", safeSummary: "系统通知", channels: ["app"], authorId: "a" },
    "a"
  );
  w.notifications.submitTemplate(g.id, "a");
  w.notifications.reviewTemplate(g.id, "published", "b");
  assert.equal(w.notifications.sendManual(c.id, g.id, c.customerRef, "staff").state, "sent");
  expectError(
    () => w.notifications.updatePrefs(c.id, { app: false, sms: false, email: false }, c.customerRef),
    "43105"
  );
});

test("换道链：App 2h 未读→短信；次日未达→人工电话；距截止≤4h 未触达本人→升级主管", () => {
  const { w, c, ref } = setup();
  publishT0Template(w, "material_supplement");
  w.materials.upload(
    c.id,
    ref,
    "passport",
    { fileHash: "h1", artifactRef: "L3://p.jpg", mime: "image/jpeg", sizeBytes: 1_000_000 },
    ref
  );
  const m = w.materials.listForCase(c.id).find((x) => x.itemCode === "passport")!;
  const deadline = "2026-10-06T00:00:00Z";
  w.materials.review(m.id, "return", { reason: "r", requirement: "q", deadlineAt: deadline }, "staff-1");
  const d = w.notifications.listForCase(c.id)[0]!;
  const tasks = w.tasks.listForCase(c.id);

  // 2h 后 → 短信
  const t2h = new Date(Date.parse(d.sentAt!) + 2 * 3600_000 + 1000).toISOString();
  w.notifications.tick(t2h, tasks);
  assert.equal(d.channel, "sms");
  assert.deepEqual(d.chain, ["app", "sms"]);
  assert.equal(d.state, "sent");

  // 次日仍未送达 → 人工电话
  const nextDay = new Date(Date.parse(d.sentAt!) + 26 * 3600_000).toISOString();
  w.notifications.tick(nextDay, tasks);
  assert.equal(d.state, "manual_call");

  // 距截止 ≤4h 未触达 → 升级主管
  const nearDeadline = new Date(Date.parse(deadline) - 3 * 3600_000).toISOString();
  w.notifications.tick(nearDeadline, tasks);
  assert.equal(d.state, "escalated");
  assert.equal(d.escalatedTo, "supervisor");
});

test("家属代接继续升级；客户标记已读；对客视图隐藏内部备注", () => {
  const { w, c, ref } = setup();
  publishT0Template(w, "material_supplement");
  w.materials.upload(
    c.id,
    ref,
    "passport",
    { fileHash: "h1", artifactRef: "L3://p.jpg", mime: "image/jpeg", sizeBytes: 1_000_000 },
    ref
  );
  const m = w.materials.listForCase(c.id).find((x) => x.itemCode === "passport")!;
  w.materials.review(
    m.id,
    "return",
    { reason: "r", requirement: "q", deadlineAt: "2026-10-06T00:00:00Z" },
    "staff-1"
  );
  const d = w.notifications.listForCase(c.id)[0]!;
  // 模拟次日人工外呼家属代接
  const nextDay = new Date(Date.parse(d.sentAt!) + 26 * 3600_000).toISOString();
  w.notifications.tick(nextDay, w.tasks.listForCase(c.id));
  w.notifications.familyAnswered(d.id, nextDay);
  assert.equal(d.state, "escalated");

  // 另一条 general 通知走已读
  const g = w.notifications.createTemplate(
    { code: "g2", category: "general", title: "通知", body: "B", safeSummary: "系统通知", channels: ["app"], authorId: "a" },
    "a"
  );
  w.notifications.submitTemplate(g.id, "a");
  w.notifications.reviewTemplate(g.id, "published", "b");
  const d2 = w.notifications.sendManual(c.id, g.id, ref, "staff");
  w.notifications.markRead(d2.id, ref);
  assert.equal(d2.state, "read");
  // 对客视图无内部备注
  assert.equal("note" in w.notifications.viewForCustomer(c.id, ref)[0]!, false);
});
