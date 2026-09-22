import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { api, type ProjectView, type FeeScheduleView } from "../api.js";
import { isFavorite, toggleFavorite } from "../storage.js";
import { Card, FeeLine, GradientButton, Loading, ErrorBox, Tag, colors } from "../ui.js";
import type { RootStackParamList } from "../navigation.js";

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 96, gap: 14 }}>
        <Card>
          <Text style={{ fontSize: 11.5, color: colors.faint, fontWeight: "600" }}>{project.code} · 版本 v{project.version}</Text>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.ink, marginTop: 8, lineHeight: 27 }}>{project.title}</Text>
          <View style={{ marginTop: 10 }}><Tag text="事实已核验后发布" tone="ok" /></View>
          <Text style={{ fontSize: 13.5, color: colors.mut, marginTop: 12, lineHeight: 21 }}>{project.body}</Text>
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

        <Card style={{ backgroundColor: colors.navy50, borderColor: colors.navy100 }}>
          <Text style={{ fontSize: 13, color: colors.navy, lineHeight: 20, fontWeight: "600" }}>
            初步评估只输出「符合 / 差距 / 待确认 / 未承诺」四类信息整理，不是资格认定，不代表获批结果。
          </Text>
        </Card>
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
