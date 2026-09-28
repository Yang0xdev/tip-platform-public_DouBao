import { useState } from "react";
import { api, type Actor } from "./api.js";
import { Badge, Loading, Panel, Td, Th, useApi } from "./modules.js";

/* ================= 通用：操作按钮（写操作，错误直接显示） ================= */

export function ActBtn({
  label,
  run,
  onDone,
  kind = "navy",
  small = true
}: {
  label: string;
  run: () => Promise<unknown>;
  onDone?: () => void;
  kind?: "navy" | "berry" | "ok" | "ghost";
  small?: boolean;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tones = {
    navy: "border-navy/30 text-navy hover:bg-navy-50",
    berry: "border-berry/30 text-berry hover:bg-berry-bg",
    ok: "border-ok/30 text-ok hover:bg-ok-bg",
    ghost: "border-line text-faint hover:bg-line-soft"
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await run();
            onDone?.();
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${small ? "text-[11px]" : ""} ${tones[kind]}`}
      >
        {busy ? "…" : label}
      </button>
      {err && <span className="text-[10.5px] text-bad max-w-[220px] leading-snug">{err}</span>}
    </span>
  );
}

export const post = (actor: Actor, path: string, body: unknown) =>
  api(path, actor, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function refreshToken(): number {
  return Date.now();
}

/* ================= A02 供给准入（真实页面） ================= */

interface ProviderRow {
  id: string;
  type: string;
  mode: string;
  name: string;
  state: string;
  license: { country: string; expiresAt: string; verified: boolean } | null;
}
interface EntityRow {
  id: string;
  name: string;
  filingNo: string | null;
  baseStatus: string;
}

export function A02Providers({ actor }: { actor: Actor }) {
  const [tick, setTick] = useState(0);
  const sp = useApi<{ records: ProviderRow[] }>("/admin/providers", actor, [tick]);
  const ent = useApi<{ records: EntityRow[] }>("/admin/entities", actor, [tick]);
  const reload = () => setTick(refreshToken());

  /** dev 一键补齐：挂持牌→核验→协议四件（每步都是真实端点调用） */
  function completeDossier(r: ProviderRow) {
    const entityId = ent.data?.records[0]?.id;
    return (async () => {
      if (r.type !== "inhouse_delivery" && entityId)
        await post(actor, `/admin/providers/${r.id}/domestic-entity`, { entityId });
      if (r.type !== "domestic_entity") {
        await post(actor, `/admin/providers/${r.id}/license`, {
          credentialNo: `REG-${r.id}`,
          country: "PT",
          issuedAt: "2026-01-01T00:00:00Z",
          expiresAt: "2027-06-01T00:00:00Z"
        });
        await post(actor, `/admin/providers/${r.id}/license/verify`, {});
      }
      for (const key of ["framework", "dataProcessing", "confidentiality", "serviceLevel"])
        await post(actor, `/admin/providers/${r.id}/agreement`, { key });
    })();
  }

  return (
    <div className="space-y-5 rise">
      <Panel
        title="服务方准入（ext 外部 / in 自营，同一控制点）"
        sub="境外持牌方与自营交付部门均须：有效资质核验 + 协议四件；临期停派案、过期门户停权。"
      >
        <Loading error={sp.error} loading={sp.loading} empty={!sp.data?.records.length}>
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: "10%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>编号</Th>
                <Th>名称</Th>
                <Th>类型/模式</Th>
                <Th>资质</Th>
                <Th>状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {(sp.data?.records ?? []).map((r) => (
                <tr key={r.id}>
                  <Td mono>{r.id}</Td>
                  <Td>{r.name}</Td>
                  <Td>
                    <div className="text-[11.5px]">{r.type}</div>
                    <div className="text-[10.5px] text-faint">{r.mode}</div>
                  </Td>
                  <Td>
                    {r.license ? (
                      <div className="text-[11px] leading-snug">
                        {r.license.country} · {r.license.verified ? "已核验" : "待核验"}
                        <div className="text-faint">至 {r.license.expiresAt.slice(0, 10)}</div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-faint">—</span>
                    )}
                  </Td>
                  <Td>
                    <Badge state={r.state} />
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1.5">
                      {r.state === "incomplete" && (
                        <>
                          <ActBtn label="补齐资料" kind="navy" run={() => completeDossier(r)} onDone={reload} />
                          <ActBtn
                            label="提交"
                            kind="berry"
                            run={async () => {
                              await post(actor, `/admin/providers/${r.id}/submit`, {});
                            }}
                            onDone={reload}
                          />
                        </>
                      )}
                      {r.state === "in_review" && (
                        <>
                          <ActBtn
                            label="复核通过"
                            kind="ok"
                            run={async () => {
                              await post(actor, `/admin/providers/${r.id}/review`, { decision: "active" });
                            }}
                            onDone={reload}
                          />
                          <ActBtn
                            label="退回补正"
                            kind="ghost"
                            run={async () => {
                              await post(actor, `/admin/providers/${r.id}/review`, { decision: "incomplete" });
                            }}
                            onDone={reload}
                          />
                        </>
                      )}
                      {(r.state === "active" || r.state === "expiring") && (
                        <ActBtn
                          label="暂停"
                          kind="ghost"
                          run={async () => {
                            await post(actor, `/admin/providers/${r.id}/suspend`, { reason: "合规暂停" });
                          }}
                          onDone={reload}
                        />
                      )}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>

      <Panel title="境内备案主体" sub="签约方与服务方关联的境内主体；备案到期自动失效。">
        <Loading error={ent.error} loading={ent.loading} empty={!ent.data?.records.length}>
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: "15%" }} />
              <col style={{ width: "45%" }} />
              <col style={{ width: "20%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>编号</Th>
                <Th>名称</Th>
                <Th>备案号</Th>
                <Th>状态</Th>
              </tr>
            </thead>
            <tbody>
              {(ent.data?.records ?? []).map((r) => (
                <tr key={r.id}>
                  <Td mono>{r.id}</Td>
                  <Td>{r.name}</Td>
                  <Td mono>{r.filingNo ?? "—"}</Td>
                  <Td>
                    <Badge state={r.baseStatus} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>
    </div>
  );
}

/* ================= A06 交付看板 ================= */

interface BoardColumn {
  stage: string;
  label: string;
  cases: CaseRow[];
}
interface CaseRow {
  id: string;
  customerRef: string;
  advisorId: string;
  stage: string;
  exceptions: Array<{ kind: string; reason: string; active?: boolean }>;
}
interface MaterialRow {
  id: string;
  personRef: string;
  itemCode: string;
  title: string;
  state: string;
  versions: Array<{ reviewOutcome: string }>;
}
interface TimelineRow {
  id: string;
  level: string;
  title: string;
  verification?: { state: string } | null;
}

const STAGE_LABEL: Record<string, string> = {
  material_prep: "材料准备",
  pending_submit: "待递交",
  submitted: "已递交",
  accepted: "已受理",
  supplementing: "补件中",
  reviewing: "审核中",
  approved: "已批准",
  refused: "未批准",
  closed: "已结案"
};

export function A06Delivery({ actor }: { actor: Actor }) {
  const [tick, setTick] = useState(0);
  const [selCase, setSelCase] = useState<string | null>(null);
  const board = useApi<{ columns: BoardColumn[]; exceptions: Array<{ case: CaseRow; active: unknown[] }> }>(
    "/admin/cases/board",
    actor,
    [tick]
  );
  const materials = useApi<{ records: MaterialRow[] }>(
    selCase ? `/admin/materials?caseId=${selCase}` : "/admin/materials?caseId=__none__",
    actor,
    [tick, selCase]
  );
  const queue = useApi<{ records: TimelineRow[] }>("/admin/timeline/verification-queue", actor, [tick]);
  const reload = () => setTick(refreshToken());

  const cases = board.data?.columns.flatMap((c) => c.cases) ?? [];
  const current = selCase ?? cases[0]?.id ?? null;

  return (
    <div className="space-y-5 rise">
      <Panel title="案件看板（阶段白名单；异常独立段，不并入处理中）" sub="官方节点（受理/批准/未批准）须挂已核验凭据，且核验人≠案件发起人。">
        <Loading error={board.error} loading={board.loading} empty={!cases.length}>
          <div className="grid grid-cols-3 gap-3">
            {(board.data?.columns ?? []).map((col) => (
              <div key={col.stage} className="rounded-xl bg-line-soft p-3 min-h-[96px]">
                <div className="text-[11px] font-bold text-mut mb-2 flex items-center justify-between">
                  <span>{STAGE_LABEL[col.stage] ?? col.stage}</span>
                  <span className="text-faint font-mono">{col.cases.length}</span>
                </div>
                <div className="space-y-2">
                  {col.cases.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelCase(c.id)}
                      className={`w-full text-left rounded-lg bg-white px-3 py-2 border transition hover:border-navy/40 ${current === c.id ? "border-navy ring-2 ring-navy-50" : "border-line"}`}
                    >
                      <div className="text-[12px] font-semibold">{c.id}</div>
                      <div className="text-[10.5px] text-faint">{c.customerRef} · {c.advisorId}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {(board.data?.exceptions.length ?? 0) > 0 && (
            <div className="mt-4 rounded-xl border border-warn/30 bg-warn-bg px-4 py-3">
              <div className="text-[12px] font-bold text-warn mb-1">异常态（暂停/失联/争议）</div>
              {(board.data?.exceptions ?? []).map(({ case: c, active }) => (
                <div key={c.id} className="text-[11.5px] text-warn/90">
                  {c.id}：{(active as Array<{ reason: string }>).map((a) => a.reason).join("、")}
                </div>
              ))}
            </div>
          )}
        </Loading>
      </Panel>

      {current && (
        <Panel title={`材料审核 · ${current}`} sub="退回必须填写：原因、补充要求、时限（自动生成 T0 补件任务）。">
          <Loading error={materials.error} loading={materials.loading} empty={!materials.data?.records.length}>
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "35%" }} />
              </colgroup>
              <thead>
                <tr>
                  <Th>编号</Th>
                  <Th>申请人</Th>
                  <Th>材料</Th>
                  <Th>状态</Th>
                  <Th>操作</Th>
                </tr>
              </thead>
              <tbody>
                {(materials.data?.records ?? []).map((m) => (
                  <tr key={m.id}>
                    <Td mono>{m.id}</Td>
                    <Td>{m.personRef}</Td>
                    <Td>{m.title}</Td>
                    <Td>
                      <Badge state={m.state} />
                    </Td>
                    <Td>
                      {m.versions.length > 0 && m.versions.at(-1)!.reviewOutcome === "pending" && (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <ActBtn
                            label="通过"
                            kind="ok"
                            run={async () => {
                              await post(actor, `/admin/materials/${m.id}/review`, { decision: "approve" });
                            }}
                            onDone={reload}
                          />
                          <ReturnForm actor={actor} id={m.id} onDone={reload} />
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Loading>
        </Panel>
      )}

      <Panel title="服务方报告核验队列（sp → off）" sub="核验人不能是案件发起人；通过须登记官方凭据，另发 off 事件。">
        <Loading error={queue.error} loading={queue.loading} empty={!queue.data?.records.length}>
          <div className="space-y-2">
            {(queue.data?.records ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-xl border border-line px-4 py-2.5">
                <div className="text-[12.5px]">
                  <span className="font-mono text-[11px] text-berry font-bold mr-2">{r.id}</span>
                  {r.title}（未经官方核验）
                </div>
                <VerifyForm actor={actor} id={r.id} onDone={reload} />
              </div>
            ))}
          </div>
        </Loading>
      </Panel>
    </div>
  );
}

function ReturnForm({ actor, id, onDone }: { actor: Actor; id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [requirement, setRequirement] = useState("");
  const [deadline, setDeadline] = useState("2026-10-10T00:00");
  if (!open)
    return <ActBtn label="退回" kind="berry" run={async () => setOpen(true)} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="原因" className="h-7 w-24 rounded-lg border border-line px-2 text-[11px] outline-none focus:border-berry" />
      <input value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="补充要求" className="h-7 w-28 rounded-lg border border-line px-2 text-[11px] outline-none focus:border-berry" />
      <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="h-7 rounded-lg border border-line px-2 text-[11px]" />
      <ActBtn
        label="确认退回"
        kind="berry"
        run={async () => {
          await post(actor, `/admin/materials/${id}/review`, {
            decision: "return",
            reason,
            requirement,
            deadlineAt: new Date(deadline).toISOString()
          });
        }}
        onDone={() => {
          setOpen(false);
          onDone();
        }}
      />
    </span>
  );
}

function VerifyForm({ actor, id, onDone }: { actor: Actor; id: string; onDone: () => void }) {
  const [evidence, setEvidence] = useState("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="官方凭据引用"
        className="h-7 w-40 rounded-lg border border-line px-2 text-[11px] outline-none focus:border-navy"
      />
      <ActBtn
        label="核验通过"
        kind="ok"
        run={async () => {
          await post(actor, "/admin/timeline/verify", { spEventId: id, decision: "verified", evidenceRef: evidence });
        }}
        onDone={onDone}
      />
      <ActBtn
        label="驳回"
        kind="ghost"
        run={async () => {
          await post(actor, "/admin/timeline/verify", { spEventId: id, decision: "rejected", note: "渠道查无此件" });
        }}
        onDone={onDone}
      />
    </span>
  );
}

/* ================= A09 通知治理 ================= */

interface TemplateRow {
  id: string;
  code: string;
  category: string;
  title: string;
  state: string;
  authorId: string;
}
interface DeliveryRow {
  id: string;
  caseId: string;
  category: string;
  channel: string;
  state: string;
  escalatedTo: string | null;
}

export function A09Notifications({ actor }: { actor: Actor }) {
  const [tick, setTick] = useState(0);
  const tpl = useApi<{ records: TemplateRow[] }>("/admin/notifications/templates", actor, [tick]);
  const [caseId, setCaseId] = useState("");
  const dlv = useApi<{ records: DeliveryRow[] }>(
    caseId ? `/admin/notifications/deliveries?caseId=${caseId}` : "/admin/notifications/deliveries",
    actor,
    [tick, caseId]
  );
  const esc = useApi<{ records: DeliveryRow[] }>("/admin/notifications/escalations", actor, [tick]);
  const reload = () => setTick(refreshToken());

  return (
    <div className="space-y-5 rise">
      <Panel title="通知模板（四眼审核后发布）" sub="T0/T1 模板只能由任务自动触发；锁屏摘要不含案号项目细节。">
        <Loading error={tpl.error} loading={tpl.loading} empty={!tpl.data?.records.length}>
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: "12%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "24%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>编号</Th>
                <Th>编码</Th>
                <Th>类别</Th>
                <Th>标题</Th>
                <Th>状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {(tpl.data?.records ?? []).map((r) => (
                <tr key={r.id}>
                  <Td mono>{r.id}</Td>
                  <Td mono>{r.code}</Td>
                  <Td>{r.category}</Td>
                  <Td>{r.title}</Td>
                  <Td>
                    <Badge state={r.state} />
                  </Td>
                  <Td>
                    {r.state === "draft" && (
                      <ActBtn
                        label="提交审核"
                        kind="navy"
                        run={async () => {
                          await post(actor, `/admin/notifications/templates/${r.id}/submit`, {});
                        }}
                        onDone={reload}
                      />
                    )}
                    {r.state === "pending_review" && (
                      <ActBtn
                        label="发布"
                        kind="ok"
                        run={async () => {
                          await post(actor, `/admin/notifications/templates/${r.id}/review`, { decision: "published" });
                        }}
                        onDone={reload}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>

      <Panel
        title="送达回执（后台与客户同一份）"
        sub="App→短信→人工→主管升级链；升级不改任务截止。"
        right={
          <input
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
            placeholder="按案件筛选"
            className="h-8 w-36 rounded-lg border border-line px-2.5 text-[11.5px] outline-none focus:border-navy"
          />
        }
      >
        <Loading error={dlv.error} loading={dlv.loading} empty={!dlv.data?.records.length}>
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: "14%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "24%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th>编号</Th>
                <Th>案件</Th>
                <Th>类别</Th>
                <Th>当前通道</Th>
                <Th>状态</Th>
                <Th>升级</Th>
              </tr>
            </thead>
            <tbody>
              {(dlv.data?.records ?? []).map((r) => (
                <tr key={r.id}>
                  <Td mono>{r.id}</Td>
                  <Td mono>{r.caseId}</Td>
                  <Td>{r.category}</Td>
                  <Td>{r.channel}</Td>
                  <Td>
                    <Badge state={r.state} />
                  </Td>
                  <Td><span className="text-[11.5px] text-warn">{r.escalatedTo ? `→ ${r.escalatedTo}` : "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>

      <Panel title="升级队列（主管介入）">
        <Loading error={esc.error} loading={esc.loading} empty={!esc.data?.records.length}>
          <div className="space-y-2">
            {(esc.data?.records ?? []).map((r) => (
              <div key={r.id} className="rounded-xl border border-warn/30 bg-warn-bg px-4 py-2.5 text-[12px] text-warn">
                {r.id} · {r.caseId} · 已升级 {r.escalatedTo ?? "主管"}
              </div>
            ))}
          </div>
        </Loading>
      </Panel>
    </div>
  );
}
