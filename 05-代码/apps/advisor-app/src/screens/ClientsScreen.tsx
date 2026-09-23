import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, View } from "react-native";
import { api, type RelationshipView } from "../api";
import { Card, Tag } from "../ui";
import { riseEntering } from "@tip/ui-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export default function ClientsScreen({
  navigation
}: {
  navigation: NativeStackNavigationProp<Record<string, { relationshipId: string; customerRef: string }>>;
}) {
  const [records, setRecords] = useState<RelationshipView[] | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const d = await api.clients();
    setRecords(d.records);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = (records ?? []).filter((r) =>
    q.trim() ? r.customerRef.includes(q.trim()) : true
  );

  return (
    <FlatList
      style={{ backgroundColor: "#F5F7FA" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      data={filtered}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={
        <View>
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#1B2433", marginBottom: 12 }}>我的客户</Text>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="搜索客户编号"
            style={{
              backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: "#E5E9F0",
              paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginBottom: 14
            }}
          />
          {records === null && <ActivityIndicator style={{ marginTop: 40 }} />}
          {records !== null && records.length === 0 && (
            <Card><Text style={{ color: "#5E6B7E" }}>还没有建立服务关系的客户。</Text></Card>
          )}
        </View>
      }
      renderItem={({ item, index }) => (
        <Card {...riseEntering(Math.min(index, 8))}>
          <Text
            onPress={() =>
              navigation.navigate("ClientDetail", { relationshipId: item.id, customerRef: item.customerRef })
            }
            style={{ fontSize: 16, fontWeight: "700", color: "#1B2433" }}
          >
            客户 {item.customerRef}
          </Text>
          <View style={{ flexDirection: "row", marginTop: 10, alignItems: "center" }}>
            <Tag text={item.advisorAcceptedAt ? "服务关系已建立" : "待确认"} tone="ok" />
          </View>
          <Text style={{ marginTop: 10, color: "#5E6B7E", fontSize: 13 }}>
            咨询单：{item.consultationId}
          </Text>
          <Text
            onPress={() =>
              navigation.navigate("ClientDetail", { relationshipId: item.id, customerRef: item.customerRef })
            }
            style={{ marginTop: 8, color: "#0B3A82", fontSize: 13, fontWeight: "600" }}
          >
            查看客户详情 ›
          </Text>
        </Card>
      )}
    />
  );
}
