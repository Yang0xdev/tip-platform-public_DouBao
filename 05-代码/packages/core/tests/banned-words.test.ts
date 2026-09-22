import { describe, it, expect } from "vitest";
import { WordEngine } from "../src/banned-words.js";

const engine = new WordEngine("words-v1.0");

describe("禁表述词库（四生产点）", () => {
  it("方案中出现包过/成功率被强拦截", () => {
    const r = engine.check("我们包过，成功率高达90%", "proposal");
    expect(r.ok).toBe(false);
    expect(r.blocked.length).toBeGreaterThanOrEqual(2);
    expect(r.wordVersion).toBe("words-v1.0");
  });

  it("iPad 讲解命中保证获批正则被拦截", () => {
    const r = engine.check("这个项目我们可以保证您获批", "pitch");
    expect(r.ok).toBe(false);
    expect(r.blocked.some((v) => v.ruleId === "B009")).toBe(true);
  });

  it("成功率在初评生产点不拦截（初评不展示营销文案），但在素材点拦截", () => {
    expect(engine.check("成功率", "assessment").ok).toBe(true);
    expect(engine.check("成功率", "asset").ok).toBe(false);
  });

  it("引导个人账户收款在方案中拦截", () => {
    expect(engine.check("费用直接转我个人账户就行", "proposal").ok).toBe(false);
  });

  it("warn 级不阻断但需人工署名", () => {
    const r = engine.check("这是最快的路径", "proposal");
    expect(r.ok).toBe(true);
    expect(r.warnings.some((v) => v.ruleId === "W001")).toBe(true);
  });

  it("多部分批量校验：任一点 block 即整体不通过", () => {
    const r = engine.checkAll([
      { text: "正常标题", point: "asset" },
      { text: "内部渠道有人", point: "asset" }
    ]);
    expect(r.ok).toBe(false);
    expect(r.blocked.length).toBe(1);
  });
});
