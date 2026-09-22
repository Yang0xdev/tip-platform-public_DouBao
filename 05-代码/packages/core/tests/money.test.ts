import { describe, it, expect } from "vitest";
import {
  toMinor, fromMinor, sumSameCurrency, validateFeeItems, isDuplicateVoucher,
  type FeeItem
} from "../src/money.js";

describe("金额铁律", () => {
  it("元转最小单位与回转（含 0 小数位日元）", () => {
    expect(toMinor("1234.56", "CNY")).toBe(123456n);
    expect(fromMinor(123456n, "CNY")).toBe("1234.56");
    expect(toMinor("1234", "JPY")).toBe(1234n);
    expect(fromMinor(1234n, "JPY")).toBe("1234");
  });

  it("超过币种精度拒绝", () => {
    try {
      toMinor("1.234", "USD");
      throw new Error("应抛出 MoneyError");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("MONEY_TOO_PRECISE");
    }
  });

  it("异币种分列合计，永不产生总价", () => {
    const items: FeeItem[] = [
      { code: "platform", label: "平台服务费", nature: "platform_service", collector: "示例出入境咨询（北京）", currency: "CNY", amountMinor: 100000n, certainty: "confirmed", timing: "签约时" },
      { code: "official", label: "官方申请费", nature: "official", collector: "A国政府", currency: "USD", amountMinor: 50000n, certainty: "estimated", timing: "递交时" }
    ];
    const sums = sumSameCurrency(items);
    expect(sums.get("CNY")).toBe(100000n);
    expect(sums.get("USD")).toBe(50000n);
    // 数据结构层面不存在跨币种合计函数（调用方无法得到总价）
    expect(validateFeeItems(items).valid).toBe(true);
  });

  it("待确认不是 0，且不参与合计", () => {
    const items: FeeItem[] = [
      { code: "platform", label: "平台服务费", nature: "platform_service", collector: "X", currency: "CNY", amountMinor: 10000n, certainty: "confirmed", timing: "签约时" },
      { code: "overseas", label: "境外专业服务费", nature: "overseas_professional", collector: null, collectorTbc: true, currency: null, amountMinor: null, certainty: "tbc", timing: "待确认" }
    ];
    const sums = sumSameCurrency(items);
    expect(sums.get("CNY")).toBe(10000n);
    expect(validateFeeItems(items).valid).toBe(true);
    const bad: FeeItem = { code: "x", label: "x", nature: "third_party", collector: null, currency: "CNY", amountMinor: 0n, certainty: "tbc", timing: "" };
    expect(validateFeeItems([bad]).valid).toBe(false);
  });

  it("未发生费用不预记应收", () => {
    const items: FeeItem[] = [
      { code: "third", label: "第三方费", nature: "third_party", collector: "Y", currency: "CNY", amountMinor: null, certainty: "not_incurred", timing: "未发生" }
    ];
    expect(sumSameCurrency(items).size).toBe(0);
  });

  it("确定费用缺收取方拒绝", () => {
    const items: FeeItem[] = [
      { code: "p", label: "p", nature: "platform_service", collector: null, currency: "CNY", amountMinor: 100n, certainty: "confirmed", timing: "" }
    ];
    const r = validateFeeItems(items);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("MONEY_MISSING_COLLECTOR");
  });

  it("重复凭证三元组判定", () => {
    const a = { fileHash: "h1", amountMinor: 50000n, installment: 1 };
    expect(isDuplicateVoucher(a, { ...a })).toBe(true);
    expect(isDuplicateVoucher(a, { ...a, installment: 2 })).toBe(false);
  });
});
