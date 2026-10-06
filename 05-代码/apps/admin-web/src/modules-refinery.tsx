import { useState } from "react";
import { type Actor } from "./api.js";
import { Badge, Loading, Panel, Td, Th, useApi } from "./modules.js";
import { ActBtn, post } from "./modules-m3.js";

/* ================= A14 AI 数据工厂 ================= */

const STAGE_LABEL: Record<string, string> = {
  ingested: "已采集",
  classified: "已分诊",
  parsed: "已解析",
  extracted: "已抽取",
  normalized: "已清洗",
  awaiting_review: "待复核",
  rejected: "已驳回",
  published: "已发布"
};

const TYPE_LABEL: Record<string, string> = {
  regulation: "政策法规",
  project_doc: "项目资料",
  fee_schedule: "费用表",
  contract: "合同协议",
  id_document: "身份证件",
  report: "报告",
  email: "邮件",
  spreadsheet: "表格",
  other: "其他"
};

interface RawRow {
  id: string;
  title: string;
  stage: string;
  docType?: string;
  classifyConf?: number;
  parseTool?: string;
  extractModel?: string;
  ingestedAt: string;
  sample?: boolean;
  blocks?: Array<{ id: string; page: number; type: string; text: string }>;
  fields?: Array<{
    key: string; label: string; kind?: string; value: string | null; state: string; conf: number; manual?: boolean;
    evidence: { blockId: string; page: number; snippet: string } | null;
  }>;
  normalization?: Array<{ fieldKey: string; rule: string }>;
  findings?: Array<{ code: string; level: string; message: string }>;
  reviewerId?: string;
  publishedId?: string;
  history: Array<{ stage: string; at: string; actorId: string; note?: string }>;
}

interface CanRow {
  id: string; type: string; title: string; version: number; status: string;
  publishedAt: string; publisherId: string; wikiSourceId?: string;
  payload: Record<string, unknown>; sourceIds: string[];
}

const inputCls =
  "w-full h-10 rounded-xl border border-line px-3 text-[13px] outline-none focus:border-navy focus:ring-2 focus:ring-navy-50 transition";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-3">
      <div className="text-[18px] font-extrabold text-navy leading-none">{value}</div>
      <div className="text-[11px] text-faint mt-1.5">{label}</div>
      {sub && <div className="text-[10.5px] text-faint/80 mt-0.5">{sub}</div>}
    </div>
  );
}

