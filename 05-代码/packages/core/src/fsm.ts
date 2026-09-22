/**
 * 通用有限状态机内核（事件溯源配套）
 *
 * 设计原则（见 PRD 冻结基线、GP4）：
 * - 状态迁移白名单集中定义，前后端共用同一份纯函数；
 * - 守卫（guard）失败即拒绝迁移，不产生事件；
 * - 状态机只回答"能不能迁移"，不写数据库、不发通知（副作用由应用层完成）；
 * - 任何"强制通过""跳步"在类型层即不存在。
 */

export type Guard<TState extends string, TEvent extends string, TContext> = (
  ctx: TContext,
  from: TState,
  event: TEvent
) => GuardResult;

export interface GuardResult {
  ok: boolean;
  /** 失败时的稳定错误码（对应 PRD 错误码分段），不写面向用户文案 */
  code?: string;
  reason?: string;
}

export interface TransitionDef<TState extends string, TEvent extends string, TContext> {
  from: TState;
  event: TEvent;
  to: TState;
  guards?: Guard<TState, TEvent, TContext>[];
}

export interface TransitionOutcome<TState extends string> {
  ok: boolean;
  to?: TState;
  code?: string;
  reason?: string;
}

export class StateMachine<TState extends string, TEvent extends string, TContext = unknown> {
  private readonly map = new Map<string, TransitionDef<TState, TEvent, TContext>>();

  constructor(
    public readonly name: string,
    defs: TransitionDef<TState, TEvent, TContext>[]
  ) {
    for (const def of defs) {
      this.map.set(key(def.from, def.event), def);
    }
  }

  can(ctx: TContext, from: TState, event: TEvent): GuardResult {
    const def = this.map.get(key(from, event));
    if (!def) return { ok: false, code: "FSM_ILLEGAL_TRANSITION", reason: `${this.name}: ${from} --${event}--> 不在白名单` };
    if (def.guards) {
      for (const g of def.guards) {
        const r = g(ctx, from, event);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  }

  transition(ctx: TContext, from: TState, event: TEvent): TransitionOutcome<TState> {
    const r = this.can(ctx, from, event);
    const def = this.map.get(key(from, event));
    if (!r.ok || !def) return { ok: false, code: r.code, reason: r.reason };
    return { ok: true, to: def.to };
  }

  /** 列出某状态下全部合法事件（用于前端按钮显隐与测试） */
  legalEvents(from: TState): TEvent[] {
    return [...this.map.values()].filter((d) => d.from === from).map((d) => d.event);
  }

  /** 全部状态（用于校验无悬挂状态） */
  states(): TState[] {
    const s = new Set<TState>();
    for (const d of this.map.values()) {
      s.add(d.from);
      s.add(d.to);
    }
    return [...s];
  }
}

function key(from: string, event: string): string {
  return `${from}::${event}`;
}

export const guard = {
  ok: (): GuardResult => ({ ok: true }),
  fail: (code: string, reason: string): GuardResult => ({ ok: false, code, reason })
};
