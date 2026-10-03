import { useCallback, useEffect, useState } from "react";
import { call, type PdfResult, type ReaderOpened, type VisibleCase } from "./api.js";

/* ================= 登录 ================= */

function Login({ onLogin }: { onLogin: (login: string) => void }) {
  const [login, setLogin] = useState("PA-DEMO");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function enter() {
    if (!login.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await call(login.trim(), "/portal/profile");
      onLogin(login.trim());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-card bg-white shadow-sh2 p-8">
        <div className="h-12 w-12 rounded-xl signature-bg flex items-center justify-center text-white font-extrabold text-lg">门</div>
        <h1 className="mt-5 text-xl font-extrabold">服务方门户</h1>
        <p className="mt-2 text-[13px] text-mut leading-6">
          仅限已签约服务方使用。可见范围以平台批次授权为准，所有阅读行为带水印并留痕。
        </p>
        <label className="block mt-6 text-[12.5px] font-semibold text-mut">门户账号</label>
        <input
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && enter()}
          className="mt-2 h-11 w-full rounded-btn border border-line px-4 text-[14px] outline-none focus:border-berry"
          placeholder="如 PA-DEMO"
        />
        {err && <p className="mt-3 text-[12.5px] text-bad">{err}</p>}
        <button
          onClick={enter}
          disabled={busy}
          className="btn-navy mt-6 h-11 w-full rounded-btn text-white text-[14px] font-bold disabled:opacity-60"
        >
          {busy ? "验证中…" : "登录门户"}
        </button>
      </div>
    </div>
  );
}

/* ================= 小组件 ================= */

