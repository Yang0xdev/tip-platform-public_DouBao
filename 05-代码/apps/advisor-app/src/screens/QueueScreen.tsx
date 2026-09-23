import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  View
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api, advisorId, type ConsultationView } from "../api";
import { Card, Chip, Tag } from "../ui";
import { PrimaryButton, riseEntering } from "@tip/ui-native";

const SOURCE_LABEL: Record<string, string> = {
  card_appointment: "名片预约",
  card_request: "名片请求",
  assessment_explain: "初评解读",
  share_link: "分享落地",
  manual: "后台登记"
};

const STATE_LABEL: Record<string, { text: string; tone: "default" | "ok" | "warn" }> = {
  pending_assign: { text: "待平台分配", tone: "warn" },
  pending_accept: { text: "待接受", tone: "warn" },
  accepted: { text: "已建立关系", tone: "ok" },
  closed: { text: "已关闭", tone: "default" },
  reassigned: { text: "已转分配", tone: "default" }
};

export default function QueueScreen() {
  const [chip, setChip] = useState("pending_accept");
  const [records, setRecords] = useState<ConsultationView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const d = await api.queue(chip);
      setRecords(d.records);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [chip]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (id: string) => {
    setBusy(id);
    try {
      await api.accept(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pending = records?.filter((r) => r.state === "pending_accept").length ?? 0;

  return (
    <FlatList
      style={{ backgroundColor: "#F5F7FA" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      data={records ?? []}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} />}
      ListHeaderComponent={
        <View>
          <LinearGradient
            colors={["#AF2D67", "#5E246B", "#002661"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, padding: 20, marginBottom: 16 }}
          >
            <Text style={{ color: "#fff", fontSize: 13, opacity: 0.85 }}>展业工作台</Text>
            <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 4 }}>陈某，你好</Text>
            <Text style={{ color: "#fff", fontSize: 14, marginTop: 8, opacity: 0.92 }}>
              {pending} 位客户等待你确认，关系建立全程双向确认、可追溯。
            </Text>
          </LinearGradient>
          <View style={{ flexDirection: "row", marginBottom: 14 }}>
            <Chip label="待接受" active={chip === "pending_accept"} onPress={() => setChip("pending_accept")} />
            <Chip label="进行中" active={chip === "active"} onPress={() => setChip("active")} />
            <Chip label="全部" active={chip === "all"} onPress={() => setChip("all")} />
          </View>
          {error && (
            <Card style={{ borderColor: "#C03221" }}>
              <Text style={{ color: "#C03221" }}>{error}</Text>
            </Card>
          )}
          {records === null && <ActivityIndicator style={{ marginTop: 40 }} />}
          {records !== null && records.length === 0 && (
            <Card>
              <Text style={{ color: "#5E6B7E" }}>当前分类暂无咨询。</Text>
            </Card>
          )}
        </View>
      }
      renderItem={({ item, index }) => {
        const st = STATE_LABEL[item.state] ?? { text: item.state, tone: "default" as const };
        return (
          <Card {...riseEntering(Math.min(index, 8))}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#1B2433" }}>客户 {item.customerRef}</Text>
              <Tag text={st.text} tone={st.tone} />
            </View>
            <Text style={{ marginTop: 8, color: "#5E6B7E", fontSize: 13 }}>
              来源：{SOURCE_LABEL[item.source] ?? item.source}
              {item.projectCode ? ` · ${item.projectCode}` : ""}
            </Text>
            {item.note ? <Text style={{ marginTop: 6, color: "#5E6B7E", fontSize: 13 }}>{item.note}</Text> : null}
            {item.state === "pending_accept" && (
              <View style={{ marginTop: 12 }}>
                <PrimaryButton
                  label={busy === item.id ? "处理中…" : "接受并建立服务关系"}
                  onPress={() => void accept(item.id)}
                />
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}
