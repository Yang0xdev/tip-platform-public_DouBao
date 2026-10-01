import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, View, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Card, Tag } from "../ui";
import { colors } from "@tip/ui-native";

/**
 * 顾问「学习」Tab（培训中心初步）：
 *  - 必修合规课（与顾问四承诺、禁私收款、词库红线挂钩）；
 *  - 产品知识、情景演练；
 *  - 完成进度本机持久化；AI 不代完成、不放行任何授权。
 */

interface Lesson {
  id: string;
  section: "必修合规" | "产品知识" | "情景演练";
  title: string;
  detail: string;
  required?: boolean;
}

const LESSONS: Lesson[] = [
  { id: "L1", section: "必修合规", title: "顾问四项承诺", detail: "不私收款、不承诺结果、不改价、不使用未核准素材；逐项知悉并留时间戳。", required: true },
  { id: "L2", section: "必修合规", title: "词库与生产点红线", detail: "初评、方案、展业话术、资料四个生产点命中 block 词即拦截，不得绕过。", required: true },
  { id: "L3", section: "必修合规", title: "关系双向确认与一名主责", detail: "平台分配须客户确认；一名客户一名 active 主责顾问；换顾问走五步交接。", required: true },
  { id: "L4", section: "必修合规", title: "费用披露规则", detail: "费用分项、收取方、币种、确定性；异币种不相加不折总价；tbc 不参与合计。", required: true },
  { id: "L5", section: "产品知识", title: "技术居留项目要点", detail: "适用人群、关键政策事实核验周期、费表结构；以已发布版本为准。" },
  { id: "L6", section: "产品知识", title: "家庭授权与材料流程", detail: "成年成员本人授权、未成年监护证据、材料四态与补件三要素。" },
  { id: "L7", section: "情景演练", title: "客户要求“包成功”", detail: "合规替代说法：说明进度以官方/已核验记录为准，不做获批预测，并提供书面材料。" },
  { id: "L8", section: "情景演练", title: "客户要转个人账户", detail: "明确拒绝并引导至订单对公账户；解释待核验≠到账与双人核验规则。" }
];

const SECTIONS: Array<Lesson["section"]> = ["必修合规", "产品知识", "情景演练"];
const STORE_KEY = "tip_advisor_learning_v1";

export default function LearningScreen() {
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => raw && setDone(JSON.parse(raw) as Record<string, boolean>))
      .catch(() => {});
  }, []);

  function toggle(id: string) {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
  }

  const requiredIds = useMemo(() => LESSONS.filter((l) => l.required).map((l) => l.id), []);
  const requiredDone = requiredIds.filter((id) => done[id]).length;
  const totalDone = LESSONS.filter((l) => done[l.id]).length;

  return (
    <FlatList
      style={{ backgroundColor: colors.paper }}
      contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
      data={SECTIONS}
      keyExtractor={(s) => s}
      ListHeaderComponent={
        <View style={{ marginBottom: 14 }}>
          <LinearGradient
            colors={["#AF2D67", "#5E246B", "#002661"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 24, padding: 20 }}>
            <Text style={{ fontSize: 17, fontWeight: "800", color: "#fff" }}>学习与培训中心</Text>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,.88)", marginTop: 6 }}>
              必修合规 {requiredDone}/{requiredIds.length} · 全部课程 {totalDone}/{LESSONS.length}
            </Text>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,.25)", marginTop: 10 }}>
              <View style={{
                height: 6, borderRadius: 3, backgroundColor: "#fff",
                width: `${(totalDone / LESSONS.length) * 100}%` }} />
            </View>
          </LinearGradient>
        </View>
      }
      renderItem={({ item: section }) => (
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.navy, marginBottom: 8 }}>{section}</Text>
          {LESSONS.filter((l) => l.section === section).map((l) => {
            const isDone = !!done[l.id];
            return (
              <Pressable key={l.id} onPress={() => toggle(l.id)} style={{ marginBottom: 8 }}>
                <Card style={{ borderColor: isDone ? "#177A5B55" : colors.line }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>{l.title}</Text>
                        {l.required && <Tag text="必修" tone="berry" />}
                      </View>
                      <Text style={{ fontSize: 12, color: colors.mut, marginTop: 5, lineHeight: 19 }}>{l.detail}</Text>
                    </View>
                    <View style={{
                      width: 26, height: 26, borderRadius: 13, marginTop: 2,
                      borderWidth: 1.5, alignItems: "center", justifyContent: "center",
                      borderColor: isDone ? "#177A5B" : colors.line,
                      backgroundColor: isDone ? "#177A5B" : "transparent" }}>
                      <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>{isDone ? "✓" : ""}</Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    />
  );
}
