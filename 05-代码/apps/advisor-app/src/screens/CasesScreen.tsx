import React, { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { colors } from "@tip/ui-native";
import {
  api,
  type CaseRow,
  type MaterialRow,
  type TaskRow
} from "../api";
import { Card, Tag } from "../ui";

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

export default function CasesScreen() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [mats, setMats] = useState<MaterialRow[]>([]);

  const load = useCallback(async () => {
    const [c, t] = await Promise.all([api.cases(), api.tasks()]);
    setCases(c.records);
    setTasks(t.records.filter((x) => x.state !== "done"));
    setLoaded(true);
    setRefreshing(false);
  }, []);

  React.useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);

  async function open(id: string) {
    if (sel === id) {
      setSel(null);
      return;
    }
    setSel(id);
    const m = await api.materials(id);
    setMats(m.records);
  }

  return (
    <FlatList
      data={cases}
      keyExtractor={(x) => x.id}
      contentContainerStyle={{ padding: 14, gap: 10 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListHeaderComponent={
        <View>
          <Text style={styles.h1}>在办案件</Text>
          {tasks.filter((t) => Date.parse(t.dueAt) < Date.now()).length > 0 && (
            <Card style={{ borderLeftWidth: 3, borderLeftColor: colors.bad, marginBottom: 10 }}>
              <Text style={styles.overTitle}>已逾期待办</Text>
              {tasks
                .filter((t) => Date.parse(t.dueAt) < Date.now())
                .slice(0, 5)
                .map((t) => (
                  <Text key={t.id} style={styles.overRow} numberOfLines={1}>
                    {t.caseId} · {t.title}
                  </Text>
                ))}
            </Card>
          )}
        </View>
      }
      ListEmptyComponent={
        loaded ? <Text style={styles.empty}>暂无在办案件</Text> : <Text style={styles.empty}>加载中…</Text>
      }
      renderItem={({ item }) => {
        const activeEx = item.exceptions.filter((e) => e.active);
        const caseTasks = tasks.filter((t) => t.caseId === item.id);
        return (
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.caseId}>{item.id}</Text>
              <Tag text={STAGE_LABEL[item.stage] ?? item.stage} tone={activeEx.length ? "warn" : "navy"} />
            </View>
            <Text style={styles.customer}>客户：{item.customerRef}</Text>
            {activeEx.length > 0 && (
              <Text style={styles.exText}>异常：{activeEx.map((e) => e.reason).join("、")}</Text>
            )}
            {caseTasks.length > 0 && (
              <View style={{ marginTop: 8 }}>
                {caseTasks.slice(0, 3).map((t) => (
                  <View key={t.id} style={styles.taskRow}>
                    <Text style={styles.taskText} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Tag text={new Date(t.dueAt).toLocaleDateString("zh-CN")} tone="warn" />
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.toggle} onPress={() => open(item.id)}>
              {sel === item.id ? "收起材料清单" : "查看材料状态"}
            </Text>
            {sel === item.id && (
              <View style={{ marginTop: 8 }}>
                {mats.length === 0 && <Text style={styles.muted}>清单尚未生成</Text>}
                {mats.map((m) => (
                  <View key={m.id} style={styles.matRow}>
                    <Text style={styles.matText} numberOfLines={1}>
                      {m.title}（{m.personRef}）
                    </Text>
                    <Tag
                      text={
                        m.state === "approved"
                          ? "已通过"
                          : m.state === "returned"
                            ? "需补充"
                            : m.state === "submitted"
                              ? "审核中"
                              : "待上传"
                      }
                      tone={m.state === "approved" ? "ok" : m.state === "returned" ? "berry" : "default"}
                    />
                  </View>
                ))}
                <Text style={styles.note}>原件查看须经批次授权；顾问端不显示原件引用。</Text>
              </View>
            )}
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontWeight: "800", color: colors.ink, marginBottom: 10 },
  empty: { textAlign: "center", color: colors.faint, fontSize: 13, marginTop: 40 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  caseId: { fontSize: 15, fontWeight: "800", color: colors.ink },
  customer: { fontSize: 12, color: colors.faint, marginTop: 5 },
  exText: { fontSize: 12, color: colors.warn, marginTop: 6 },
  taskRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  taskText: { fontSize: 12.5, color: colors.ink, flex: 1, marginRight: 8 },
  toggle: { marginTop: 10, color: colors.navy, fontSize: 12.5, fontWeight: "700" },
  matRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  matText: { fontSize: 12.5, color: colors.ink, flex: 1, marginRight: 8 },
  muted: { fontSize: 12, color: colors.faint },
  note: { fontSize: 11, color: colors.faint, marginTop: 8, lineHeight: 16 },
  overTitle: { fontSize: 13, fontWeight: "800", color: colors.bad, marginBottom: 6 },
  overRow: { fontSize: 12, color: colors.bad, paddingVertical: 3 }
});
