/**
 * 金额铁律（PRD 内容红线②、GP4 §6、AT07/AT08/AT21）：
 * 1. 金额 = 数值 + 币种 + 性质 + 收取方 + 发生时点；
 * 2. 异币种不相加、不折算总价（系统里不存在 total 字段）；
 * 3. "待确认(tbc)"不是 0，不参与合计；
 * 4. 官方/第三方费未发生显式"未发生"，不预记应收；
 * 5. 内部用最小货币单位的 bigint，杜绝浮点误差。
 */

export type Currency = "CNY" | "USD" | "EUR" | "GBP" | "HKD" | "JPY" | "CAD" | "AUD" | "SGD";

/** 各币种小数位（ISO 4217 常见子集，按需扩展） */
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  CNY: 2, USD: 2, EUR: 2, GBP: 2, HKD: 2, JPY: 0, CAD: 2, AUD: 2, SGD: 2
};

export type FeeNature = "platform_service" | "domestic_service" | "overseas_professional" | "official" | "third_party";
export type FeeCertainty = "confirmed" | "estimated" | "tbc" | "not_incurred";

export interface FeeItem {
  /** 费用项编码，如 official_application_fee */
  code: string;
  /** 费用项名称 */
  label: string;
  nature: FeeNature;
  /** 收取方：境内签约主体 / 境外持牌方 / 官方 / 第三方，tbc 时可为空但必须显式 collectorTbc */
  collector: string | null;
  collectorTbc?: boolean;
  currency: Currency | null;
  /** 最小货币单位整数；tbc / not_incurred 时为 null */
  amountMinor: bigint | null;
  certainty: FeeCertainty;
  /** 发生时点，如 签约时 / 获批后 / 未发生 */
  timing: string;
}

export class MoneyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** 字符串/元 → 最小单位 bigint */
export function toMinor(amount: string | number, currency: Currency): bigint {
  const decimals = CURRENCY_DECIMALS[currency];
  const s = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new MoneyError("MONEY_BAD_FORMAT", `非法金额格式: ${amount}`);
  const neg = s.startsWith("-");
  const [intPart, fracPart = ""] = s.replace("-", "").split(".");
  if (fracPart.length > decimals) throw new MoneyError("MONEY_TOO_PRECISE", `${currency} 最多 ${decimals} 位小数`);
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const v = BigInt(intPart || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
  return neg ? -v : v;
}

export function fromMinor(minor: bigint, currency: Currency): string {
  const d = CURRENCY_DECIMALS[currency];
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const divisor = 10n ** BigInt(d);
  const intPart = abs / divisor;
  const fracPart = abs % divisor;
  const frac = d === 0 ? "" : "." + fracPart.toString().padStart(d, "0");
  return `${neg ? "-" : ""}${intPart}${frac}`;
}

/** 同币种合计；异币种直接拒绝（不折算） */
export function sumSameCurrency(items: FeeItem[]): Map<Currency, bigint> {
  const result = new Map<Currency, bigint>();
  for (const it of items) {
    if (it.certainty === "tbc" || it.certainty === "not_incurred") continue; // 待确认/未发生不参与
    if (!it.currency || it.amountMinor === null) {
      throw new MoneyError("MONEY_CONFIRMED_WITHOUT_AMOUNT", `费用项 ${it.code} 标记为 ${it.certainty} 却缺金额/币种`);
    }
    result.set(it.currency, (result.get(it.currency) ?? 0n) + it.amountMinor);
  }
  return result;
}

/**
 * 校验费用清单：
 * - 不允许跨币种合计（调用方若试图求总价，直接抛错）；
 * - confirmed/estimated 必须有金额、币种、收取方；
 * - tbc 必须显式保留且金额为 null；
 * - 不允许出现 total 概念。
 */
export function validateFeeItems(items: FeeItem[]): { valid: true } | { valid: false; code: string; reason: string } {
  for (const it of items) {
    if (it.certainty === "tbc") {
      if (it.amountMinor !== null) return { valid: false, code: "MONEY_TBC_HAS_AMOUNT", reason: `${it.code}: 待确认项不得填金额` };
      continue;
    }
    if (it.certainty === "not_incurred") {
      if (it.amountMinor !== null && it.amountMinor !== 0n) return { valid: false, code: "MONEY_NOT_INCURRED_HAS_AMOUNT", reason: `${it.code}: 未发生项不得预记金额` };
      continue;
    }
    if (!it.currency || it.amountMinor === null) return { valid: false, code: "MONEY_MISSING_AMOUNT", reason: `${it.code}: 确定/估算项缺币种或金额` };
    if (!it.collector || it.collectorTbc) return { valid: false, code: "MONEY_MISSING_COLLECTOR", reason: `${it.code}: 对客费用缺收取方` };
  }
  const currencies = new Set(items.filter((i) => i.currency).map((i) => i.currency));
  if (currencies.size > 1) {
    // 多币种合法，但系统永不提供总价；此处仅确认数据结构中不存在伪合计字段
    for (const it of items) {
      if ("total" in it) return { valid: false, code: "MONEY_TOTAL_FORBIDDEN", reason: "费用项不得含 total 字段" };
    }
  }
  return { valid: true };
}

/** 重复凭证判定辅助：文件哈希 + 金额 + 期次 三元组一致即视为重复 */
export function isDuplicateVoucher(a: { fileHash: string; amountMinor: bigint; installment: number }, b: typeof a): boolean {
  return a.fileHash === b.fileHash && a.amountMinor === b.amountMinor && a.installment === b.installment;
}
