import { test } from "node:test";
import assert from "node:assert/strict";
import { world } from "../test-utils/world.js";
import { WikiService } from "./wiki.service.js";

function setup() {
  const w = world();
  const wiki = new WikiService(w.audit);
  return { wiki };
}

test("K1 Wiki：ingest→compile→lint→四眼→publish 全链", () => {
  const { wiki } = setup();
  const s = wiki.ingestSource("admin01", {
    kind: "regulation",
    title: "居留许可申请说明",
    body: "申请人须提交无犯罪记录证明，审理周期以官方为准。",
    sourceRef: "REG-2026-01"
  });
  assert.equal(s.state, "raw");

  const p = wiki.compileDraft("admin01", {
    title: "居留许可申请说明",
    slug: "residence-permit-guide",
    sourceIds: [s.id]
  });
  assert.equal(p.state, "draft");
  assert.equal(wiki.listSources().records[0]!.state, "compiled");

  const lint = wiki.lint("admin01", p.id);
  // 确定性编译草稿的正文段落含来源 id（标题段中），允许通过
  assert.ok(lint.ok, JSON.stringify(lint));

  wiki.submit("admin01", p.id);
  assert.throws(() => wiki.review("admin01", p.id, true), /不可与编制人/);
  wiki.review("admin02", p.id, true);
  assert.equal(wiki.publishedPages().length, 1);
});

test("K1 Wiki：无来源不可编译；未 lint 不可提交；L0 失效联动下架", () => {
  const { wiki } = setup();
  assert.throws(
    () => wiki.compileDraft("admin01", { title: "x", slug: "x", sourceIds: [] }),
    /至少绑定一个 L0 来源/
  );

  const s = wiki.ingestSource("admin01", {
    kind: "education",
    title: "防骗要点",
    body: "仅向对公账户付款。",
    sourceRef: "EDU-SAFE"
  });
  const p = wiki.compileDraft("admin01", { title: "防骗要点", slug: "safety", sourceIds: [s.id] });
  assert.throws(() => wiki.submit("admin01", p.id), /必须先 Lint/);

  wiki.lint("admin01", p.id);
  wiki.submit("admin01", p.id);
  wiki.review("admin02", p.id, true);
  assert.equal(wiki.publishedPages().length, 1);

  const r = wiki.invalidateForSource("admin01", s.id, "内容过期");
  assert.deepEqual(r.affected, [p.id]);
  assert.equal(wiki.publishedPages().length, 0);
  assert.equal(wiki.gaps().records.length, 0);
});

test("K1 Wiki：红线措辞 lint 不通过", () => {
  const { wiki } = setup();
  const s = wiki.ingestSource("admin01", {
    kind: "document",
    title: "项目说明",
    body: "正常说明文本。",
    sourceRef: "DOC-1"
  });
  const p = wiki.compileDraft("admin01", {
    title: "项目说明",
    slug: "project-doc",
    sourceIds: [s.id],
    markdown: `# 项目说明\n\n本项目成功率 95%（${s.id}）。`
  });
  const lint = wiki.lint("admin01", p.id);
  assert.equal(lint.ok, false);
  assert.ok(lint.wordViolations.length > 0);
  assert.throws(() => wiki.submit("admin01", p.id), /Lint 未通过/);
});
