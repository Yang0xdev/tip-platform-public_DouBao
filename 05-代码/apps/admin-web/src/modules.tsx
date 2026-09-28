import { useEffect, useState } from "react";
import { api, type Actor } from "./api.js";

/* ============== 通用小组件 ============== */

export function useApi<T>(path: string, actor: Actor, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api<T>(path, actor)
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, actor, ...deps]);
  return { data, error, loading };
}

const STATE_TONE: Record<string, string> = {
  draft: "bg-line-soft text-faint",
  pending_verification: "bg-warn-bg text-warn",
  pending_publish: "bg-warn-bg text-warn",
  in_review: "bg-warn-bg text-warn",
  correcting: "bg-warn-bg text-warn",
  submitted: "bg-warn-bg text-warn",
  published: "bg-ok-bg text-ok",
  approved: "bg-ok-bg text-ok",
  authorized: "bg-ok-bg text-ok",
  active: "bg-ok-bg text-ok",
  verified: "bg-ok-bg text-ok",
  suspended: "bg-bad-bg text-bad",
  delisted: "bg-bad-bg text-bad",
  rejected: "bg-bad-bg text-bad",
  terminated: "bg-bad-bg text-bad",
  invalid: "bg-bad-bg text-bad",
  expired: "bg-bad-bg text-bad",
  superseded: "bg-line-soft text-faint",
  expiring: "bg-warn-bg text-warn",
  due: "bg-warn-bg text-warn",
  due_soon: "bg-warn-bg text-warn",
  reconfirm_required: "bg-warn-bg text-warn",
  grant_pending: "bg-warn-bg text-warn",
  pending_filing: "bg-line-soft text-faint"
};

