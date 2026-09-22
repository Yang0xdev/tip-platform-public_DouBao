import { describe, it, expect } from "vitest";
import { StateMachine, guard } from "../src/fsm.js";

describe("StateMachine 通用内核", () => {
  type S = "a" | "b" | "c";
  type E = "go" | "jump";
  const m = new StateMachine<S, E, { allow: boolean }>("test", [
    { from: "a", event: "go", to: "b", guards: [(ctx) => (ctx.allow ? guard.ok() : guard.fail("X1", "不允许"))] },
    { from: "b", event: "go", to: "c" }
  ]);

  it("白名单内迁移通过", () => {
    expect(m.transition({ allow: true }, "a", "go")).toEqual({ ok: true, to: "b" });
  });

  it("守卫失败拒绝迁移且不暴露目标态", () => {
    const r = m.transition({ allow: false }, "a", "go");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("X1");
    expect(r.to).toBeUndefined();
  });

  it("白名单外迁移为非法跳步", () => {
    expect(m.transition({ allow: true }, "a", "jump").code).toBe("FSM_ILLEGAL_TRANSITION");
    expect(m.can({ allow: true }, "a", "jump").ok).toBe(false);
  });

  it("legalEvents 用于按钮显隐", () => {
    expect(m.legalEvents("b")).toEqual(["go"]);
    expect(m.legalEvents("c")).toEqual([]);
  });
});
