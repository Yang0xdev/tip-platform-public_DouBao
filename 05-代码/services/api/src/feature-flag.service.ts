import { Injectable } from "@nestjs/common";

/**
 * 特性开关（技术方案 §11 应急四开关 + PRD 六门）
 * M0：内存种子（全 off）；M1 起读取 feature_flags 表（Prisma），
 * 变更走 A10 统一审批 + 审计；门未开时业务路由在服务端直接拒绝，不是前端隐藏。
 */
export type FlagState = "off" | "shadow" | "on";

export interface FeatureFlag {
  key: string;
  state: FlagState;
  doorRef: string;
  note: string;
}

const SEEDED_FLAGS: FeatureFlag[] = [
  { key: "transaction", state: "off", doorRef: "D2/D8", note: "合同登记与支付凭证链路" },
  { key: "portal_cross_border", state: "off", doorRef: "D9", note: "服务方门户跨境材料共享" },
  { key: "settlement", state: "off", doorRef: "D6", note: "佣金结算与退款执行" },
  { key: "esign", state: "off", doorRef: "D2", note: "电子签适配器（e签宝/法大大）" },
  { key: "global_access", state: "off", doorRef: "Q6", note: "全球通行真实签证/护照数据" },
  { key: "t2_marketing", state: "off", doorRef: "合规", note: "T2 营销消息（单独同意/退订）" }
];

@Injectable()
export class FeatureFlagService {
  private flags = new Map<string, FeatureFlag>(SEEDED_FLAGS.map((f) => [f.key, f]));

  list(): FeatureFlag[] {
    return [...this.flags.values()];
  }

  isOn(key: string): boolean {
    return this.flags.get(key)?.state === "on";
  }
}
