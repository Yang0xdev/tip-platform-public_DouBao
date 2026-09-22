import { useEffect, useState } from "react";
import { api, type Actor } from "./api.js";

/* ============== 通用小组件 ============== */

function useApi<T>(path: string, actor: Actor, deps: unknown[] = []) {
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

function Badge({ state }: { state: string }) {
  return (
    <span className={`inline-block text-[10.5px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATE_TONE[state] ?? "bg-line-soft text-faint"}`}>
      {state}
    </span>
  );
}

function Panel({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
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

function Loading({ error, loading, empty, children }: { error: string | null; loading: boolean; empty?: boolean; children: React.ReactNode }) {
  if (loading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 rounded-xl bg-line-soft animate-pulse" />)}</div>;
  if (error) return <div className="rounded-xl border border-bad/30 bg-bad-bg px-4 py-3 text-[12.5px] text-bad">{error}</div>;
  if (empty) return <div className="rounded-xl bg-line-soft px-4 py-8 text-center text-[12.5px] text-faint">暂无数据（影子期种子为空，所有数据由真实操作产生）</div>;
  return <>{children}</>;
}

function Th({ children, w }: { children: React.ReactNode; w?: string }) {
  return <th style={w ? { width: w } : undefined} className="text-left text-[11px] font-semibold text-faint pb-2.5 pr-3">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
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

/* ============== A12 合规工作台（M1 子集） ============== */

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