export function A14Refinery({ actor }: { actor: Actor }) {
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(Date.now());
  const [reviewer, setReviewer] = useState("admin02");
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", content: "" });
  const [ingestErr, setIngestErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const raws = useApi<{ records: RawRow[] }>("/admin/refinery/sources", actor, [tick]);
  const cans = useApi<{ records: CanRow[] }>("/admin/refinery/canonical", actor, [tick]);
  const dash = useApi<any>("/admin/refinery/dashboard", actor, [tick]);
  const sel = raws.data?.records.find((r) => r.id === selId) ?? null;

  async function ingest() {
    setBusy(true); setIngestErr(null);
    try {
      const r = await post(actor, "/admin/refinery/sources/ingest-text", {
        title: form.title, content: form.content, sourceType: "manual"
      });
      setForm({ title: "", content: "" });
      refresh();
      setSelId((r as RawRow).id);
    } catch (e) {
      setIngestErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** 行内工段按钮（按状态） */
  function StageActions({ r }: { r: RawRow }) {
    const asReviewer = { ...actor, user: reviewer };
    return (
      <span className="inline-flex flex-wrap gap-1.5">
        {["ingested", "classified", "parsed", "extracted", "normalized"].includes(r.stage) && (
          <ActBtn label="一键跑到复核" run={() => post(actor, `/admin/refinery/sources/${r.id}/auto-run`, {})} onDone={refresh} />
        )}
        {r.stage === "ingested" && (
          <ActBtn label="自动分诊" kind="ghost" run={() => post(actor, `/admin/refinery/sources/${r.id}/classify`, {})} onDone={refresh} />
        )}
        {r.stage === "classified" && (
          <ActBtn label="解析" kind="ghost" run={() => post(actor, `/admin/refinery/sources/${r.id}/parse`, {})} onDone={refresh} />
        )}
        {r.stage === "parsed" && (
          <ActBtn label="抽取" kind="ghost" run={() => post(actor, `/admin/refinery/sources/${r.id}/extract`, {})} onDone={refresh} />
        )}
        {r.stage === "extracted" && (
          <ActBtn label="清洗归一" kind="ghost" run={() => post(actor, `/admin/refinery/sources/${r.id}/normalize`, {})} onDone={refresh} />
        )}
        {r.stage === "normalized" && (
          <ActBtn label="提交复核" run={() => post(actor, `/admin/refinery/sources/${r.id}/submit`, {})} onDone={refresh} />
        )}
        {r.stage === "awaiting_review" && (
          <>
            <ActBtn label="复核通过" kind="ok"
              run={() => post(asReviewer, `/admin/refinery/sources/${r.id}/review`, { decision: "approve" })} onDone={refresh} />
            <ActBtn label="驳回" kind="berry"
              run={() => post(asReviewer, `/admin/refinery/sources/${r.id}/review`, {
                decision: "reject", reason: "字段证据不足，需补充"
              })} onDone={refresh} />
          </>
        )}
        {r.stage === "published" && <span className="text-[11.5px] text-ok font-semibold">已发布 {r.publishedId}</span>}
        {r.stage === "rejected" && <span className="text-[11.5px] text-bad">已驳回</span>}
      </span>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部说明 + 指标 */}
      <Panel title="AI 数据工厂 · 七工段" sub="采集 → 分类分诊 → 版面解析 → 结构化抽取 → 清洗归一 → 校验核验（lint+四眼）→ 发布联动；全程证据锚定与血缘可查">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Metric label="L0 已采集" value={String(dash.data?.metrics.ingested ?? 0)} />
          <Metric label="L1 已发布" value={String(dash.data?.metrics.published ?? 0)} />
          <Metric label="自动分诊" value={String(dash.data?.metrics.autoClassified ?? 0)} />
          <Metric label="人工干预" value={String(dash.data?.metrics.manualInterventions ?? 0)} />
          <Metric label="字段平均置信" value={String(dash.data?.metrics.avgFieldConf ?? 0)} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActBtn label="载入移民高频示例包（4 份）" kind="navy"
            run={() => post(actor, "/admin/refinery/sample-pack", {})} onDone={refresh} />
          <div className="flex items-center gap-2 text-[12px] text-faint">
            复核人 id
            <input value={reviewer} onChange={(e) => setReviewer(e.target.value)}
              className="h-8 w-28 rounded-lg border border-line px-2 text-[12px] outline-none focus:border-navy" />
            <span className="text-[10.5px]">（四眼：须不同于提交人）</span>
          </div>
        </div>
      </Panel>

      {/* 采集 */}
      <Panel title="① 采集入 L0（不可变）" sub="粘贴资料正文（政策/费表/项目资料/合同等）；系统生成内容指纹去重">
        <div className="grid md:grid-cols-2 gap-3">
          <input placeholder="资料标题" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
          <div className="text-[11px] text-faint self-center">
            支持 PDF 数字件（API 已具备，UI 上传随后开放）；扫描件走视觉模型。
          </div>
        </div>
        <textarea placeholder="粘贴正文内容…" rows={5} value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          className="mt-3 w-full rounded-xl border border-line px-3 py-2.5 text-[13px] outline-none focus:border-navy focus:ring-2 focus:ring-navy-50 transition" />
        {ingestErr && <div className="mt-2 rounded-lg bg-bad-bg px-3 py-2 text-[12px] text-bad">{ingestErr}</div>}
        <div className="mt-3">
          <button disabled={busy || !form.title || !form.content} onClick={() => void ingest()}
            className="h-10 px-5 rounded-btn bg-navy text-white text-[13px] font-semibold disabled:opacity-50 hover:opacity-90 transition">
            采集并查看
          </button>
        </div>
      </Panel>

      {/* L0 队列 */}
      <Panel title="L0 资料队列（按工段推进）">
        <Loading error={raws.error} loading={raws.loading} empty={(raws.data?.records.length ?? 0) === 0}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th w="22%">资料</Th><Th w="12%">类型</Th><Th w="11%">工段</Th>
                  <Th w="13%">解析/模型</Th><Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {(raws.data?.records ?? []).map((r) => (
                  <tr key={r.id} className={selId === r.id ? "bg-navy-50/60" : ""}>
                    <Td>
                      <button className="text-left font-semibold text-navy hover:underline" onClick={() => setSelId(r.id)}>
                        {r.title}
                      </button>
                      <div className="text-[10.5px] text-faint mt-0.5">{r.id}{r.sample ? " · 示例" : ""}</div>
                    </Td>
                    <Td>{r.docType ? TYPE_LABEL[r.docType] ?? r.docType : "—"}
                      {r.classifyConf != null && <div className="text-[10px] text-faint">置信 {r.classifyConf}</div>}
                    </Td>
                    <Td><Badge state={r.stage} /><div className="text-[10px] text-faint mt-1">{STAGE_LABEL[r.stage]}</div></Td>
                    <Td mono>{r.parseTool ?? "—"}</Td>
                    <Td><StageActions r={r} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Loading>
      </Panel>

      {/* 选中资料详情：字段核验 + 血缘 */}
      {sel && (
        <Panel title={`字段核验与血缘 · ${sel.id}`} sub="每个字段必须命中证据块（页码+原文）；可人工修正（留痕）"
          right={<button className="text-[12px] text-faint hover:underline" onClick={() => setSelId(null)}>关闭</button>}>
          {/* lint findings */}
          {sel.findings && sel.findings.length > 0 && (
            <div className="mb-4 space-y-1.5">
              {sel.findings.map((f, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 text-[12px] ${f.level === "block" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>
                  {f.code} · {f.message}
                </div>
              ))}
            </div>
          )}
          <div className="grid lg:grid-cols-2 gap-5">
            {/* 字段 */}
            <div className="space-y-2">
              {(sel.fields ?? []).map((f) => (
                <div key={f.key} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12.5px] font-semibold">{f.label}
                      <span className="text-[10px] text-faint font-normal"> · {f.key} · {f.kind}</span>
                    </div>
                    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${
                      f.state === "found" ? "bg-ok-bg text-ok" : f.state === "uncertain" ? "bg-warn-bg text-warn" : "bg-line-soft text-faint"
                    }`}>{f.state} · {f.conf}{f.manual ? " · 人工" : ""}</span>
                  </div>
                  <div className="text-[12.5px] mt-1.5 break-words">{f.value ?? "—"}</div>
                  {f.evidence && (
                    <div className="mt-1.5 rounded-lg bg-line-soft px-2.5 py-1.5 text-[11px] text-faint">
                      证据 p{f.evidence.page}（{f.evidence.blockId}）：{f.evidence.snippet}
                    </div>
                  )}
                  <div className="mt-2">
                    <ActBtn label="人工修正" kind="ghost"
                      run={async () => {
                        const v = window.prompt("修正后的值", f.value ?? "");
                        if (v == null) throw new Error("__cancel__");
                        return post(actor, `/admin/refinery/sources/${sel.id}/correct-field`, { key: f.key, value: v });
                      }} onDone={refresh} />
                  </div>
                </div>
              ))}
              {(!sel.fields || sel.fields.length === 0) && <div className="text-[12px] text-faint">尚未抽取</div>}
            </div>

            {/* 血缘 */}
            <LineageView raw={sel} />
          </div>

          {/* 历史 */}
          <div className="mt-4 border-t border-line-soft pt-3">
            <div className="text-[11.5px] font-semibold text-faint mb-2">工段历史（审计轨迹）</div>
            <div className="flex flex-wrap gap-2">
              {sel.history.map((h, i) => (
                <span key={i} className="rounded-full bg-line-soft px-2.5 py-1 text-[10.5px] text-faint">
                  {STAGE_LABEL[h.stage] ?? h.stage} · {h.actorId}{h.note ? ` · ${h.note}` : ""}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      )}

      {/* L1 规范记录 */}
      <Panel title="L1 规范记录（canonical，版本化）" sub="发布即进入服务数据层，并在 K1 登记 Wiki 来源">
        <Loading error={cans.error} loading={cans.loading} empty={(cans.data?.records.length ?? 0) === 0}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th w="12%">编号</Th><Th w="24%">标题</Th><Th w="12%">类型</Th><Th w="10%">状态</Th><Th w="14%">K1 来源</Th><Th>字段</Th></tr></thead>
              <tbody>
                {(cans.data?.records ?? []).map((c) => (
                  <tr key={c.id}>
                    <Td mono>{c.id}</Td>
                    <Td>{c.title}</Td>
                    <Td>{TYPE_LABEL[c.type] ?? c.type}</Td>
                    <Td><Badge state={c.status} /></Td>
                    <Td mono>{c.wikiSourceId ?? "—"}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(c.payload).map(([k, v]) => (
                          <span key={k} className="rounded-full bg-navy-50 px-2 py-0.5 text-[10.5px] text-navy">
                            {k}: {String(v).slice(0, 28)}
                          </span>
                        ))}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Loading>
      </Panel>
    </div>
  );
}

/* ================= 血缘视图（分层流向，确定性 HTML） ================= */

function LineageView({ raw }: { raw: RawRow }) {
  const foundFields = (raw.fields ?? []).filter((f) => f.state === "found");
  return (
    <div className="rounded-xl border border-line p-3.5">
      <div className="text-[11.5px] font-semibold text-faint mb-3">数据血缘（L0 → 版面块 → 字段 → L1）</div>
      <div className="space-y-2.5">
        <div className="rounded-xl bg-navy text-white px-3 py-2.5 text-[12px] font-semibold text-center">
          L0 {raw.id}
        </div>
        <div className="text-center text-faint text-[11px]">↓ {raw.parseTool ?? "解析"}</div>
        <div className="rounded-xl border border-line px-3 py-2.5 text-[12px] text-center">
          版面块 ×{raw.blocks?.length ?? 0}
        </div>
        <div className="text-center text-faint text-[11px]">↓ 证据锚定</div>
        <div className="grid grid-cols-2 gap-1.5">
          {foundFields.map((f) => (
            <div key={f.key} className="rounded-lg bg-navy-50 px-2 py-1.5 text-[10.5px] text-navy"
              title={f.evidence ? `p${f.evidence.page} ${f.evidence.snippet}` : ""}>
              {f.label}: {String(f.value).slice(0, 16)}
            </div>
          ))}
          {foundFields.length === 0 && <div className="col-span-2 text-[11px] text-faint text-center py-2">暂无已取得字段</div>}
        </div>
        <div className="text-center text-faint text-[11px]">↓ 四眼后发布</div>
        <div className={`rounded-xl px-3 py-2.5 text-[12px] text-center ${raw.publishedId ? "bg-ok-bg text-ok font-semibold" : "border border-line text-faint"}`}>
          {raw.publishedId ? `L1 ${raw.publishedId}` : "未发布"}
        </div>
      </div>
    </div>
  );
}
