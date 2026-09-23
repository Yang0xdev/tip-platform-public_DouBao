import { useCallback, useState } from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFavorites, toggleFavorite, type FavoriteItem } from "../storage";
import { api, type ProjectView } from "../api";
import { Card, EmptyBox, Tag, colors } from "../ui";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** M1-14 本机收藏比较：仅本机；比较公开字段（版本/核验事实数/收费方案），不做成功率类排序。 */
export default function FavoritesScreen() {
  const nav = useNavigation<Nav>();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [details, setDetails] = useState<Record<string, ProjectView>>({});
  const [selected, setSelected] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      listFavorites().then(async (favs) => {
        setItems(favs);
        const map: Record<string, ProjectView> = {};
        await Promise.all(
          favs.map(async (f) => {
            try {
              map[f.id] = await api.getProject(f.id);
            } catch {
              /* 已下架/不可见则跳过详情，保留收藏条目并提示 */
            }
          })
        );
        setDetails(map);
      });
    }, [])
  );

  if (items.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <EmptyBox title="还没有本机收藏" sub="在项目详情页点「本机收藏」，可离线保存公开信息并做并列比较；收藏只存在本机。" />
      </View>
    );
  }

  const chosen = selected.length >= 2 ? items.filter((f) => selected.includes(f.id)).slice(0, 3) : [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 12.5, color: colors.mut, lineHeight: 19 }}>
        点选 2–3 个项目进行比较（仅比较公开、可核验字段；不提供获批率类指标）。
      </Text>
      {items.map((f) => {
        const on = selected.includes(f.id);
        const d = details[f.id];
        return (
          <Pressable key={f.id} onPress={() => setSelected((s) => (on ? s.filter((x) => x !== f.id) : s.length >= 3 ? s : [...s, f.id]))}>
            <Card style={{ borderColor: on ? colors.navy : colors.line, backgroundColor: on ? colors.navy50 : colors.white }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 11, color: colors.faint }}>{f.code} · v{f.version}</Text>
                {on ? <Tag text="已选" tone="info" /> : d ? <Tag text="已核验" tone="ok" /> : <Tag text="已不可见" tone="muted" />}
              </View>
              <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink, marginTop: 6 }}>{f.title}</Text>
              <View style={{ flexDirection: "row", gap: 14, marginTop: 10 }}>
                <Text style={{ fontSize: 11.5, color: colors.faint }}>核验事实 {d?.keyFactIds.length ?? "—"}</Text>
                <Text style={{ fontSize: 11.5, color: colors.faint }}>收费方案 {d?.feeScheduleId ? "已关联" : "—"}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
                <Text style={{ fontSize: 12, color: colors.navy, fontWeight: "600" }} onPress={() => nav.navigate("ProjectDetail", { id: f.id, title: f.title })}>查看详情 ›</Text>
                <Text style={{ fontSize: 12, color: colors.berry, fontWeight: "600" }} onPress={async () => {
                  const full = details[f.id];
                  if (full) await toggleFavorite(full);
                  setItems(await listFavorites());
                  setSelected((s) => s.filter((x) => x !== f.id));
                }}>移除收藏</Text>
              </View>
            </Card>
          </Pressable>
        );
      })}

      {chosen.length >= 2 && (
        <Card>
          <Text style={{ fontSize: 14.5, fontWeight: "800", color: colors.ink, marginBottom: 10 }}>并列比较</Text>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 86 }} />
            {chosen.map((f) => (
              <Text key={f.id} style={{ flex: 1, fontSize: 11.5, fontWeight: "700", color: colors.ink, paddingHorizontal: 4 }} numberOfLines={2}>{f.title}</Text>
            ))}
          </View>
          {([
            { label: "版本", render: (f: FavoriteItem) => `v${f.version}` },
            { label: "核验事实", render: (f: FavoriteItem) => String(details[f.id]?.keyFactIds.length ?? "—") },
            { label: "收费方案", render: (f: FavoriteItem) => (details[f.id]?.feeScheduleId ? "已分项公开" : "—") }
          ] as const).map((row) => (
            <View key={row.label} style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.lineSoft, paddingVertical: 9 }}>
              <View style={{ width: 86 }}><Text style={{ fontSize: 12, color: colors.faint }}>{row.label}</Text></View>
              {chosen.map((f) => (
                <Text key={f.id} style={{ flex: 1, fontSize: 12, color: colors.mut, paddingHorizontal: 4 }}>{row.render(f)}</Text>
              ))}
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
