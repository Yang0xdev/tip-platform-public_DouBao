import { useState } from "react";
import { type Actor } from "./api.js";
import { Panel, Td, Th, useApi } from "./modules.js";
import { ActBtn, post } from "./modules-m3.js";

/* ================= A13 AI 知识与运营中心（初步功能） ================= */

const STATE_BADGE: Record<string, { cls: string; label: string }> = {
  draft: { cls: "bg-line-soft text-faint", label: "草稿" },
  submitted: { cls: "bg-warn-bg text-warn", label: "待复核" },
  published: { cls: "bg-ok-bg text-ok", label: "已发布" },
  invalidated: { cls: "bg-berry-bg text-berry", label: "已失效" }
};
const KIND_LABEL: Record<string, string> = {
  education: "防骗/科普",
  faq: "问答",
  source: "来源资料"
};

const inputCls =
  "w-full h-10 rounded-xl border border-line px-3 text-[13px] outline-none focus:border-navy focus:ring-2 focus:ring-navy-50 transition";

function MiniBadge({ state }: { state: string }) {
  const b = STATE_BADGE[state] ?? STATE_BADGE.draft;
  return (
    <span className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${b.cls}`}>
      {b.label}
    </span>
  );
}

export function A13Knowledge({ actor }: { actor: Actor }) {
  const [tok, setTok] = useState(0);
  const [reviewer, setReviewer] = useState("admin02");
  const [form, setForm] = useState({ title: "", kind: "education", sourceRef: "", body: "" });
  const [ingestErr, setIngestErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const metrics = useApi<{ records: Array<{ key: string; label: string; value: number }>; note: string }>(
    "/admin/ai/metrics", actor, [tok]
  );
  const items = useApi<{ records: Array<{
    id: string; title: string; kind: string; state: string; sourceRef: string;
    authorId: string; reviewerId: string | null; reason: string | null
  }> }>("/admin/ai-knowledge", actor, [tok]);

  async function ingest() {
    setBusy(true);
    setIngestErr(null);
    try {
      await post(actor, "/admin/ai-knowledge/ingest", form);
      setForm({ title: "", kind: "education", sourceRef: "", body: "" });
      setTok(Date.now());
    } catch (e) {
      setIngestErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rise space-y-5">
      {/* 运营指标 */}
      <Panel title="AI 运营指标（系统计数，只读）">
        {metrics.loading ? (
          <div className="h-[74px] rounded-xl bg-line-soft animate-pulse" />
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3">
              {(metrics.data?.records ?? []).map((r) => (
                <div key={r.key} className="rounded-xl border border-line bg-line-soft/60 px-4 py-3.5">
                  <div className="text-[11.5px] text-faint">{r.label}</div>
                  <div className="text-[24px] font-extrabold text-navy mt-0.5">{r.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11.5px] text-faint mt-3">{metrics.data?.note}</p>
          </>
        )}
      </Panel>

      <div className="grid grid-cols-3 gap-5">
        {/* 采集入库 */}
        <div className="col-span-1">
          <Panel title="采集 / 入库">
            <div className="space-y-3">
              <Field label="标题">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={inputCls} placeholder="如：如何识别包成功话术" />
              </Field>
              <Field label="类型">
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
                  <option value="education">防骗/科普</option>
                  <option value="faq">问答</option>
                  <option value="source">来源资料</option>
                </select>
              </Field>
              <Field label="来源凭据">
                <input value={form.sourceRef} onChange={(e) => setForm({ ...form, sourceRef: e.target.value })}
                  className={inputCls} placeholder="如：EDU-2026-001 / 官方链接" />
              </Field>
              <Field label="正文">
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                  className={`${inputCls} min-h-[96px] py-2`} placeholder="知识内容正文" />
              </Field>
              {ingestErr && <div className="text-[11.5px] text-bad">{ingestErr}</div>}
              <button disabled={busy} onClick={ingest}
                className="btn-navy h-10 rounded-btn px-4 text-white text-[13px] font-semibold disabled:opacity-60">
                {busy ? "…" : "保存为草稿"}
              </button>
            </div>
          </Panel>
        </div>

        {/* 四眼队列 */}
        <div className="col-span-2">
          <Panel title="知识条目（四眼发布）">
            <div className="flex items-center gap-2 mb-3 text-[11.5px] text-faint">
              <span>复核操作以</span>
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)}
                className="h-8 rounded-lg border border-line px-2 w-24 text-[12px]" />
              <span>身份执行（须与编制人不同，服务端强制）</span>
            </div>
            {items.loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 rounded-xl bg-line-soft animate-pulse" />)}</div>
            ) : (
              <table className="w-full text-[12.5px]">
                <thead><tr><Th w="11%">编号</Th><Th w="26%">标题</Th><Th w="11%">类型</Th>
                  <Th w="11%">状态</Th><Th w="28%">操作</Th><Th w="13%">来源</Th></tr></thead>
                <tbody>
                  {(items.data?.records ?? []).map((r) => (
                    <tr key={r.id} className="border-t border-line-soft">
                      <Td mono>{r.id}</Td>
                      <Td>
                        <div className="font-semibold">{r.title}</div>
                        {r.reason && <div className="text-[10.5px] text-faint mt-0.5">{r.reason}</div>}
                      </Td>
                      <Td>{KIND_LABEL[r.kind]}</Td>
                      <Td><MiniBadge state={r.state} /></Td>
                      <Td>
                        <span className="inline-flex gap-1.5 flex-wrap">
                          {r.state === "draft" && (
                            <ActBtn label="提交" kind="navy"
                              run={() => post(actor, `/admin/ai-knowledge/${r.id}/submit`, {})}
                              onDone={() => setTok(Date.now())} />
                          )}
                          {r.state === "submitted" && (
                            <>
                              <ActBtn label="通过" kind="ok"
                                run={() => post({ ...actor, user: reviewer }, `/admin/ai-knowledge/${r.id}/review`, { decision: "approve" })}
                                onDone={() => setTok(Date.now())} />
                              <ActBtn label="驳回" kind="berry"
                                run={() => post({ ...actor, user: reviewer }, `/admin/ai-knowledge/${r.id}/review`, { decision: "reject", reason: "内容需补充来源" })}
                                onDone={() => setTok(Date.now())} />
                            </>
                          )}
                          {r.state === "published" && (
                            <ActBtn label="失效下架" kind="ghost"
                              run={() => post(actor, `/admin/ai-knowledge/${r.id}/invalidate`, { reason: "内容过期，待更新" })}
                              onDone={() => setTok(Date.now())} />
                          )}
                          {r.state === "invalidated" && <span className="text-[11px] text-faint">已从对客列表移除</span>}
                        </span>
                      </Td>
                      <Td mono>{r.sourceRef}</Td>
                    </tr>
                  ))}
                  {(items.data?.records ?? []).length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-faint text-[12px]">暂无条目，先在左侧采集入库</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      </div>

      {/* K1 知识编译层（U1 增量，并入 A13，不另设导航） */}
      <K1Wiki actor={actor} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] font-semibold text-mut mb-1">{label}</span>
      {children}
    </label>
  );
}

/* ================= K1 知识编译层（Wiki，U1 增量） ================= */

export function K1Wiki({ actor }: { actor: Actor }) {
  const [tok, setTok] = useState(0);
  const [reviewer, setReviewer] = useState("admin02");
  const [srcForm, setSrcForm] = useState({ kind: "regulation", title: "", sourceRef: "", body: "" });
  const [compileForm, setCompileForm] = useState({ title: "", slug: "", sourceIds: [] as string[] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sources = useApi<{ records: Array<{
    id: string; kind: string; title: string; sourceRef: string; level: string; state: string
  }> }>("/admin/wiki/sources", actor, [tok]);
  const pages = useApi<{ records: Array<{
    id: string; slug: string; title: string; sources: string[]; version: number;
    state: string; compiledWith: string; lint: {
      ok: boolean; brokenLinks: string[]; unsourcedParagraphs: number;
      expiredSources: string[]; wordViolations: string[]
    } | null
  }> }>("/admin/wiki/pages", actor, [tok]);
  const gaps = useApi<{ records: Array<{ id: string; title: string }> }>("/admin/wiki/gaps", actor, [tok]);

  const refresh = () => setTok(Date.now());

  async function ingestSource() {
    setBusy(true); setErr(null);
    try {
      await post(actor, "/admin/wiki/sources", srcForm);
      setSrcForm({ kind: "regulation", title: "", sourceRef: "", body: "" });
      refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  function toggleSource(id: string) {
    setCompileForm((f) => ({
      ...f,
      sourceIds: f.sourceIds.includes(id) ? f.sourceIds.filter((x) => x !== id) : [...f.sourceIds, id]
    }));
  }

  async function compile() {
    setBusy(true); setErr(null);
    try {
      await post(actor, "/admin/wiki/compile", compileForm);
      setCompileForm({ title: "", slug: "", sourceIds: [] });
      refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Panel title="K1 知识编译层（L0 原始资料 → L1 Wiki 主题页）">
        <div className="grid grid-cols-3 gap-5">
          {/* L0 采集 */}
          <div className="space-y-3">
            <div className="text-[12px] font-bold text-navy">① L0 采集（不可变）</div>
            <Field label="类型">
              <select value={srcForm.kind} onChange={(e) => setSrcForm({ ...srcForm, kind: e.target.value })} className={inputCls}>
                <option value="regulation">政策法规</option>
                <option value="document">项目文档</option>
                <option value="fee">费表</option>
                <option value="education">防骗/科普</option>
              </select>
            </Field>
            <Field label="标题">
              <input value={srcForm.title} onChange={(e) => setSrcForm({ ...srcForm, title: e.target.value })} className={inputCls} />
            </Field>
            <Field label="来源凭据">
              <input value={srcForm.sourceRef} onChange={(e) => setSrcForm({ ...srcForm, sourceRef: e.target.value })} className={inputCls} placeholder="文号 / 官方链接" />
            </Field>
            <Field label="正文">
              <textarea value={srcForm.body} onChange={(e) => setSrcForm({ ...srcForm, body: e.target.value })} className={`${inputCls} min-h-[88px] py-2`} />
            </Field>
            {err && <div className="text-[11.5px] text-bad">{err}</div>}
            <button disabled={busy} onClick={ingestSource} className="btn-navy h-10 rounded-btn px-4 text-white text-[13px] font-semibold disabled:opacity-60">
              {busy ? "…" : "存入 L0"}
            </button>
          </div>

          {/* 编译 */}
          <div className="space-y-3">
            <div className="text-[12px] font-bold text-navy">② 编译为 Wiki 主题页</div>
            <Field label="页面标题">
              <input value={compileForm.title} onChange={(e) => setCompileForm({ ...compileForm, title: e.target.value })} className={inputCls} />
            </Field>
            <Field label="slug（英文短横线）">
              <input value={compileForm.slug} onChange={(e) => setCompileForm({ ...compileForm, slug: e.target.value })} className={inputCls} placeholder="如 residence-guide" />
            </Field>
            <div>
              <div className="text-[11.5px] font-semibold text-mut mb-1.5">绑定 L0 来源（至少 1 个）</div>
              <div className="space-y-1.5 max-h-[168px] overflow-auto rounded-xl border border-line p-2.5">
                {(sources.data?.records ?? []).filter((s) => s.state !== "invalidated").map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={compileForm.sourceIds.includes(s.id)} onChange={() => toggleSource(s.id)} />
                    <span className="font-mono text-[11px] text-faint">{s.id}</span>
                    <span className="truncate">{s.title}</span>
                  </label>
                ))}
                {(sources.data?.records ?? []).length === 0 && <div className="text-[11.5px] text-faint py-2 text-center">暂无 L0 来源</div>}
              </div>
            </div>
            <button disabled={busy} onClick={compile} className="btn-navy h-10 rounded-btn px-4 text-white text-[13px] font-semibold disabled:opacity-60">
              {busy ? "…" : "编译草稿（人工）"}
            </button>
            <p className="text-[10.5px] text-faint">Qwen Wiki 编译器草稿（端侧生成）经同一接口提交，状态标 qwen。</p>
          </div>

          {/* 缺口 */}
          <div className="space-y-3">
            <div className="text-[12px] font-bold text-navy">知识缺口（未被引用的 L0）</div>
            <div className="rounded-xl border border-line p-3 space-y-2 min-h-[120px]">
              {(gaps.data?.records ?? []).map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-[12px]">
                  <span className="font-mono text-[11px] text-faint">{g.id}</span>
                  <span className="truncate">{g.title}</span>
                </div>
              ))}
              {(gaps.data?.records ?? []).length === 0 && <div className="text-[11.5px] text-faint py-4 text-center">暂无缺口</div>}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Wiki 主题页（Lint → 四眼发布；L0 失效联动下架）">
        <div className="flex items-center gap-2 mb-3 text-[11.5px] text-faint">
          <span>复核操作以</span>
          <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="h-8 rounded-lg border border-line px-2 w-24 text-[12px]" />
          <span>身份执行（须与编制人不同，服务端强制）</span>
        </div>
        <table className="w-full text-[12.5px]">
          <thead><tr><Th w="10%">编号</Th><Th w="18%">标题/slug</Th><Th w="13%">来源</Th>
            <Th w="9%">状态</Th><Th w="22%">Lint 报告</Th><Th w="28%">操作</Th></tr></thead>
          <tbody>
            {(pages.data?.records ?? []).map((p) => (
              <tr key={p.id} className="border-t border-line-soft">
                <Td mono>{p.id}</Td>
                <Td>
                  <div className="font-semibold">{p.title}</div>
                  <div className="text-[10.5px] text-faint font-mono">{p.slug} · v{p.version} · {p.compiledWith === "qwen" ? "Qwen" : "人工"}</div>
                </Td>
                <Td mono>{p.sources.join(" ")}</Td>
                <Td><MiniBadge state={p.state} /></Td>
                <Td>
                  {p.lint ? (
                    p.lint.ok ? (
                      <span className="text-[11px] text-ok font-semibold">通过</span>
                    ) : (
                      <span className="text-[10.5px] text-bad leading-4 block">
                        {p.lint.brokenLinks.length > 0 && <span className="block">断链：{p.lint.brokenLinks.join(", ")}</span>}
                        {p.lint.unsourcedParagraphs > 0 && <span className="block">{p.lint.unsourcedParagraphs} 段无来源</span>}
                        {p.lint.expiredSources.length > 0 && <span className="block">过期来源：{p.lint.expiredSources.join(", ")}</span>}
                        {p.lint.wordViolations.length > 0 && <span className="block">红线：{p.lint.wordViolations.join(", ")}</span>}
                      </span>
                    )
                  ) : (
                    <span className="text-[11px] text-faint">未检查</span>
                  )}
                </Td>
                <Td>
                  <span className="inline-flex gap-1.5 flex-wrap">
                    {p.state === "draft" && (
                      <>
                        <ActBtn label="Lint" kind="ghost" run={() => post(actor, "/admin/wiki/lint", { pageId: p.id })} onDone={refresh} />
                        <ActBtn label="提交复核" kind="navy" run={() => post(actor, "/admin/wiki/submit", { pageId: p.id })} onDone={refresh} />
                      </>
                    )}
                    {p.state === "submitted" && (
                      <>
                        <ActBtn label="通过发布" kind="ok"
                          run={() => post({ ...actor, user: reviewer }, "/admin/wiki/review", { pageId: p.id, approve: true })} onDone={refresh} />
                        <ActBtn label="驳回" kind="berry"
                          run={() => post({ ...actor, user: reviewer }, "/admin/wiki/review", { pageId: p.id, approve: false, reason: "来源不完整，请补全" })} onDone={refresh} />
                      </>
                    )}
                    {p.state === "published" && (
                      <ActBtn label="失效下架" kind="ghost"
                        run={() => post(actor, "/admin/wiki/sources/invalidate", { sourceId: p.sources[0], reason: "来源更新，页面待重编译" })} onDone={refresh} />
                    )}
                    {p.state === "invalidated" && <span className="text-[11px] text-faint">已联动下架</span>}
                  </span>
                </Td>
              </tr>
            ))}
            {(pages.data?.records ?? []).length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-faint text-[12px]">暂无 Wiki 页，先采集 L0 并编译</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
