import { useCallback, useMemo, useState } from "react";
import { FlatList, Text, TextInput, View, Pressable } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, type ProjectView } from "../api";
import { Card, Loading, ErrorBox, EmptyBox, Tag, colors } from "../ui";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ProjectListScreen() {
  const nav = useNavigation<Nav>();
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.listProjects()
        .then((r) => alive && setProjects(r.records))
        .catch((e: Error) => alive && setError(e.message));
      return () => {
        alive = false;
      };
    }, [])
  );

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw || !projects) return projects ?? [];
    return projects.filter((p) => `${p.title} ${p.code} ${p.body}`.toLowerCase().includes(kw));
  }, [projects, q]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={{ backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, height: 44, justifyContent: "center" }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="搜索项目名称或关键词"
            placeholderTextColor={colors.faint}
            style={{ fontSize: 14, color: colors.ink, padding: 0 }}
          />
        </View>
      </View>
      {error ? <ErrorBox message={error} /> : null}
      {!error && projects === null ? <Loading /> : null}
      <FlatList
        contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 12 }}
        data={filtered}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={projects && !error ? <EmptyBox title="没有匹配的项目" sub="仅展示已通过核验与发布的项目；草稿、在审、暂停或下架内容不可见。" /> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => nav.navigate("ProjectDetail", { id: item.id, title: item.title })}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 11, color: colors.faint, fontWeight: "600" }}>{item.code} · v{item.version}</Text>
                <Tag text="已核验发布" tone="ok" />
              </View>
              <Text style={{ fontSize: 15.5, fontWeight: "700", color: colors.ink, marginTop: 8 }}>{item.title}</Text>
              <Text style={{ fontSize: 12.5, color: colors.mut, marginTop: 5, lineHeight: 18 }} numberOfLines={2}>{item.body}</Text>
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}
