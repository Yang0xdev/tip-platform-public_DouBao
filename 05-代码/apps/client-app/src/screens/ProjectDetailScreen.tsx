import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { api, type ProjectView, type FeeScheduleView } from "../api";
import { isFavorite, toggleFavorite } from "../storage";
import { Card, FeeLine, GradientButton, Loading, ErrorBox, Tag, colors } from "../ui";
import { PROJECT_META } from "../projectMeta";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList, "ProjectDetail">;
type R = RouteProp<RootStackParamList, "ProjectDetail">;

export default function ProjectDetailScreen({ route }: { route: R; navigation: Nav }) {
  const nav = useNavigation<Nav>();
  const { id } = route.params;
  const [project, setProject] = useState<ProjectView | null>(null);
  const [fee, setFee] = useState<FeeScheduleView | null>(null);
  const [fav, setFav] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setError(null);
      api.getProject(id)
        .then(async (p) => {
          if (!alive) return;
          setProject(p);
          setFav(await isFavorite(p.id));
          if (p.feeScheduleId) {
            try {
              setFee(await api.getFeeSchedule(p.feeScheduleId));
            } catch {
              /* 收费方案缺失不阻断项目内容；M1 发布门已保证关联，缺失属异常，留空 */
            }
          }
        })
        .catch((e: Error) => alive && setError(e.message));
      return () => {
        alive = false;
      };
    }, [id])
  );

  if (error) return <ErrorBox message={error} />;
  if (!project) return <Loading label="加载项目详情…" />;
  const m = PROJECT_META[project.code];
  const g: [string, string] = m?.gradient ?? ["#5E246B", "#002661"];

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        <LinearGradient colors={g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingHorizontal: 18, paddingTop: 22, paddingBottom: 22 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ backgroundColor: "rgba(255,255,255,.18)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>{m?.kind ?? "身份项目"}</Text>
            </View>
            <Text style={{ color: "rgba(255,255,255,.85)", fontSize: 11.5, fontWeight: "600" }}>{m?.region} · {m?.country ?? project.code}</Text>
          </View>
          <Text style={{ color: "white", fontSize: 22, fontWeight: "800", marginTop: 12, lineHeight: 29 }}>{m?.country ?? project.title}</Text>
          <Text style={{ color: "rgba(255,255,255,.92)", fontSize: 13, marginTop: 6, lineHeight: 20 }}>{m?.tagline}</Text>
          {m ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {m.chips.map((c) => (
                <View key={c} style={{ backgroundColor: "rgba(255,255,255,.16)", borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 }}>
                  <Text style={{ color: "white", fontSize: 11, fontWeight: "600" }}>{c}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </LinearGradient>

        <View style={{ padding: 16, gap: 14 }}>
          <Card style={{ backgroundColor: m ? colors.navy50 : colors.white }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.navy }}>{m?.anchor ?? "费用分项可查"}</Text>
            <Text style={{ fontSize: 11, color: colors.faint, fontWeight: "600", marginTop: 6 }}>{project.code} · 版本 v{project.version} · 事实已核验后发布</Text>
          </Card>
          <Card>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.ink }}>项目说明</Text>
            <Text style={{ fontSize: 13.5, color: colors.mut, marginTop: 10, lineHeight: 21 }}>{project.body}</Text>
          </Card>

        <Card>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.ink }}>费用分项</Text>
          <Text style={{ fontSize: 11.5, color: colors.faint, marginTop: 4, lineHeight: 17 }}>
            各费用项分别列示收取方、币种与确定性；不同币种不相加、不折算总价，待确认项不计入任何合计。
          </Text>
          {fee ? (
            <View style={{ marginTop: 6 }}>
              <Text style={{ fontSize: 12.5, color: colors.mut, marginBottom: 4 }}>{fee.title} · v{fee.version}</Text>
              {fee.feeItems.map((it) => (
                <FeeLine key={it.code} item={it as never} />
              ))}
            </View>
          ) : (
            <Text style={{ fontSize: 12.5, color: colors.faint, marginTop: 12 }}>收费方案准备中。</Text>
          )}
        </Card>

        <Card>
          <Text style={{ fontSize: 13, color: colors.navy, lineHeight: 20, fontWeight: "600" }}>
            初步评估只输出「符合 / 差距 / 待确认 / 未承诺」四类信息整理，不是资格认定，不代表获批结果。
          </Text>
        </Card>
        </View>
      </ScrollView>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: "rgba(245,247,250,.96)", borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <GradientButton label={fav ? "已收藏（点击取消）" : "本机收藏"} variant="berry" onPress={async () => setFav(await toggleFavorite(project))} />
        </View>
        <View style={{ flex: 1.3 }}>
          <GradientButton label="开始初步评估" onPress={() => nav.navigate("Assessment", { projectCode: project.code })} />
        </View>
      </View>
    </View>
  );
}
