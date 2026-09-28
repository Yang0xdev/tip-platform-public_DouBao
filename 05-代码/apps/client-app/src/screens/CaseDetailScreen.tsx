import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "@tip/ui-native";
import {
  api,
  type CaseView,
  type MaterialView,
  type TaskView,
  type TimelineEventView
} from "../api";
import { Card, ErrorBox, Loading, Rise, Tag } from "../ui";

const LEVEL_LABEL: Record<string, string> = {
  cu: "我的记录",
  co: "平台记录",
  sp: "服务方报告（未经官方核验）",
  off: "官方记录"
};

export default function CaseDetailScreen({ route }: { route: { params: { id: string } } }) {
  const caseId = route.params.id;
  const [data, setData] = useState<{
    c: CaseView;
    tl: TimelineEventView[];
    mats: MaterialView[];
    tasks: TaskView[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, tl, mats, tasks] = await Promise.all([
        api.getCase(caseId),
        api.listTimeline(caseId),
        api.listMaterials(caseId),
        api.listTasks()
      ]);
      setData({
        c,
        tl: tl.records.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
        mats: mats.records,
        tasks: tasks.records.filter((t) => t.caseId === caseId && t.state !== "done")
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [caseId]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Rise level={0}>
        <Card>
          <View style={styles.head}>
            <Text style={styles.title}>{data.c.id}</Text>
            <Text style={styles.sub}>主责顾问：{data.c.advisorId}</Text>
          </View>
        </Card>
      </Rise>

      {data.tasks.length > 0 && (
        <Rise level={1}>
          <Card style={{ borderLeftWidth: 3, borderLeftColor: colors.berry }}>
            <Text style={styles.t0Title}>待办（按截止时间）</Text>
            {data.tasks.map((t) => {
              const overdue = Date.parse(t.dueAt) < Date.now();
              return (
                <View key={t.id} style={styles.t0Row}>
                  <Text style={[styles.t0Text, overdue && { color: colors.bad }]}>{t.title}</Text>
                  <Tag text={new Date(t.dueAt).toLocaleDateString("zh-CN")} tone={overdue ? "bad" : "warn"} />
                </View>
              );
            })}
          </Card>
        </Rise>
      )}

      <Rise level={2}>
        <Card>
          <Text style={styles.sectionTitle}>办理时间线</Text>
          {data.tl.length === 0 && <Text style={styles.muted}>暂无记录</Text>}
          {data.tl.map((e) => (
            <View key={e.id} style={styles.tlRow}>
              <View
                style={[
                  styles.tlDot,
                  {
                    backgroundColor:
                      e.level === "off" ? colors.ok : e.level === "sp" ? colors.warn : colors.navy
                  }
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.tlTitle}>{e.title}</Text>
                <Text style={styles.tlMeta}>
                  {LEVEL_LABEL[e.level]} · {new Date(e.occurredAt).toLocaleDateString("zh-CN")}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      </Rise>

      <Rise level={3}>
        <Card>
          <Text style={styles.sectionTitle}>我的材料</Text>
          {data.mats.length === 0 && <Text style={styles.muted}>材料清单生成后显示</Text>}
          {data.mats.map((m) => (
            <View key={m.id} style={styles.matRow}>
              <Text style={styles.matTitle} numberOfLines={1}>
                {m.title}
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
                tone={m.state === "approved" ? "ok" : m.state === "returned" ? "berry" : "muted"}
              />
            </View>
          ))}
        </Card>
      </Rise>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  title: { fontSize: 17, fontWeight: "800", color: colors.ink },
  sub: { fontSize: 12, color: colors.faint },
  sectionTitle: { fontSize: 14, fontWeight: "800", color: colors.ink, marginBottom: 10 },
  muted: { fontSize: 12, color: colors.faint },
  tlRow: { flexDirection: "row", gap: 10, paddingVertical: 7 },
  tlDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  tlTitle: { fontSize: 13, color: colors.ink, fontWeight: "600" },
  tlMeta: { fontSize: 11, color: colors.faint, marginTop: 2 },
  matRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7
  },
  matTitle: { fontSize: 13, color: colors.ink, flex: 1, marginRight: 8 },
  t0Title: { fontSize: 13, fontWeight: "800", color: colors.berry, marginBottom: 6 },
  t0Row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  t0Text: { fontSize: 13, color: colors.ink, flex: 1, marginRight: 8 }
});
