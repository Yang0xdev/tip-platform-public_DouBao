import { useCallback, useState } from "react";
import { FlatList, Text, View, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ProjectView } from "../api";
import { listFavorites, type FavoriteItem } from "../storage";
import { Card, GradientButton, Loading, ErrorBox, EmptyBox, Tag, colors, signatureGradient } from "../ui";
import { ProjectCard } from "../components/ProjectCard";
import { PROJECT_META } from "../projectMeta";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function HomeScreen() {
  const nav = useNavigation<Nav>();
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [favs, setFavs] = useState<FavoriteItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([api.listProjects(), listFavorites()]);
      setProjects(p.records);
      setFavs(f);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); listFavorites().then(setFavs); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ paddingBottom: 28 }}
      data={(projects ?? []).slice(0, 6)}
      keyExtractor={(p) => p.id}
      ListFooterComponent={
        projects && projects.length > 6 ? (
          <Pressable onPress={() => nav.navigate("Projects")} style={{ paddingHorizontal: 16, paddingTop: 4 }}>
            <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.white, paddingVertical: 14, alignItems: "center" }}>
              <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.navy }}>查看全部 {projects.length} 款在售项目 ›</Text>
            </View>
          </Pressable>
        ) : null
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.navy} />}
      ListHeaderComponent={
        <View>
          <LinearGradient colors={[...signatureGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ paddingHorizontal: 20, paddingTop: 26, paddingBottom: 30 }}>
            <Text style={{ color: "rgba(255,255,255,.82)", fontSize: 12.5, fontWeight: "600", letterSpacing: 0.6 }}>透明身份规划</Text>
            <Text style={{ color: "white", fontSize: 24, fontWeight: "800", marginTop: 6, letterSpacing: 0.3 }}>先看清路径，再决定</Text>
            <Text style={{ color: "rgba(255,255,255,.85)", fontSize: 13, marginTop: 8, lineHeight: 20 }}>
              公开的收费、可核验的事实、不承诺结果的初步评估。全程可追溯，不做成功暗示。
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
              <View style={{ flex: 1 }}>
                <GradientButton label="浏览身份项目" variant="berry" onPress={() => nav.navigate("Projects")} />
              </View>
            </View>
          </LinearGradient>

          <View style={{ padding: 16, gap: 14 }}>
            <Pressable onPress={() => nav.navigate("GlobalAccess")}>
              <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: colors.ink }}>全球通行</Text>
                    <Tag text="维护中" tone="muted" />
                  </View>
                  <Text style={{ fontSize: 12, color: colors.faint, marginTop: 5, lineHeight: 17 }}>
                    签证要求与护照对比依赖官方授权数据源，开放前仅展示框架，不提供国别数据。
                  </Text>
                </View>
                <Text style={{ color: colors.faint, fontSize: 18 }}>›</Text>
              </Card>
            </Pressable>

            {favs.length > 0 && (
              <Pressable onPress={() => nav.navigate("Favorites")}>
                <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }}>本机收藏与对比</Text>
                  <Text style={{ color: colors.navy, fontSize: 12.5, fontWeight: "600" }}>{favs.length} 项 ›</Text>
                </Card>
              </Pressable>
            )}

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
              <Text style={{ fontSize: 15, fontWeight: "800", color: colors.ink }}>在售项目</Text>
              {projects && projects.length > 0 ? (
                <Pressable onPress={() => nav.navigate("Projects")}>
                  <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.berry }}>全部 {projects.length} 款 ›</Text>
                </Pressable>
              ) : null}
            </View>
            {error ? <ErrorBox message={error} /> : null}
            {!error && projects === null ? <Loading /> : null}
            {!error && projects && projects.length === 0 ? (
              <EmptyBox title="暂无可展示项目" sub="项目须完成事实核验、收费关联与四眼发布后才会对客可见。" />
            ) : null}
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 16 }}>
          <ProjectCard
            p={item}
            onOpen={() => nav.navigate("ProjectDetail", { id: item.id, title: PROJECT_META[item.code]?.country ?? item.title })}
          />
        </View>
      )}
    />
  );
}
