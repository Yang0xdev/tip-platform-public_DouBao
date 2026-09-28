import React, { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Card, SectionLabel, Tag } from "../ui";
import { api } from "../api";

interface CommissionRow {
  id: string;
  orderId: string;
  feeItemCode: string;
  amountMinor: string;
  currency: string;
  state: string;
  settlementBatchId: string | null;
}

const NOTE: Record<string, string> = {
  not_accrued: "订单尚未到账，不计提",
  accrued: "已到账计提，等待结算周期",
  frozen: "冻结中（投诉/退款/合规核查）",
  settled: "结算单已复核，等待支付",
  paid: "已支付",
  clawback: "已追回"
};

export default function CommissionScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<CommissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.commissions();
      setRows(r.records);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => void load(), [load]);

  return (
    <ScrollView style={{ backgroundColor: "#F5F7FA" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text onPress={onBack} style={{ color: "#0B3A82", fontWeight: "700", fontSize: 14, marginBottom: 12 }}>‹ 返回</Text>
      <Card>
        <SectionLabel text="我的佣金" />
        <Text style={{ color: "#5E6B7E", fontSize: 13, lineHeight: 20 }}>
          仅平台服务费在客户到账后计提；名片扫码、预约、方案确认不产生佣金。异币种分列，不做合计。
        </Text>
      </Card>
      {error && <Text style={{ color: "#C03221", fontSize: 13, margin: 8 }}>{error}</Text>}
      {(rows ?? []).map((l) => (
        <Card key={l.id} style={{ marginVertical: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontWeight: "700", color: "#1B2433", fontSize: 14.5 }}>
              {l.amountMinor} {l.currency}
            </Text>
            <Tag text={l.state} tone={l.state === "paid" ? "ok" : l.state === "frozen" ? "warn" : "navy"} />
          </View>
          <Text style={{ color: "#8A95A6", fontSize: 12, marginTop: 6 }}>
            {l.id} · 订单 {l.orderId} · {l.settlementBatchId ?? "未入结算单"}
          </Text>
          <Text style={{ color: "#5E6B7E", fontSize: 12.5, marginTop: 6 }}>{NOTE[l.state]}</Text>
        </Card>
      ))}
      {rows && rows.length === 0 && (
        <Text style={{ color: "#8A95A6", fontSize: 13, textAlign: "center", marginTop: 24 }}>暂无佣金记录</Text>
      )}
    </ScrollView>
  );
}
