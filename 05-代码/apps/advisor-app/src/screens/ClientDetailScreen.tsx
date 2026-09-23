import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api, type RelationshipView } from "../api";
import { Card, SectionLabel, Tag } from "../ui";

const TABS = ["业务", "跟进", "授权"] as const;

const FOLLOW_DEMO = [
  { at: "第 1 次接触", text: "客户通过名片提交请求，已说明服务范围与费用分项。" },
  { at: "第 2 次接触", text: "完成双向确认，客户知悉不承诺获批结果。" },
  { at: "下一步", text: "待客户授权后，协助整理公开材料清单（不代填、不承诺）。" }
];

const SCOPE = [
  "仅可使用平台核准的介绍素材与名片",
  "不得引导平台外收款或私下承诺结果",
  "费用以已发布费表为准，顾问无改价入口",
  "问卷解读授权可由客户随时撤回",
  "授权到期后停新接旧，仅可服务存量客户"
];

export default function ClientDetailScreen({ route }: { route: { params: { relationshipId: string; customerRef: string } } }) {
  const { relationshipId, customerRef } = route.params;
  const [tab, setTab] = useState<(typeof TABS)[number]>("业务");
  const [rel, setRel] = useState<RelationshipView | null>(null);

  useEffect(() => {
    void api.clients().then((d) => setRel(d.records.find((r) => r.id === relationshipId) ?? null));
  }, [relationshipId]);

  return (
    <ScrollView style={{ backgroundColor: "#F5F7FA" }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: "#1B2433" }}>客户 {customerRef}</Text>
      <View style={{ flexDirection: "row", marginTop: 12, marginBottom: 14 }}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ marginRight: 8 }}>
            <Tag text={t} tone={tab === t ? "navy" : "default"} />
          </Pressable>
        ))}
      </View>

      {tab === "业务" && (
        <View>
          <Card>
            <SectionLabel text="服务关系" />
            <View style={{ flexDirection: "row" }}>
              <Tag text={rel?.advisorAcceptedAt ? "服务关系已建立" : "待确认"} tone="ok" />
              <View style={{ width: 8 }} />
              <Tag text={rel?.customerEventAt ? "客户已确认" : "客户未确认"} tone={rel?.customerEventAt ? "navy" : "warn"} />
            </View>
            <Text style={{ marginTop: 12, color: "#5E6B7E", fontSize: 13 }}>
              咨询单：{rel?.consultationId ?? "—"}
            </Text>
            <Text style={{ marginTop: 6, color: "#5E6B7E", fontSize: 13 }}>
              客户确认：{rel?.customerEventAt ? new Date(rel.customerEventAt).toLocaleString() : "—"}
            </Text>
            <Text style={{ marginTop: 6, color: "#5E6B7E", fontSize: 13 }}>
              顾问接受：{rel?.advisorAcceptedAt ? new Date(rel.advisorAcceptedAt).toLocaleString() : "—"}
            </Text>
          </Card>
          <Card>
            <SectionLabel text="业务说明" />
            <Text style={{ color: "#5E6B7E", fontSize: 14, lineHeight: 21 }}>
              平台提供材料清单、进度提醒与费用留痕；官方审核结果以当局为准，平台与顾问不作获批承诺。
            </Text>
          </Card>
        </View>
      )}

      {tab === "跟进" && (
        <Card>
          <SectionLabel text="跟进记录（演示数据）" />
          {FOLLOW_DEMO.map((f, i) => (
            <View key={i} style={{ marginBottom: 14 }}>
              <Text style={{ fontWeight: "700", color: "#0B3A82", fontSize: 13 }}>{f.at}</Text>
              <Text style={{ marginTop: 4, color: "#5E6B7E", fontSize: 14, lineHeight: 21 }}>{f.text}</Text>
            </View>
          ))}
          <Text style={{ color: "#8A95A6", fontSize: 12 }}>
            正式版跟进记录不可删除、只能更正，全程留痕（M2-03）。
          </Text>
        </Card>
      )}

      {tab === "授权" && (
        <Card>
          <SectionLabel text="展业授权范围" />
          {SCOPE.map((s, i) => (
            <Text key={i} style={{ color: "#5E6B7E", fontSize: 14, lineHeight: 22 }}>· {s}</Text>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
