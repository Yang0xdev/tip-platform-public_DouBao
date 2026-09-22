import { useEffect, useState } from "react";
import { api, LS_ACTOR, type Actor, type MachinesMeta, type AuditVerify, type FeatureFlag } from "./api.js";
import { A01Content, A02Supply, A03Advisors, A11Quality, A12Compliance } from "./modules.js";

/* ---------------- 模块地图（与总后台高保真、PRD 一致） ---------------- */
const MODULES = [
  { code: "A01", name: "内容治理", prd: "M1", desc: "项目版本 · 核验台账 · 收费方案 · 四眼发布 · 数据源" },
  { code: "A02", name: "供给准入", prd: "M3", desc: "境内主体 · 境外持牌方 · 自营交付部 · 资质临期" },
  { code: "A03", name: "顾问管理", prd: "M1", desc: "入驻审核 · 学习考试 · 授权五步 · 停新接旧" },
  { code: "A04", name: "关系分配", prd: "M2", desc: "咨询队列 · 双向关系 · 冲突裁决 · 交接五步" },
  { code: "A05", name: "报价与合同", prd: "M2", desc: "方案复核 · 主体三要素门 · 合同登记 · 模板" },
  { code: "A06", name: "交付看板", prd: "M3", desc: "案件阶段 · 凭据核验 · 门户批次 · T0 时钟" },
  { code: "A07", name: "财务结算", prd: "M4", desc: "凭证核验 · 收据 · 退款双人 · 佣金六态" },
  { code: "A08", name: "工单投诉", prd: "M4", desc: "独立队列 · 回避分派 · SLA 升级 · 回访" },
  { code: "A09", name: "通知治理", prd: "M3/M4", desc: "模板审核 · 送达回执 · 换道升级 · T2 退订" },
  { code: "A10", name: "权限审计", prd: "M4", desc: "角色矩阵 · 审批中心 · Consent 台账 · 哈希链" },
  { code: "A11", name: "质量基线", prd: "M1", desc: "核验覆盖率 · 临期率 · 授权节拍 · 初评漏斗（只读基线）" },
  { code: "A12", name: "合规工作台", prd: "M1", desc: "问卷/结论模板 · 规则集四眼 · 词库（M1 子集）" }
];

const DOOR_LABELS: Record<string, string> = {
  transaction: "交易（合同/支付）",
  portal_cross_border: "门户跨境共享",
  settlement: "佣金结算",
  esign: "电子签通道",
  global_access: "全球通行真实数据",
  t2_marketing: "T2 营销消息"
};

