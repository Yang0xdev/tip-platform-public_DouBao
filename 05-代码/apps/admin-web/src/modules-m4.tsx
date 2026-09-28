import { useState } from "react";
import type { Actor } from "./api.js";
import { Badge, Loading, Panel, Td, Th, useApi } from "./modules.js";
import { ActBtn, post, refreshToken } from "./modules-m3.js";

/* ================= A07 佣金结算与退款 ================= */

interface Line {
  id: string;
  orderId: string;
  advisorId: string;
  feeItemCode: string;
  amountMinor: string;
  currency: string;
  state: string;
  settlementBatchId: string | null;
}
interface Batch {
  id: string;
  state: string;
  lines: string[];
  reviewerA: string | null;
  reviewerB: string | null;
}
interface Refund {
  id: string;
  orderId: string;
  state: string;
  businessReviewerId: string | null;
  financeReviewerId: string | null;
  receiptReversalRef: string | null;
}

export function A07Commission({ actor }: { actor: Actor }) {
  const [tick, setTick] = useState(0);
  const lines = useApi<{ records: Line[] }>("/admin/commissions", actor, [tick]);
  const batches = useApi<{ records: Batch[] }>("/admin/commissions/settlement-batches", actor, [tick]);
  const refunds = useApi<{ records: Refund[] }>("/admin/commissions/refunds", actor, [tick]);
  const reload = () => setTick(refreshToken());

  return (
    <div className="space-y-5">
      <Panel title="佣金行（六态，仅平台服务费计提，异币种分列不合计）">
        <Loading error={lines.error} loading={lines.loading}>
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th w="11%">编号</Th>
                <Th w="13%">订单</Th>
                <Th w="13%">顾问</Th>
                <Th w="14%">金额（分列）</Th>
                <Th w="12%">状态</Th>
                <Th w="14%">结算单</Th>
                <Th w="23%">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(lines.data?.records ?? []).map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <Td>{l.id}</Td>
                  <Td>{l.orderId}</Td>
                  <Td>{l.advisorId}</Td>
                  <Td mono>
                    {l.amountMinor} {l.currency}
                  </Td>
                  <Td>
                    <Badge state={l.state} />
                  </Td>
                  <Td>{l.settlementBatchId ?? "—"}</Td>
                  <Td>
                    {["settled", "paid"].includes(l.state) && (
                      <ActBtn
                        label="追回"
                        kind="berry"
                        run={async () => {
                          const reason = window.prompt("追回事实原因（必填）") ?? "";
                          if (!reason.trim()) throw new Error("追回须填事实原因");
                          await post(actor, `/admin/commissions/${l.id}/clawback`, { reason });
                        }}
                        onDone={reload}
                      />
                    )}
                    <ActBtn
                      label="调整登记"
                      kind="ghost"
                      run={async () => {
                        const note = window.prompt("调整说明（只记事件，不改状态）") ?? "";
                        await post(actor, `/admin/commissions/${l.id}/adjust`, { note });
                      }}
                      onDone={reload}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Loading>
        <div className="mt-3 flex gap-2">
          <ActBtn label="生成结算批次" run={async () => post(actor, "/admin/commissions/settlement-batches", {})} onDone={reload} />
        </div>
      </Panel>

      <Panel title="结算批次（双人复核互异 → 审批 → 线下支付登记，无自动打款）">
        <Loading error={batches.error} loading={batches.loading}>
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th w="12%">批次</Th>
                <Th w="12%">状态</Th>
                <Th w="10%">行数</Th>
                <Th w="16%">复核人 A</Th>
                <Th w="16%">复核人 B</Th>
                <Th w="34%">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(batches.data?.records ?? []).map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <Td>{b.id}</Td>
                  <Td>
                    <Badge state={b.state} />
                  </Td>
                  <Td>{b.lines.length}</Td>
                  <Td>{b.reviewerA ?? "—"}</Td>
                  <Td>{b.reviewerB ?? "—"}</Td>
                  <Td>
                    {b.state === "draft" && (
                      <ActBtn label="复核（双人）" run={async () => post(actor, `/admin/commissions/settlement-batches/${b.id}/review`, {})} onDone={reload} />
                    )}
                    {b.state === "reviewed" && (
                      <ActBtn label="审批" run={async () => post(actor, `/admin/commissions/settlement-batches/${b.id}/approve`, {})} onDone={reload} />
                    )}
                    {b.state === "approved" && (
                      <ActBtn
                        label="登记线下支付"
                        kind="ok"
                        run={async () => {
                          const ref = window.prompt("线下支付凭证引用（必填）") ?? "";
                          if (!ref.trim()) throw new Error("须登记支付凭证");
                          await post(actor, `/admin/commissions/settlement-batches/${b.id}/pay`, { voucherRef: ref });
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

      <Panel title="退款（业务+财务双人互异；已发生费按实扣除；无“不成功全额退款”；收据冲红留痕）">
        <Loading error={refunds.error} loading={refunds.loading}>
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th w="12%">退款单</Th>
                <Th w="12%">订单</Th>
                <Th w="13%">状态</Th>
                <Th w="15%">业务复核</Th>
                <Th w="15%">财务复核</Th>
                <Th w="13%">冲红收据</Th>
                <Th w="20%">操作</Th>
              </tr>
            </thead>
            <tbody>
              {(refunds.data?.records ?? []).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <Td>{r.id}</Td>
                  <Td>{r.orderId}</Td>
                  <Td>
                    <Badge state={r.state} />
                  </Td>
                  <Td>{r.businessReviewerId ?? "—"}</Td>
                  <Td>{r.financeReviewerId ?? "—"}</Td>
                  <Td>{r.receiptReversalRef ?? "—"}</Td>
                  <Td>
                    {r.state === "proposed" && (
                      <>
                        <ActBtn label="业务复核" run={async () => post(actor, `/admin/commissions/refunds/${r.id}/review`, { role: "business" })} onDone={reload} />
                        <ActBtn label="财务复核" run={async () => post(actor, `/admin/commissions/refunds/${r.id}/review`, { role: "finance" })} onDone={reload} />
                      </>
                    )}
                    {r.state === "double_reviewed" && (
                      <ActBtn
                        label="登记执行"
                        kind="ok"
                        run={async () => {
                          const ref = window.prompt("线下退款凭证引用（必填）") ?? "";
                          if (!ref.trim()) throw new Error("须登记退款凭证");
                          await post(actor, `/admin/commissions/refunds/${r.id}/execute`, { voucherRef: ref });
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
    </div>
  );
}

/* ================= A08 工单与投诉（双队列物理隔离） ================= */

interface Ticket {
  id: string;
  kind: string;
  title: string;
  state: string;
  assignedTeam: string | null;
  assigneeId: string | null;
  complaintCategory: string | null;
  respondentAdvisorId: string | null;
}

export function A08Tickets({ actor }: { actor: Actor }) {
  const [team, setTeam] = useState<"customer_service" | "compliance_team">("customer_service");
  const [tick, setTick] = useState(0);
  const q = useApi<{ records: Ticket[] }>(`/admin/tickets/queue?team=${team}`, actor, [team, tick]);

  return (
    <Panel title={`工单队列 · ${team === "customer_service" ? "客服（咨询/查询/资料变更）" : "合规（投诉，物理隔离）"}`}>
      <div className="mb-3 flex gap-2">
        {(["customer_service", "compliance_team"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTeam(t)}
            className={`h-9 px-4 rounded-full text-[13px] font-semibold transition ${
              team === t ? "bg-navy text-white" : "bg-navy-50 text-navy"
            }`}
          >
            {t === "customer_service" ? "客服队列" : "投诉队列"}
          </button>
        ))}
      </div>
      <Loading error={q.error} loading={q.loading}>
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th w="11%">工单号</Th>
              <Th w="10%">类型</Th>
              <Th w="22%">标题</Th>
              <Th w="12%">状态</Th>
              <Th w="14%">被投诉顾问</Th>
              <Th w="13%">受理人</Th>
              <Th w="18%">操作</Th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.records ?? []).map((t) => (
              <tr key={t.id} className="border-t border-line">
                <Td>{t.id}</Td>
                <Td>{t.complaintCategory ?? t.kind}</Td>
                <Td>{t.title}</Td>
                <Td>
                  <Badge state={t.state} />
                </Td>
                <Td>{t.respondentAdvisorId ?? "—"}</Td>
                <Td>{t.assigneeId ?? "—"}</Td>
                <Td>
                  {t.state === "submitted" && <ActBtn label="受理" run={async () => post(actor, `/admin/tickets/${t.id}/accept`, {})} onDone={() => setTick(refreshToken())} />}
                  {t.state === "accepted" && <ActBtn label="处理" run={async () => post(actor, `/admin/tickets/${t.id}/process`, {})} onDone={() => setTick(refreshToken())} />}
                  {t.state === "processing" && (
                    <ActBtn
                      label="解决"
                      run={async () => {
                        const note = window.prompt("处理结果说明（必填）") ?? "";
                        if (!note.trim()) throw new Error("解决须填说明");
                        await post(actor, `/admin/tickets/${t.id}/resolve`, { note });
                      }}
                      onDone={() => setTick(refreshToken())}
                    />
                  )}
                  {t.state === "resolved_pending" && (
                    <ActBtn label="关闭" kind="ok" run={async () => post(actor, `/admin/tickets/${t.id}/close`, {})} onDone={() => setTick(refreshToken())} />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Loading>
    </Panel>
  );
}
/* ================= A10 合规审批中心 ================= */

interface CEvent {
  id: string;
  source: string;
  level: "L1" | "L2" | "L3";
  title: string;
  state: string;
  respondentAdvisorId: string | null;
  dispositions: Array<{ id: string; kind: string; executed: boolean }>;
}

interface DeletionRow {
  id: string;
  customerRef: string;
  state: string;
  reason: string;
  coolingUntil: string;
  anonymizedAt: string | null;
}
interface InviteRow {
  id: string;
  token: string;
  purpose: string;
  email: string | null;
  expiresAt: string;
  consumedAt: string | null;
}

export function A10Compliance({ actor }: { actor: Actor }) {
  const [tick, setTick] = useState(0);
  const ev = useApi<{ records: CEvent[] }>("/admin/compliance-events", actor, [tick]);
  const dels = useApi<{ records: DeletionRow[] }>("/admin/deletions", actor, [tick]);
  const invs = useApi<{ records: InviteRow[] }>("/admin/invites", actor, [tick]);

  return (
    <Panel title="合规事件（L1/L2/L3；L3 双人审批；处置全执行才归档）">
      <Loading error={ev.error} loading={ev.loading}>
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th w="11%">事件号</Th>
              <Th w="9%">级别</Th>
              <Th w="13%">来源</Th>
              <Th w="20%">标题</Th>
              <Th w="11%">状态</Th>
              <Th w="12%">当事人</Th>
              <Th w="12%">处置执行</Th>
              <Th w="12%">操作</Th>
            </tr>
          </thead>
          <tbody>
            {(ev.data?.records ?? []).map((e) => (
              <tr key={e.id} className="border-t border-line">
                <Td>{e.id}</Td>
                <Td>{e.level}</Td>
                <Td>{e.source}</Td>
                <Td>{e.title}</Td>
                <Td>
                  <Badge state={e.state} />
                </Td>
                <Td>{e.respondentAdvisorId ?? "—"}</Td>
                <Td>
                  {e.dispositions.length
                    ? `${e.dispositions.filter((d) => d.executed).length}/${e.dispositions.length}`
                    : "—"}
                </Td>
                <Td>
                  {e.state === "new" && (
                    <ActBtn label="分级" run={async () => post(actor, `/admin/compliance-events/${e.id}/triage`, { level: e.level })} onDone={() => setTick(refreshToken())} />
                  )}
                  {e.state === "triaged" && (
                    <ActBtn label="调查" run={async () => post(actor, `/admin/compliance-events/${e.id}/investigate`, {})} onDone={() => setTick(refreshToken())} />
                  )}
                  {e.state === "investigating" && (
                    <>
                      <ActBtn
                        label="登记处置"
                        run={async () => {
                          const detail = window.prompt("处置说明（如 暂停授权/重新培训/佣金冻结）") ?? "";
                          if (!detail.trim()) throw new Error("处置说明必填");
                          await post(actor, `/admin/compliance-events/${e.id}/dispositions`, { kind: "advisor_warning", detail });
                        }}
                        onDone={() => setTick(refreshToken())}
                      />
                      <ActBtn label="提交审批" run={async () => post(actor, `/admin/compliance-events/${e.id}/propose`, {})} onDone={() => setTick(refreshToken())} />
                    </>
                  )}
                  {e.state === "proposed" && (
                    <ActBtn
                      label="决定"
                      kind="berry"
                      run={async () => {
                        const second = e.level === "L3" ? window.prompt("L3 第二审批人（互异）") || undefined : undefined;
                        await post(actor, `/admin/compliance-events/${e.id}/decide`, { secondApproverId: second });
                      }}
                      onDone={() => setTick(refreshToken())}
                    />
                  )}
                  {e.state === "decided" && (
                    <>
                      {e.dispositions.some((d) => !d.executed) && (
                        <ActBtn
                          label="执行处置"
                          kind="ok"
                          run={async () => {
                            const d = e.dispositions.find((x) => !x.executed)!;
                            await post(actor, `/admin/compliance-events/${e.id}/dispositions/${d.id}/approve`, {});
                          }}
                          onDone={() => setTick(refreshToken())}
                        />
                      )}
                      <ActBtn label="归档" run={async () => post(actor, `/admin/compliance-events/${e.id}/close`, {})} onDone={() => setTick(refreshToken())} />
                    </>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Loading>
      <div className="mt-5 flex gap-2">
        <ActBtn
          label="新建邀请"
          run={async () => {
            const purpose = (window.prompt("用途：customer/advisor/provider") ?? "customer") as "customer" | "advisor" | "provider";
            await post(actor, "/admin/invites", { purpose });
          }}
          onDone={() => setTick(refreshToken())}
        />
        <ActBtn
          label="注销时钟（到期匿名化）"
          run={async () => post(actor, "/admin/deletions/tick", { now: new Date().toISOString() })}
          onDone={() => setTick(refreshToken())}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Panel title="注销队列（15 天冷静期，到期匿名化保留法定台账）">
          <Loading error={dels.error} loading={dels.loading}>
            {(dels.data?.records ?? []).map((d) => (
              <div key={d.id} className="border-t border-line py-2.5 text-[12.5px]">
                <div className="flex justify-between">
                  <span className="font-semibold text-ink">{d.customerRef}</span>
                  <Badge state={d.state} />
                </div>
                <div className="text-faint mt-1">
                  {d.id} · 冷静至 {d.coolingUntil.slice(0, 10)}
                </div>
                <div className="text-mut mt-0.5">{d.reason}</div>
              </div>
            ))}
          </Loading>
        </Panel>
        <Panel title="邀请名单（影子期一次性邀请，用途绑定）">
          <Loading error={invs.error} loading={invs.loading}>
            {(invs.data?.records ?? []).map((i) => (
              <div key={i.id} className="border-t border-line py-2.5 text-[12.5px]">
                <div className="flex justify-between">
                  <span className="font-semibold text-ink">{i.purpose}</span>
                  <Badge state={i.consumedAt ? "closed" : "new"} />
                </div>
                <div className="text-faint mt-1 font-mono break-all">{i.token}</div>
                <div className="text-faint mt-0.5">
                  {i.email ?? "—"} · 至 {i.expiresAt.slice(0, 10)}
                </div>
              </div>
            ))}
          </Loading>
        </Panel>
      </div>
    </Panel>
  );
}
