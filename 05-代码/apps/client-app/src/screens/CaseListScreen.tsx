import React, { useCallback, useState } from "react";
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors } from "@tip/ui-native";
import { api, type CaseView, type TaskView } from "../api";
import { Card, EmptyBox, ErrorBox, Loading, Rise, Tag } from "../ui";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STAGE_LABEL: Record<string, string> = {
  material_prep: "材料准备",
  pending_submit: "待递交",
  submitted: "已递交",
  accepted: "官方已受理",
  supplementing: "补件中",
  reviewing: "审核中",
  approved: "官方已批准",
  refused: "官方未批准",
  closed: "已结案"
};

/** 步骤条：只显示当前阶段，不显示百分比/成功率 */
function StageStrip({ stage }: { stage: string }) {
  const order = ["material_prep", "pending_submit", "submitted", "accepted", "reviewing", "approved", "closed"];
  const idx = order.indexOf(stage);
  return (
    <View style={styles.strip}>
      {order.map((s, i) => {
        const done = idx > i;
        const here = i === idx;
        return (
          <View key={s} style={styles.dotWrap}>
            <View
              style={[
                styles.dot,
                done && { backgroundColor: colors.ok },
                here && { backgroundColor: colors.navy, borderColor: colors.navy }
              ]}
            />
            {i < order.length - 1 && (
              <View style={[styles.line, done && { backgroundColor: colors.ok }]} />
            )}
          </View>
        );
      })}
    </View>
  );
}

export default function CaseListScreen() {
  const nav = useNavigation<Nav>();
  const [cases, setCases] = useState<CaseView[] | null>(null);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, t] = await Promise.all([api.listCases(), api.listTasks()]);
      setCases(c.records);
      const now = Date.now();
      setTasks(
        t.records
          .filter((x) => x.state !== "done")
          .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
          .slice(0, 3)
      );
    } catch (e) {
      // 加载失败保留缓存、不伪装空态
      if (!cases) setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <ScrollView contentContainerStyle={styles.center}>
        <ErrorBox message={error} />
      </ScrollView>
    );
  if (!cases) return <Loading />;
  if (cases.length === 0)
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      >
        <EmptyBox title="还没有进行中的案件" sub="确认方案并完成首付后，案件会出现在这里。" />
      </ScrollView>
    );

  return (
    <FlatList
      data={cases}
      keyExtractor={(x) => x.id}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        tasks.length > 0 ? (
          <Rise level={0}>
            <Card style={styles.t0Card}>
              <Text style={styles.t0Title}>待办提醒</Text>
              {tasks.map((t) => {
                const overdue = Date.parse(t.dueAt) < Date.now();
                return (
                  <View key={t.id} style={styles.t0Row}>
                    <Text style={[styles.t0Text, overdue && { color: colors.bad }]} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Tag text={new Date(t.dueAt).toLocaleDateString("zh-CN")} tone={overdue ? "bad" : "warn"} />
                  </View>
                );
              })}
            </Card>
          </Rise>
        ) : null
      }
      renderItem={({ item, index }) => {
        const activeEx = item.exceptions.filter((e) => e.active);
        return (
          <Rise level={index}>
            <Card>
              <View style={styles.cardHead}>
                <Text style={styles.caseId}>{item.id}</Text>
                <Tag text={STAGE_LABEL[item.stage] ?? item.stage} tone={activeEx.length ? "warn" : "info"} />
              </View>
              <StageStrip stage={item.stage} />
              {activeEx.length > 0 && (
                <Text style={styles.exText}>
                  当前状态：{activeEx.map((e) => e.reason).join("、")}，顾问将与您联系安排后续。
                </Text>
              )}
              <Text
                style={styles.detailLink}
                onPress={() => nav.navigate("CaseDetail", { id: item.id })}
              >
                查看办理详情
              </Text>
            </Card>
          </Rise>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  caseId: { fontSize: 15, fontWeight: "800", color: colors.ink },
  strip: { flexDirection: "row", alignItems: "center" },
  dotWrap: { flexDirection: "row", alignItems: "center", flex: 1 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.white
  },
  line: { flex: 1, height: 2, backgroundColor: colors.line },
  exText: { marginTop: 10, fontSize: 12, color: colors.warn, lineHeight: 18 },
  detailLink: { marginTop: 12, color: colors.navy, fontSize: 13, fontWeight: "700" },
  t0Card: { borderLeftWidth: 3, borderLeftColor: colors.berry },
  t0Title: { fontSize: 13, fontWeight: "800", color: colors.berry, marginBottom: 8 },
  t0Row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  t0Text: { fontSize: 13, color: colors.ink, flex: 1, marginRight: 8 }
});