/* ---------------- 登录 ---------------- */
function Login({ onLogin }: { onLogin: (a: Actor) => void }) {
  const [user, setUser] = useState("admin01");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user.trim()) return;
    setLoading(true);
    setError(null);
    const actor: Actor = { user: user.trim(), realm: "staff" };
    try {
      // 不假成功：必须真实连通后端并通过 realm 守卫
      await api<MachinesMeta>("/v1/_meta/machines", actor);
      localStorage.setItem(LS_ACTOR, JSON.stringify(actor));
      onLogin(actor);
    } catch (err) {
      setError(`无法连接后端或身份被拒：${(err as Error).message}。请先启动 services/api（pnpm --filter @tip/api start）。`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full signature-bg flex items-center justify-center p-6">
      <div className="rise w-full max-w-[420px]">
        <div className="card p-9">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-xl signature-bg flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <div className="text-[17px] font-bold tracking-tight">透明身份规划平台</div>
              <div className="text-[12.5px] text-faint">统一总后台 · 受控运营</div>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-semibold text-mut mb-1.5">员工账号</label>
              <input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="w-full h-11 rounded-xl border border-line px-3.5 text-[14.5px] outline-none focus:border-navy focus:ring-2 focus:ring-navy-50 transition"
                placeholder="员工标识"
              />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-mut mb-1.5">密码 + MFA 二次验证</label>
              <input
                type="password"
                defaultValue="dev-placeholder"
                disabled
                className="w-full h-11 rounded-xl border border-line bg-line-soft px-3.5 text-[14.5px] text-faint"
              />
              <p className="text-[11.5px] text-faint mt-1.5">M0 为开发环境头模拟；M1 接入 Keycloak 员工 realm 与 MFA。</p>
            </div>
            {error && <div className="text-[12.5px] text-bad bg-bad-bg rounded-lg px-3 py-2 leading-relaxed">{error}</div>}
            <button disabled={loading} className="btn-navy w-full h-11 rounded-btn text-white font-semibold text-[14.5px] disabled:opacity-60">
              {loading ? "正在验证…" : "登录总后台"}
            </button>
          </form>
          <div className="mt-6 pt-5 border-t border-line-soft text-[11.5px] text-faint leading-relaxed">
            所有操作进入只追加审计哈希链；越权访问将被服务端拒绝并留痕。
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 后台外壳 ---------------- */
function Shell({ actor, onLogout }: { actor: Actor; onLogout: () => void }) {
  const [active, setActive] = useState<string>("home");
  const [meta, setMeta] = useState<MachinesMeta | null>(null);
  const [audit, setAudit] = useState<AuditVerify | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[] | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<MachinesMeta>("/v1/_meta/machines", actor),
      api<AuditVerify>("/v1/_meta/audit/verify", actor),
      api<{ flags: FeatureFlag[] }>("/v1/_meta/feature-flags", actor)
    ])
      .then(([m, a, f]) => { setMeta(m); setAudit(a); setFlags(f.flags); })
      .catch((e: Error) => setApiError(e.message));
  }, [actor]);

  return (
    <div className="min-h-full flex">
      <aside className="w-[232px] shrink-0 bg-navy text-white flex flex-col" style={{ background: "linear-gradient(180deg,#002661 0%,#041d47 100%)" }}>
        <div className="px-5 h-[64px] flex items-center gap-2.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg signature-bg flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-[18px]" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          </div>
          <div className="text-[13.5px] font-bold leading-tight">透明身份规划<br /><span className="text-white/60 font-medium text-[11px]">统一总后台</span></div>
        </div>
        <nav className="flex-1 overflow-y-auto py-3">
          <button onClick={() => setActive("home")} className={`w-full text-left px-5 py-2.5 text-[13px] flex items-center gap-2.5 transition ${active === "home" ? "bg-white/12 font-semibold border-l-[3px] border-berry-light" : "border-l-[3px] border-transparent text-white/75 hover:bg-white/5"}`}>
            <span className="text-[11px] font-mono text-white/40">00</span>工作台
          </button>
          <div className="px-5 pt-4 pb-1 text-[10.5px] tracking-[0.14em] text-white/35 font-semibold">控制模块</div>
          {MODULES.map((m) => (
            <button key={m.code} onClick={() => setActive(m.code)} className={`w-full text-left px-5 py-2.5 text-[13px] flex items-center gap-2.5 transition ${active === m.code ? "bg-white/12 font-semibold border-l-[3px] border-berry-light" : "border-l-[3px] border-transparent text-white/75 hover:bg-white/5"}`}>
              <span className="text-[11px] font-mono text-berry-light/90 w-7">{m.code}</span>
              <span>{m.name}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10 text-[11px] text-white/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-ok bg-[#3fbf91]" />
            {actor.user} · staff
          </div>
          <button onClick={onLogout} className="mt-2 text-white/60 hover:text-white underline-offset-2 hover:underline">退出登录</button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="h-[64px] bg-white border-b border-line px-7 flex items-center justify-between shrink-0">
          <div>
            <div className="text-[15px] font-bold">{active === "home" ? "运营工作台" : MODULES.find((m) => m.code === active)?.name}</div>
            <div className="text-[11.5px] text-faint">M1 内容治理与初评 · 冻结 PRD v1.0 · 影子环境</div>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-mut">
            <span className="px-2.5 py-1 rounded-full bg-navy-50 text-navy font-semibold">影子环境</span>
            <span>{new Date().toLocaleDateString("zh-CN")}</span>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-7">
          {apiError && (
            <div className="mb-5 rounded-card border border-bad/30 bg-bad-bg px-4 py-3 text-[13px] text-bad">后端连接失败：{apiError}（状态机与审计数据不可用，不使用模拟数据顶替）</div>
          )}
          {active === "home" && <Home meta={meta} audit={audit} flags={flags} />}
          {active === "A01" && <A01Content actor={actor} />}
          {active === "A02" && <A02Supply actor={actor} />}
          {active === "A03" && <A03Advisors actor={actor} />}
          {active === "A11" && <A11Quality actor={actor} />}
          {active === "A12" && <A12Compliance actor={actor} />}
          {!["home", "A01", "A02", "A03", "A11", "A12"].includes(active) && <ModulePlaceholder code={active} />}
        </div>
      </main>
    </div>
  );
}

function Home({ meta, audit, flags }: { meta: MachinesMeta | null; audit: AuditVerify | null; flags: FeatureFlag[] | null }) {
  const onCount = flags?.filter((f) => f.state === "on").length ?? 0;
  return (
    <div className="rise space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <Stat label="领域状态机（@tip/core）" value={meta ? String(meta.machines.length) : "—"} sub="前后端共用唯一真源" tone="navy" />
        <Stat label="审计哈希链校验" value={audit?.ok ? "完整" : audit ? "断链" : "—"} sub={audit?.ok ? `${audit.count} 条记录` : "每日自动校验"} tone={audit?.ok ? "ok" : "warn"} />
        <Stat label="合规决策门开启" value={flags ? `${onCount} / ${flags.length}` : "—"} sub="D 门/Q6 拍板前默认全关" tone="berry" />
        <Stat label="当前阶段" value="M1" sub="内容治理与初步评估" tone="navy" />
      </div>

      <div className="grid grid-cols-3 gap-5">
        <section className="card p-5 col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14.5px] font-bold">控制模块地图</h2>
            <span className="text-[11.5px] text-faint">点击进入（M1 起逐个交付）</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {MODULES.map((m) => (
              <div key={m.code} className="rounded-xl border border-line p-3.5 hover:border-navy/40 hover:-translate-y-0.5 hover:shadow-sh1 transition cursor-default">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-berry font-bold">{m.code}</span>
                  <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-line-soft text-faint font-semibold">{m.prd}</span>
                </div>
                <div className="text-[13.5px] font-semibold mt-1.5">{m.name}</div>
                <div className="text-[11.5px] text-faint mt-1 leading-relaxed">{m.desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[14.5px] font-bold mb-1">特性开关（决策门）</h2>
          <p className="text-[11.5px] text-faint mb-4">门未开时相关路由与入口在服务端关闭，非前端隐藏。</p>
          <div className="space-y-2.5">
            {(flags ?? []).map((d) => (
              <div key={d.key} className="flex items-center justify-between rounded-xl bg-line-soft px-3.5 py-2.5">
                <div>
                  <div className="text-[12.5px] font-semibold">{DOOR_LABELS[d.key] ?? d.key}</div>
                  <div className="text-[10.5px] text-faint font-mono">{d.doorRef}</div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${d.state === "on" ? "bg-ok-bg text-ok" : d.state === "shadow" ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"}`}>
                  {d.state === "on" ? "ON" : d.state === "shadow" ? "影子" : "OFF"}
                </span>
              </div>
            ))}
            {!flags && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[46px] rounded-xl bg-line-soft animate-pulse" />
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-navy-50 px-3.5 py-3 text-[11.5px] text-navy leading-relaxed">
            示例数据仅存在于 dev/test；生产发布流水线含示例数据扫描，命中即阻断。
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "navy" | "ok" | "warn" | "berry" }) {
  const tones = { navy: "text-navy", ok: "text-ok", warn: "text-warn", berry: "text-berry" };
  return (
    <div className="card p-5">
      <div className="text-[12px] text-mut">{label}</div>
      <div className={`text-[28px] font-extrabold tracking-tight mt-1 ${tones[tone]}`}>{value}</div>
      <div className="text-[11px] text-faint mt-0.5">{sub}</div>
    </div>
  );
}

function ModulePlaceholder({ code }: { code: string }) {
  const m = MODULES.find((x) => x.code === code)!;
  return (
    <div className="card p-10 max-w-2xl">
      <div className="font-mono text-[12px] text-berry font-bold">{m.code}</div>
      <h2 className="text-[18px] font-bold mt-1">{m.name}</h2>
      <p className="text-[13px] text-mut mt-2 leading-relaxed">{m.desc}。</p>
      <div className="mt-5 rounded-xl bg-navy-50 px-4 py-3 text-[12.5px] text-navy">
        本模块在里程碑 <b>{m.prd}</b> 按冻结 PRD 交付（状态机、接口、闸门、AT 验收已在 <code>02-功能设计/PRD/</code> 固定）。M0 阶段不提前放置半成品页面。
      </div>
    </div>
  );
}

export default function App() {
  const [actor, setActor] = useState<Actor | null>(() => {
    const raw = localStorage.getItem(LS_ACTOR);
    return raw ? (JSON.parse(raw) as Actor) : null;
  });
  return actor ? <Shell actor={actor} onLogout={() => { localStorage.removeItem(LS_ACTOR); setActor(null); }} /> : <Login onLogin={setActor} />;
}
