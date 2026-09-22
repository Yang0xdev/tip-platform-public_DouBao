import { useCallback, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFavorites } from "../storage.js";
import { Card, Tag, colors } from "../ui.js";
import type { RootStackParamList } from "../navigation.js";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProfileScreen() {
  const nav = useNavigation<Nav>();
  const [favCount, setFavCount] = useState(0);
  useFocusEffect(useCallback(() => { listFavorites().then((f) => setFavCount(f.length)); }, []));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 18, color: colors.navy, fontWeight: "800" }}>客</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.ink }}>游客模式</Text>
            <Text style={{ fontSize: 12, color: colors.faint, marginTop: 2 }}>浏览、初评与本机收藏无需注册；账户体系在后续里程碑开放。</Text>
          </View>
          <Tag text="M1" tone="muted" />
        </View>
      </Card>

      <Pressable onPress={() => nav.navigate("Favorites")}>
        <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>本机收藏与对比</Text>
          <Text style={{ fontSize: 12.5, color: colors.navy, fontWeight: "600" }}>{favCount} 项 ›</Text>
        </Card>
      </Pressable>

      <Card>
        <Text style={{ fontSize: 14, fontWeight: "800", color: colors.ink, marginBottom: 8 }}>我们的承诺</Text>
        {[
          "项目内容经事实核验与四眼发布后才展示，失效内容自动下架",
          "费用分项、收取方、币种与确定性公开，不做跨币种总价",
          "初步评估只做条件匹配，不给获批承诺、不做成功暗示",
          "全球通行仅使用官方授权数据源，未授权时只显示框架"
        ].map((t) => (
          <View key={t} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
            <Text style={{ color: colors.berry, fontSize: 13, fontWeight: "800" }}>•</Text>
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.mut, lineHeight: 19 }}>{t}</Text>
          </View>
        ))}
      </Card>

      <Text style={{ fontSize: 11, color: colors.faint, textAlign: "center", marginTop: 8 }}>透明身份规划平台客户端 · M1 影子版本</Text>
    </ScrollView>
  );
}