export function Badge({ state }: { state: string }) {
  return (
    <span className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATE_TONE[state] ?? "bg-line-soft text-faint"}`}>
      {state}
    </span>
  );
}

export function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-[14.5px] font-bold">{title}</h2>
          {sub && <p className="text-[11.5px] text-faint mt-0.5 leading-relaxed">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Loading({ error, loading, empty, children }: { error: string | null; loading: boolean; empty?: boolean; children: React.ReactNode }) {
  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 rounded-xl bg-line-soft animate-pulse" />)}</div>;
  if (error) return <div className="rounded-xl border border-bad/30 bg-bad-bg px-4 py-3 text-[12.5px] text-bad">{error}</div>;
  if (empty) return <div className="rounded-xl bg-line-soft px-4 py-8 text-center text-[12.5px] text-faint">暂无数据（影子期种子为空，所有数据由真实操作产生）</div>;
  return <>{children}</>;
}

export function Th({ children, w }: { children: React.ReactNode; w?: string }) {
  return <th style={w ? { width: w } : undefined} className="text-left text-[11px] font-semibold text-faint pb-2.5 pr-3">{children}</th>;
}
export function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`text-[12.5px] py-2.5 pr-3 border-t border-line-soft align-top ${mono ? "font-mono text-[11.5px]" : ""}`}>{children}</td>;
}

/* ============== A01 内容治理 ============== */

interface ProjectRow { id: string; code: string; title: string; version: number; state: string; editorId: string; verifierId: string | null; publisherId: string | null; keyFactIds: string[] }
interface FeeRow { id: string; code: string; title: string; version: number; state: string; authorId: string; feeItems: unknown[] }
interface DataSourceRow { key: string; provider: string | null; scope: string | null; contractValidUntil: string | null; state: "off" | "on"; note: string }

export function A01Content({ actor }: { actor: Actor }) {
  const [tab, setTab] = useState<"projects" | "fees" | "ds">("projects");
  const projects = useApi<{ records: ProjectRow[] }>("/admin/catalog/projects", actor, [tab]);
  const fees = useApi<{ records: FeeRow[] }>("/admin/catalog/fee-schedules", actor, [tab]);
  const ds = useApi<{ records: DataSourceRow[] }>("/admin/data-sources", actor, [tab]);

  return (
    <div className="rise space-y-5">
      <div className="flex gap-1.5">
        {([["projects", "项目版本（两段发布）"], ["fees", "收费方案版本"], ["ds", "全球通行数据源（Q6）"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 h-9 rounded-full text-[12.5px] font-semibold transition ${tab === k ? "bg-navy text-white shadow-sh1" : "bg-white border border-line text-mut hover:border-navy/40"}`}>{label}</button>
        ))}
      </div>

      {tab === "projects" && (
        <Panel title="项目版本台账" sub="草稿→待核验→待发布复核→已发布；核验人/发布人均不得等于编辑人；关键事实未核验不可发布；已发布不可变，修订=新版本。">
          <Loading {...projects} empty={(projects.data?.records.length ?? 0) === 0}>
            <table className="w-full">
              <thead><tr><Th w="11%">编码</Th><Th>标题</Th><Th w="7%">版本</Th><Th w="13%">状态</Th><Th w="11%">事实核验</Th><Th w="9%">编辑</Th><Th w="9%">核验人</Th><Th w="9%">发布人</Th></tr></thead>
              <tbody>
                {projects.data?.records.map((p) => (
                  <tr key={p.id}>
                    <Td mono>{p.code}</Td><Td>{p.title}</Td><Td mono>v{p.version}</Td><Td><Badge state={p.state} /></Td>
                    <Td>{p.keyFactIds.length} 条</Td>
                    <Td mono>{p.editorId}</Td><Td mono>{p.verifierId ?? "—"}</Td><Td mono>{p.publisherId ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Loading>
        </Panel>
      )}

      {tab === "fees" && (
        <Panel title="收费方案版本" sub="分项+收取方+币种+确定性；异币种不相加、不折总价；待确认≠0；复核人≠编辑人。">
          <Loading {...fees} empty={(fees.data?.records.length ?? 0) === 0}>
            <table className="w-full">
              <thead><tr><Th w="12%">编码</Th><Th>标题</Th><Th w="8%">版本</Th><Th w="12%">状态</Th><Th w="12%">费项数</Th></tr></thead>
              <tbody>
                {fees.data?.records.map((f) => (
                  <tr key={f.id}><Td mono>{f.code}</Td><Td>{f.title}</Td><Td mono>v{f.version}</Td><Td><Badge state={f.state} /></Td><Td>{f.feeItems.length}</Td></tr>
                ))}
              </tbody>
            </table>
          </Loading>
        </Panel>
      )}

      {tab === "ds" && (
        <Panel title="数据源授权与开关" sub="签证/护照数据为第三方专有；授权五要件（提供方/范围/合同期/节拍/署名）齐全且合同有效才允许开启；开关切换写审计。">
          <Loading {...ds} empty={(ds.data?.records.length ?? 0) === 0}>
            <div className="space-y-3">
              {ds.data?.records.map((d) => (
                <div key={d.key} className="rounded-xl border border-line p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[12.5px] font-bold">{d.key}</div>
                    <Badge state={d.state === "on" ? "published" : "suspended"} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-[12px]">
                    <div className="text-faint">提供方：<span className="text-ink">{d.provider ?? "—"}</span></div>
                    <div className="text-faint">授权范围：<span className="text-ink">{d.scope ?? "—"}</span></div>
                    <div className="text-faint">合同期至：<span className="text-ink">{d.contractValidUntil ? d.contractValidUntil.slice(0, 10) : "—"}</span></div>
                  </div>
                  <div className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-[11.5px] text-warn leading-relaxed">{d.note}</div>
                </div>
              ))}
            </div>
          </Loading>
        </Panel>
      )}
    </div>
  );
}

/* ============== A02 供给准入（境内机构） ============== */

interface EntityRow { id: string; name: string; creditCode: string; filingNo: string | null; filingExpiresAt: string | null; displayStatus: string; usable: boolean; daysToExpiry: number | null }

export function A02Supply({ actor }: { actor: Actor }) {
  const ent = useApi<{ records: EntityRow[] }>("/admin/entities", actor);
  return (
    <div className="rise">
      <Panel title="境内机构最小台账" sub="无备案编号/有效期不可置有效；临期 60/30/7 天提醒；过期即不可用于入驻与新授权（境外持牌方在 M3 受控门户扩展）。">
        <Loading {...ent} empty={(ent.data?.records.length ?? 0) === 0}>
          <table className="w-full">
            <thead><tr><Th w="8%">编号</Th><Th>机构名称</Th><Th w="15%">统一社会信用代码</Th><Th w="14%">备案编号</Th><Th w="12%">备案有效期</Th><Th w="11%">派生状态</Th><Th w="9%">可用</Th></tr></thead>
            <tbody>
              {ent.data?.records.map((e) => (
                <tr key={e.id}>
                  <Td mono>{e.id}</Td><Td>{e.name}</Td><Td mono>{e.creditCode}</Td><Td mono>{e.filingNo ?? "—"}</Td>
                  <Td>{e.filingExpiresAt ? e.filingExpiresAt.slice(0, 10) : "—"}{e.daysToExpiry !== null && e.daysToExpiry >= 0 && e.usable ? <span className="text-faint text-[11px]">（剩 {e.daysToExpiry} 天）</span> : null}</Td>
                  <Td><Badge state={e.displayStatus} /></Td>
                  <Td>{e.usable ? <span className="text-ok font-semibold text-[12px]">可用</span> : <span className="text-bad font-semibold text-[12px]">停用</span>}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>
    </div>
  );
}

/* ============== A03 顾问管理 ============== */

interface OnboardingRow { id: string; advisorUserId: string; realName: string; entityId: string; state: string; selfIntroApproved: boolean; commitments: Record<string, string | null>; trainingConfirmedAt: string | null }
interface GrantRow { id: string; advisorUserId: string; projectCode: string; state: string; grantedDays: number | null; expiresAt: string | null }

export function A03Advisors({ actor }: { actor: Actor }) {
  const ob = useApi<{ records: OnboardingRow[] }>("/admin/advisors/onboarding", actor);
  const gr = useApi<{ records: GrantRow[] }>("/admin/advisors/grants", actor);
  return (
    <div className="rise space-y-5">
      <Panel title="顾问入驻审核" sub="门：机构有效 + 材料齐 + 四承诺逐条签署 + 通识培训 + 自述过词库；自述通过审核后名片才展示。">
        <Loading {...ob} empty={(ob.data?.records.length ?? 0) === 0}>
          <table className="w-full">
            <thead><tr><Th w="9%">申请号</Th><Th w="10%">顾问</Th><Th>姓名</Th><Th w="9%">机构</Th><Th w="12%">入驻状态</Th><Th w="10%">承诺签署</Th><Th w="9%">培训</Th><Th w="11%">自述审核</Th></tr></thead>
            <tbody>
              {ob.data?.records.map((o) => (
                <tr key={o.id}>
                  <Td mono>{o.id}</Td><Td mono>{o.advisorUserId}</Td><Td>{o.realName}</Td><Td mono>{o.entityId}</Td>
                  <Td><Badge state={o.state} /></Td>
                  <Td>{Object.values(o.commitments).filter(Boolean).length}/4</Td>
                  <Td>{o.trainingConfirmedAt ? "已确认" : "未确认"}</Td>
                  <Td><Badge state={o.selfIntroApproved ? "approved" : "draft"} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>
      <Panel title="项目授权（五步 + 重确认 + 到期停新接旧）" sub="三份必读逐项确认不可跳步；有效期=min(申请天数, 机构备案剩余)，上限 730 天；审批人≠申请人；项目新版发布转待重确认。">
        <Loading {...gr} empty={(gr.data?.records.length ?? 0) === 0}>
          <table className="w-full">
            <thead><tr><Th w="11%">授权号</Th><Th w="11%">顾问</Th><Th w="13%">项目</Th><Th w="15%">状态</Th><Th w="9%">天数</Th><Th w="13%">到期日</Th></tr></thead>
            <tbody>
              {gr.data?.records.map((g) => (
                <tr key={g.id}>
                  <Td mono>{g.id}</Td><Td mono>{g.advisorUserId}</Td><Td mono>{g.projectCode}</Td>
                  <Td><Badge state={g.state} /></Td><Td>{g.grantedDays ?? "—"}</Td>
                  <Td>{g.expiresAt ? g.expiresAt.slice(0, 10) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>
    </div>
  );
}

/* ============== A11 质量基线 ============== */

interface QualityDashboard {
  caliberVersion: string;
  generatedAt: string;
  content: {
    publishedProjects: number;
    verificationCoverage: { note?: string; verified?: number; total?: number; rate?: number; due?: number; invalid?: number };
    publishCycleHoursMedian: { note?: string } | number;
    suspendedOrDelisted: number;
  };
  entities: { active: number; dueSoon: number; unusable: number };
  advisors: {
    onboarding: Record<string, number>;
    grants: Record<string, number>;
  };
  assessmentFunnel: { started: number; completed: { note?: string } | number; completionRate: { note?: string } | number | null; note: string };
  prohibited: string[];
}

function asSample(v: unknown): string {
  if (typeof v === "object" && v && "note" in v) return (v as { note: string }).note;
  return String(v);
}

export function A11Quality({ actor }: { actor: Actor }) {
  const q = useApi<QualityDashboard>("/admin/quality/dashboard", actor);
  const d = q.data;
  return (
    <div className="rise space-y-5">
      <Panel title="影子期质量基线（只读）" sub={d ? `口径版本 ${d.caliberVersion} · 生成于 ${d.generatedAt.slice(0, 16).replace("T", " ")} · 只建基线不设目标，样本 <5 显"样本积累中"` : "口径版本化，不设目标"}>
        <Loading {...q} empty={!d}>
          {d && (
            <div className="space-y-5">
              <div className="grid grid-cols-4 gap-4">
                <MiniStat label="已发布项目" value={String(d.content.publishedProjects)} />
                <MiniStat label="核验覆盖率" value={d.content.verificationCoverage.note ?? `${d.content.verificationCoverage.verified}/${d.content.verificationCoverage.total}（${((d.content.verificationCoverage.rate ?? 0) * 100).toFixed(0)}%）`} tone={d.content.verificationCoverage.invalid ? "bad" : "ok"} />
                <MiniStat label="临期/失效事实" value={d.content.verificationCoverage.note ? "—" : `${d.content.verificationCoverage.due ?? 0} / ${d.content.verificationCoverage.invalid ?? 0}`} tone={(d.content.verificationCoverage.invalid ?? 0) > 0 ? "bad" : "default"} />
                <MiniStat label="发布周期中位数（小时）" value={asSample(d.content.publishCycleHoursMedian)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <MiniStat label="机构 可用/临期/停用" value={`${d.entities.active} / ${d.entities.dueSoon} / ${d.entities.unusable}`} />
                <MiniStat label="入驻 草稿/待审/通过/驳回" value={`${d.advisors.onboarding.draft ?? 0} / ${d.advisors.onboarding.submitted ?? 0} / ${d.advisors.onboarding.approved ?? 0} / ${d.advisors.onboarding.rejected ?? 0}`} />
                <MiniStat label="授权 有效/临期/过期/待重确认" value={`${d.advisors.grants.authorized ?? 0} / ${d.advisors.grants.expiring ?? 0} / ${d.advisors.grants.expired ?? 0} / ${d.advisors.grants.reconfirm_required ?? 0}`} />
              </div>
              <div className="rounded-xl border border-line p-4">
                <div className="text-[12.5px] font-bold mb-2">初评漏斗（聚合，不可识别个人）</div>
                <div className="text-[12px] text-mut">开始 {d.assessmentFunnel.started} 次 · 完成 {asSample(d.assessmentFunnel.completed)} · 完成率 {d.assessmentFunnel.completionRate === null ? "—" : asSample(d.assessmentFunnel.completionRate)}</div>
                <div className="text-[11px] text-faint mt-1">{d.assessmentFunnel.note}</div>
              </div>
              <div className="rounded-xl bg-bad-bg px-4 py-3 text-[11.5px] text-bad leading-relaxed">
                本看板明确禁止：{d.prohibited.join("、")}。
              </div>
            </div>
          )}
        </Loading>
      </Panel>
    </div>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "ok" | "bad" }) {
  const c = tone === "ok" ? "text-ok" : tone === "bad" ? "text-bad" : "text-navy";
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-[11.5px] text-faint leading-snug">{label}</div>
      <div className={`text-[20px] font-extrabold tracking-tight mt-1.5 ${c}`}>{value}</div>
    </div>
  );
}

/* ============== A04 关系分配 ============== */

interface ConsultationRow { id: string; source: string; state: string; projectCode: string | null; advisorId: string | null; customerRef: string; questionnaireGranted: boolean; conflictReason: string | null }
interface RelationshipRow { id: string; customerRef: string; advisorId: string; state: string; customerEventAt: string | null; customerConfirmedAt: string | null; advisorAcceptedAt: string | null }

export function A04Assign({ actor }: { actor: Actor }) {
  const [tab, setTab] = useState<"queue" | "rel">("queue");
  const [tick, setTick] = useState(0);
  const queue = useApi<{ records: ConsultationRow[] }>("/admin/engagements/queue", actor, [tab, tick]);
  const rels = useApi<{ records: RelationshipRow[] }>("/admin/engagements/relationships", actor, [tab, tick]);
  const post = async (path: string, body?: unknown) => {
    await api(path, actor, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    setTick((t) => t + 1);
  };

  return (
    <div className="rise space-y-5">
      <div className="flex gap-1.5">
        {([["queue", "咨询队列（五来源）"], ["rel", "双向关系"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 h-9 rounded-full text-[12.5px] font-semibold transition ${tab === k ? "bg-navy text-white shadow-sh1" : "bg-white border border-line text-mut hover:border-navy/40"}`}>{label}</button>
        ))}
      </div>

      {tab === "queue" && (
        <Panel title="咨询队列" sub="名片/预约/分享只产生待分配咨询，不成立关系、不授权问卷；平台分配须客户确认后顾问才可接受；冲突未裁决锁方案/订单。">
          <Loading {...queue} empty={(queue.data?.records.length ?? 0) === 0}>
            <table className="w-full">
              <thead><tr><Th w="12%">咨询号</Th><Th w="13%">来源</Th><Th w="13%">状态</Th><Th w="12%">项目</Th><Th w="12%">顾问</Th><Th>操作</Th></tr></thead>
              <tbody>
                {queue.data?.records.map((c) => (
                  <tr key={c.id}>
                    <Td mono>{c.id}</Td><Td>{c.source}</Td><Td><Badge state={c.state} /></Td>
                    <Td mono>{c.projectCode ?? "—"}</Td><Td mono>{c.advisorId ?? "—"}</Td>
                    <Td>
                      {c.state === "pending_assign" && (
                        <button className="text-[12px] font-semibold text-navy hover:underline" onClick={() => { const a = window.prompt("分配给顾问 id（如 adv-chen）"); if (a) void post(`/admin/engagements/${c.id}/assign`, { advisorId: a.trim() }); }}>分配顾问</button>
                      )}
                      {c.state === "conflict_pending" && (
                        <button className="text-[12px] font-semibold text-bad hover:underline" onClick={() => { const a = window.prompt("裁决：保留顾问 id（留空=平台另行分配）"); const r = window.prompt("裁决原因"); if (r) void post(`/admin/engagements/${c.id}/resolve-conflict`, { advisorId: a?.trim() || null, reason: r }); }}>冲突裁决</button>
                      )}
                      {!["pending_assign", "conflict_pending"].includes(c.state) && <span className="text-[11.5px] text-faint">—</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Loading>
        </Panel>
      )}

      {tab === "rel" && (
        <Panel title="双向关系（一名客户一名主责）" sub="客户事件 + 顾问接受双向成立；换顾问/转分配必填原因；到期停新接旧。">
          <Loading {...rels} empty={(rels.data?.records.length ?? 0) === 0}>
            <table className="w-full">
              <thead><tr><Th w="13%">关系号</Th><Th w="12%">客户</Th><Th w="12%">顾问</Th><Th w="12%">状态</Th><Th w="20%">客户事件</Th><Th>顾问接受</Th></tr></thead>
              <tbody>
                {rels.data?.records.map((r) => (
                  <tr key={r.id}>
                    <Td mono>{r.id}</Td><Td mono>{r.customerRef}</Td><Td mono>{r.advisorId}</Td><Td><Badge state={r.state} /></Td>
                    <Td>{r.customerEventAt ? r.customerEventAt.slice(0, 16).replace("T", " ") : "—"}</Td>
                    <Td>{r.advisorAcceptedAt ? r.advisorAcceptedAt.slice(0, 16).replace("T", " ") : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Loading>
        </Panel>
      )}
    </div>
  );
}

/* ============== A05 报价与合同 ============== */

interface ReviewRow { id: string; revision: number; state: string; customerRef: string; projectCode: string; authorId: string; validUntil: string; feeSnapshot: Array<{ label: string; nature: string; collector: string; currency: string; amountMinor: string | null; certainty: string }> }
interface OrderRow { id: string; customerRef: string; projectCode: string; contractState: string; freezeStatus: string | null; advisorId: string; subject: { status: string } }
interface TemplateRow2 { id: string; title: string; state: string; fiveElements: { scope: boolean; refund: boolean; overseasNotice: boolean; guarantee: boolean; privacy: boolean } }

export function A05Contract({ actor }: { actor: Actor }) {
  const [tab, setTab] = useState<"review" | "orders" | "tpl">("review");
  const [tick, setTick] = useState(0);
  const review = useApi<{ records: ReviewRow[] }>("/admin/proposals/review-queue", actor, [tab, tick]);
  const orders = useApi<{ records: OrderRow[] }>("/admin/orders", actor, [tab, tick]);
  const tpls = useApi<{ records: TemplateRow2[] }>("/admin/contract-templates", actor, [tab, tick]);
  const post = async (path: string, body?: unknown) => {
    await api(path, actor, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    setTick((t) => t + 1);
  };

  return (
    <div className="rise space-y-5">
      <div className="flex gap-1.5">
        {([["review", "方案复核队列"], ["orders", "订单与主体门"], ["tpl", "合同模板（五要素）"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 h-9 rounded-full text-[12.5px] font-semibold transition ${tab === k ? "bg-navy text-white shadow-sh1" : "bg-white border border-line text-mut hover:border-navy/40"}`}>{label}</button>
        ))}
      </div>

      {tab === "review" && (
        <Panel title="报价复核（四眼 + 大额第二复核）" sub="复核人≠编制人；偏离仅限减免/分期且选自标准费表；减免超阈值（影子期配置 10%）须第二复核人且三人互异；驳回必填原因。">
          <Loading {...review} empty={(review.data?.records.length ?? 0) === 0}>
            <div className="space-y-3">
              {review.data?.records.map((p) => (
                <div key={p.id} className="rounded-xl border border-line p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12.5px]">
                      <span className="font-mono font-bold">{p.id}</span>
                      <span className="text-faint"> · rev{p.revision} · {p.customerRef} · {p.projectCode} · 编制 {p.authorId}</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button className="px-3 h-8 rounded-full bg-ok-bg text-ok text-[12px] font-semibold" onClick={() => void post(`/admin/proposals/${p.id}/approve`)}>复核通过</button>
                      <button className="px-3 h-8 rounded-full bg-bad-bg text-bad text-[12px] font-semibold" onClick={() => { const r = window.prompt("驳回原因（逐条）"); if (r) void post(`/admin/proposals/${p.id}/reject`, { reasons: r.split(/[；;\n]/).map((x) => x.trim()).filter(Boolean) }); }}>驳回</button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {p.feeSnapshot.map((f) => (
                      <div key={f.label} className="rounded-lg bg-line-soft px-3 py-2 text-[11.5px]">
                        <div className="font-semibold">{f.label}</div>
                        <div className="text-faint mt-0.5">{f.collector} · {f.certainty}</div>
                        <div className="font-mono mt-0.5">{f.currency} {f.amountMinor ?? "tbc"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Loading>
        </Panel>
      )}

      {tab === "orders" && (
        <Panel title="订单推进：主体三要素门 → 签署登记 → 生效" sub="门不过留差异、无强制通过；签署核验人≠顾问；生效受 D 门控制（影子环境放行）；24h 内 ≥3 次阻断告警。">
          <Loading {...orders} empty={(orders.data?.records.length ?? 0) === 0}>
            <div className="space-y-3">
              {orders.data?.records.map((o) => (
                <div key={o.id} className="rounded-xl border border-line p-4 flex items-center justify-between gap-3">
                  <div className="text-[12.5px]">
                    <span className="font-mono font-bold">{o.id}</span>
                    <span className="text-faint"> · {o.customerRef} · {o.projectCode} · 顾问 {o.advisorId}</span>
                    <div className="mt-1 flex gap-2 items-center"><Badge state={o.contractState} /><Badge state={o.subject.status} />{o.freezeStatus && <Badge state={o.freezeStatus} />}</div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {o.subject.status === "unchecked" && <button className="px-3 h-8 rounded-full bg-navy text-white text-[12px] font-semibold" onClick={() => void post(`/admin/orders/${o.id}/subject-check`)}>主体门核验</button>}
                    {o.subject.status === "passed" && o.contractState === "gate_passed" && (
                      <button className="px-3 h-8 rounded-full bg-navy text-white text-[12px] font-semibold" onClick={async () => {
                        const list = await api<{ records: TemplateRow2[] }>("/admin/contract-templates", actor);
                        const t = list.records.find((x) => x.state === "published");
                        if (!t) { window.alert("无已发布合同模板"); return; }
                        await post(`/admin/orders/${o.id}/signing/start`, { templateId: t.id });
                        // 三条 Consent（客户身份头模拟）
                        for (const k of ["fees", "non_commitment", "privacy"]) {
                          await fetch(`/v1/orders/${o.id}/consents`, { method: "POST", headers: { "content-type": "application/json", "x-tip-realm": "customer", "x-tip-user": o.customerRef }, body: JSON.stringify({ key: k }) });
                        }
                        await post(`/admin/orders/${o.id}/contract/register`, { signedAt: new Date().toISOString(), artifactRef: "L3://demo-contract.pdf", method: "offline", registrarId: actor.user });
                        await post(`/admin/orders/${o.id}/make-effective`);
                      }}>签署登记并生效</button>
                    )}
                    {(o.contractState === "effective" || o.subject.status === "blocked") && <span className="text-[11.5px] text-faint">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </Loading>
        </Panel>
      )}

      {tab === "tpl" && (
        <Panel title="合同模板（五要素齐备才可发布）" sub="服务范围/退款规则/境外告知/不保证条款/隐私条款；模板内容编辑走文档流程，本页只做状态与要素核验。">
          <Loading {...tpls} empty={(tpls.data?.records.length ?? 0) === 0}>
            <table className="w-full">
              <thead><tr><Th w="14%">编号</Th><Th>标题</Th><Th w="12%">状态</Th><Th w="12%">服务范围</Th><Th w="12%">退款</Th><Th w="12%">境外告知</Th><Th w="12%">不保证</Th><Th w="10%">隐私</Th></tr></thead>
              <tbody>
                {tpls.data?.records.map((t) => (
                  <tr key={t.id}>
                    <Td mono>{t.id}</Td><Td>{t.title}</Td><Td><Badge state={t.state} /></Td>
                    {(["scope", "refund", "overseasNotice", "guarantee", "privacy"] as const).map((k) => (
                      <Td key={k}>{t.fiveElements[k] ? <span className="text-ok font-semibold">齐</span> : <span className="text-bad font-semibold">缺</span>}</Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Loading>
        </Panel>
      )}
    </div>
  );
}


interface TemplateRow { id: string; kind: string; code: string; version: number; title: string; state: string; authorId: string; reviewerId: string | null }
interface RulesetRow { id: string; projectCode: string; version: number; state: string; editorId: string; reviewerId: string | null }

export function A12Compliance({ actor }: { actor: Actor }) {
  const tpl = useApi<{ records: TemplateRow[] }>("/admin/assessment/templates", actor);
  const rs = useApi<{ records: RulesetRow[] }>("/admin/assessment/rulesets", actor);
  return (
    <div className="rise space-y-5">
      <Panel title="初评问卷 / 结论模板版本" sub="assessment 生产点过词库；四眼复核；客户端只加载已发布版本并显示版本号。">
        <Loading {...tpl} empty={(tpl.data?.records.length ?? 0) === 0}>
          <table className="w-full">
            <thead><tr><Th w="14%">类型</Th><Th w="10%">编码</Th><Th>标题</Th><Th w="7%">版本</Th><Th w="12%">状态</Th><Th w="9%">编辑</Th><Th w="9%">复核人</Th></tr></thead>
            <tbody>
              {tpl.data?.records.map((t) => (
                <tr key={t.id}>
                  <Td>{t.kind === "questionnaire" ? "问卷" : "结论模板"}</Td><Td mono>{t.code}</Td><Td>{t.title}</Td><Td mono>v{t.version}</Td>
                  <Td><Badge state={t.state} /></Td><Td mono>{t.authorId}</Td><Td mono>{t.reviewerId ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>
      <Panel title="初评规则集（随项目版本）" sub="每维度必须挂核验证据；发布门=证据全部 verified 且核验人≠规则集编辑人；无规则集项目对客显示暂无匹配路径。">
        <Loading {...rs} empty={(rs.data?.records.length ?? 0) === 0}>
          <table className="w-full">
            <thead><tr><Th w="12%">编号</Th><Th w="14%">项目</Th><Th w="8%">版本</Th><Th w="14%">状态</Th><Th w="10%">编辑</Th><Th w="10%">复核人</Th></tr></thead>
            <tbody>
              {rs.data?.records.map((r) => (
                <tr key={r.id}><Td mono>{r.id}</Td><Td mono>{r.projectCode}</Td><Td mono>v{r.version}</Td><Td><Badge state={r.state} /></Td><Td mono>{r.editorId}</Td><Td mono>{r.reviewerId ?? "—"}</Td></tr>
              ))}
            </tbody>
          </table>
        </Loading>
      </Panel>
    </div>
  );
}