function CasePicker({
  cases,
  caseId,
  setCaseId,
  scope,
  setScope
}: {
  cases: VisibleCase[];
  caseId: string;
  setCaseId: (v: string) => void;
  scope: string;
  setScope: (v: string) => void;
}) {
  const current = cases.find((c) => c.caseId === caseId);
  return (
    <div className="grid grid-cols-2 gap-3">
      <select
        value={caseId}
        onChange={(e) => {
          setCaseId(e.target.value);
          const c = cases.find((x) => x.caseId === e.target.value);
          if (c && !c.scopes.includes(scope)) setScope(c.scopes[0] ?? "");
        }}
        className="h-10 rounded-btn border border-line px-3 text-[13px] bg-white"
      >
        <option value="">选择案件</option>
        {cases.map((c) => (
          <option key={c.caseId} value={c.caseId}>
            {c.caseId}
          </option>
        ))}
      </select>
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        className="h-10 rounded-btn border border-line px-3 text-[13px] bg-white"
      >
        <option value="">材料范围</option>
        {(current?.scopes ?? []).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

function Msg({ kind, text }: { kind: "ok" | "bad"; text: string }) {
  return (
    <div
      className={`mt-4 rounded-card px-4 py-3 text-[13px] leading-6 ${
        kind === "ok" ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"
      }`}
    >
      {text}
    </div>
  );
}

/* ================= 受控阅读器 ================= */

function ReaderSection({ login, cases }: { login: string; cases: VisibleCase[] }) {
  const [caseId, setCaseId] = useState("");
  const [scope, setScope] = useState("");
  const [opened, setOpened] = useState<ReaderOpened | null>(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setErr(null);
    try {
      const r = await call<ReaderOpened>(login, "/portal/reader", {
        method: "POST",
        body: JSON.stringify({ caseId, scope })
      });
      setOpened(r);
      setPage(1);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function turn(n: number) {
    if (!opened) return;
    setBusy(true);
    try {
      await call(login, `/portal/reader/${opened.session.id}/page`, {
        method: "POST",
        body: JSON.stringify({ page: n })
      });
      setPage(n);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!opened) return;
    setBusy(true);
    try {
      await call(login, `/portal/reader/${opened.session.id}/close`, { method: "POST", body: "{}" });
      setOpened(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card bg-white shadow-sh1 p-6">
      <h2 className="text-[15.5px] font-extrabold">受控阅读器</h2>
      <p className="mt-1 text-[12.5px] text-mut leading-6">
        预签名 2 分钟内有效，逐页阅读留痕；页面带账号水印，无裸文件下载。
      </p>

      {!opened ? (
        <>
          <div className="mt-5">
            <CasePicker cases={cases} caseId={caseId} setCaseId={setCaseId} scope={scope} setScope={setScope} />
          </div>
          {err && <Msg kind="bad" text={err} />}
          <button
            onClick={open}
            disabled={busy || !caseId || !scope}
            className="btn-navy mt-5 h-10 px-6 rounded-btn text-white text-[13.5px] font-bold disabled:opacity-50"
          >
            {busy ? "处理中…" : "打开阅读器"}
          </button>
        </>
      ) : (
        <div className="mt-5">
          <div className="relative overflow-hidden rounded-card border border-line bg-paper" style={{ aspectRatio: "3 / 4" }}>
            {/* 模拟文档页 */}
            <div className="absolute inset-0 flex items-center justify-center text-faint text-[13px]">
              材料影像 · 第 {page} 页
            </div>
            {/* 水印层 */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(-28deg, transparent 0 70px, rgba(175,45,103,.10) 70px 96px)"
              }}
            />
            <div className="absolute left-3 top-3 right-3 flex justify-between text-[10.5px] text-berry font-semibold">
              <span>{opened.watermark.name}</span>
              <span>{opened.watermark.org}</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="text-[12px] text-mut">
              会话 {opened.session.id} · 预签名至 {new Date(opened.session.presignExpiresAt).toLocaleTimeString("zh-CN")}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => turn(page - 1)}
                disabled={busy || page <= 1}
                className="h-9 w-9 rounded-full border border-line text-[13px] disabled:opacity-40"
              >
                ‹
              </button>
              <button onClick={() => turn(page + 1)} disabled={busy} className="h-9 w-9 rounded-full border border-line text-[13px]">
                ›
              </button>
            </div>
          </div>
          {err && <Msg kind="bad" text={err} />}
          <button onClick={close} disabled={busy} className="mt-4 h-10 px-6 rounded-btn border border-line text-[13.5px] font-bold">
            关闭阅读器
          </button>
        </div>
      )}
    </section>
  );
}

/* ================= 水印 PDF ================= */

function PdfSection({ login, cases }: { login: string; cases: VisibleCase[] }) {
  const [caseId, setCaseId] = useState("");
  const [scope, setScope] = useState("");
  const [result, setResult] = useState<PdfResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(
        await call<PdfResult>(login, "/portal/pdf", {
          method: "POST",
          body: JSON.stringify({ caseId, scope })
        })
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card bg-white shadow-sh1 p-6">
      <h2 className="text-[15.5px] font-extrabold">申请水印 PDF</h2>
      <p className="mt-1 text-[12.5px] text-mut leading-6">
        带水印 PDF 是唯一可下载形态；水印含账号、机构与申请时间。
      </p>
      <div className="mt-5">
        <CasePicker cases={cases} caseId={caseId} setCaseId={setCaseId} scope={scope} setScope={setScope} />
      </div>
      {err && <Msg kind="bad" text={err} />}
      {result && (
        <Msg kind="ok" text={`已生成：${result.artifactRef}；水印：${result.mark}`} />
      )}
      <button
        onClick={request}
        disabled={busy || !caseId || !scope}
        className="btn-navy mt-5 h-10 px-6 rounded-btn text-white text-[13.5px] font-bold disabled:opacity-50"
      >
        {busy ? "处理中…" : "申请水印 PDF"}
      </button>
    </section>
  );
}

/* ================= 报告提交 ================= */

function ReportSection({ login, cases, onSubmitted }: { login: string; cases: VisibleCase[]; onSubmitted: () => void }) {
  const [caseId, setCaseId] = useState("");
  const [kind, setKind] = useState("progress");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const KINDS = [
    { v: "progress", l: "进度报告" },
    { v: "document", l: "文书回执" },
    { v: "supplement", l: "补件通知" },
    { v: "other", l: "其他" }
  ];

  async function submit() {
    if (!title.trim()) {
      setErr("标题必填");
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      await call(login, "/portal/reports", {
        method: "POST",
        body: JSON.stringify({ caseId, kind, title: title.trim(), detail: detail.trim() })
      });
      setOk(true);
      setTitle("");
      setDetail("");
      onSubmitted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-card bg-white shadow-sh1 p-6">
      <h2 className="text-[15.5px] font-extrabold">提交服务报告 / 凭据</h2>
      <p className="mt-1 text-[12.5px] text-mut leading-6">
        提交内容先进入平台待核验队列，对客显示“未经官方核验”；核验通过后才成为正式节点。
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="h-10 rounded-btn border border-line px-3 text-[13px] bg-white">
          <option value="">选择案件</option>
          {cases.map((c) => (
            <option key={c.caseId} value={c.caseId}>
              {c.caseId}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 rounded-btn border border-line px-3 text-[13px] bg-white">
          {KINDS.map((k) => (
            <option key={k.v} value={k.v}>
              {k.l}
            </option>
          ))}
        </select>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="标题"
        className="mt-3 h-11 w-full rounded-btn border border-line px-4 text-[14px] outline-none focus:border-berry"
      />
      <textarea
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        placeholder="具体内容（可选）"
        rows={4}
        className="mt-3 w-full rounded-btn border border-line px-4 py-3 text-[14px] outline-none focus:border-berry resize-none"
      />
      {err && <Msg kind="bad" text={err} />}
      {ok && <Msg kind="ok" text="已提交至平台待核验队列。" />}
      <button onClick={submit} disabled={busy || !caseId} className="btn-navy mt-4 h-10 px-6 rounded-btn text-white text-[13.5px] font-bold disabled:opacity-50">
        {busy ? "提交中…" : "提交报告"}
      </button>
    </section>
  );
}

/* ================= 主壳 ================= */

const TABS = [
  { k: "cases", l: "可见案件" },
  { k: "reader", l: "受控阅读器" },
  { k: "pdf", l: "水印 PDF" },
  { k: "report", l: "提交报告" }
] as const;

export default function App() {
  const [login, setLogin] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("cases");
  const [cases, setCases] = useState<VisibleCase[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadCases = useCallback(async (who: string) => {
    try {
      const r = await call<{ records: VisibleCase[] }>(who, "/portal/cases");
      setCases(r.records);
      setLoadErr(null);
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (login) void loadCases(login);
  }, [login, loadCases]);

  if (!login) return <Login onLogin={setLogin} />;

  return (
    <div className="min-h-full">
      <header className="bg-navy text-white">
        <div className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg signature-bg flex items-center justify-center font-extrabold">门</div>
            <div>
              <div className="text-[15px] font-extrabold">服务方门户</div>
              <div className="text-[11.5px] text-white/70">账号 {login}</div>
            </div>
          </div>
          <button onClick={() => setLogin(null)} className="text-[12.5px] text-white/80 hover:text-white">
            退出
          </button>
        </div>
        <div className="h-[2px] signature-bg" />
      </header>

      <nav className="mx-auto max-w-5xl px-6 mt-6 flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`h-9 px-5 rounded-full text-[13px] font-semibold transition ${
              tab === t.k ? "bg-navy text-white" : "bg-navy-50 text-navy"
            }`}
          >
            {t.l}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-6 space-y-6">
        {tab === "cases" && (
          <section className="rounded-card bg-white shadow-sh1 p-6">
            <h2 className="text-[15.5px] font-extrabold">可见案件（批次授权并集）</h2>
            <p className="mt-1 text-[12.5px] text-mut leading-6">
              仅显示授权有效期内的案件，无全局案件列表；授权到期自动移出。
            </p>
            {loadErr && <Msg kind="bad" text={loadErr} />}
            {cases?.length === 0 && (
              <div className="mt-6 rounded-card bg-paper px-4 py-8 text-center text-[13px] text-faint">
                当前没有可见案件（账号须完成实名与 MFA，且存在有效批次授权）。
              </div>
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {(cases ?? []).map((c) => (
                <div key={c.caseId} className="rounded-card border border-line p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[14.5px]">{c.caseId}</span>
                    <span className="rounded-full bg-ok-bg text-ok px-3 py-1 text-[11.5px] font-semibold">授权有效</span>
                  </div>
                  <div className="mt-3 text-[12px] text-mut">材料范围：{c.scopes.join("、") || "—"}</div>
                  <div className="mt-1 text-[12px] text-mut">可执行动作：{c.actions.join("、") || "—"}</div>
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === "reader" && <ReaderSection login={login} cases={cases ?? []} />}
        {tab === "pdf" && <PdfSection login={login} cases={cases ?? []} />}
        {tab === "report" && <ReportSection login={login} cases={cases ?? []} onSubmitted={() => void loadCases(login)} />}
      </main>
    </div>
  );
}
