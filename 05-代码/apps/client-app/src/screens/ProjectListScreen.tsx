import { useCallback, useMemo, useState } from "react";
import { SectionList, Text, TextInput, View, Pressable, ScrollView } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, type ProjectView } from "../api";
import { Loading, ErrorBox, EmptyBox, colors } from "../ui";
import { ProjectCard } from "../components/ProjectCard";
import { PROJECT_META, REGION_ORDER } from "../projectMeta";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface Section {
  region: string;
  data: ProjectView[];
}

export default function ProjectListScreen() {
  const nav = useNavigation<Nav>();
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [region, setRegion] = useState<string>("全部");

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

  const sections = useMemo<Section[]>(() => {
    if (!projects) return [];
    const kw = q.trim().toLowerCase();
    const filtered = projects.filter((p) => {
      const m = PROJECT_META[p.code];
      const hay = `${p.title} ${p.code} ${p.body} ${m?.country ?? ""} ${m?.kind ?? ""} ${(m?.chips ?? []).join(" ")}`.toLowerCase();
      const kwOk = !kw || hay.includes(kw);
      const regionOk = region === "全部" || m?.region === region;
      return kwOk && regionOk;
    });
    return REGION_ORDER.map((r) => ({
      region: r,
      data: filtered.filter((p) => PROJECT_META[p.code]?.region === r),
    })).filter((s) => s.data.length > 0);
  }, [projects, q, region]);

  const regionChips = ["全部", ...REGION_ORDER];

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink, letterSpacing: 0.3 }}>在售身份项目</Text>
        <Text style={{ fontSize: 12.5, color: colors.mut, marginTop: 4, lineHeight: 18 }}>
          共 {projects?.length ?? 0} 款，均通过事实核验与四眼发布；费用分项、收取方与依据文件全程可查。
        </Text>
        <View style={{ backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, height: 44, justifyContent: "center", marginTop: 12 }}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="搜索国家、项目或关键词"
            placeholderTextColor={colors.faint}
            style={{ fontSize: 14, color: colors.ink, padding: 0 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {regionChips.map((r) => {
            const on = region === r;
            return (
              <Pressable
                key={r}
                onPress={() => setRegion(r)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                  backgroundColor: on ? colors.navy : colors.white,
                  borderWidth: 1, borderColor: on ? colors.navy : colors.line,
                }}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "700", color: on ? colors.white : colors.mut }}>{r}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {error ? <ErrorBox message={error} /> : null}
      {!error && projects === null ? <Loading /> : null}
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ padding: 16, paddingTop: 10 }}
        renderSectionHeader={({ section }) => (
          <View style={{ marginTop: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 4, height: 14, borderRadius: 2, backgroundColor: colors.berry }} />
            <Text style={{ fontSize: 14.5, fontWeight: "800", color: colors.ink }}>{section.region}</Text>
            <Text style={{ fontSize: 11.5, color: colors.faint }}>{section.data.length} 款</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ProjectCard p={item} onOpen={() => nav.navigate("ProjectDetail", { id: item.id, title: item.title })} />
        )}
        SectionSeparatorComponent={() => <View style={{ height: 2 }} />}
        ListEmptyComponent={projects && !error ? <EmptyBox title="没有匹配的项目" sub="仅展示已通过核验与发布的项目；草稿、在审、暂停或下架内容不可见。" /> : null}
      />
    </View>
  );
}
