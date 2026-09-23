import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View, Pressable } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { api, type Questionnaire, type EvaluateResponse } from "../api";
import { Card, GradientButton, Loading, ErrorBox, Tag, colors } from "../ui";
import type { RootStackParamList } from "../navigation";

type R = RouteProp<RootStackParamList, "Assessment">;
type Answers = Record<string, string | number | undefined>;

const OUTCOME_META: Record<EvaluateResponse["outcome"], { label: string; tone: "ok" | "warn" | "bad" | "muted"; body: string }> = {
  eligible: { label: "初步符合（条件匹配）", tone: "ok", body: "已完成维度与该项目公开条件初步匹配，仍以官方审核为准。" },
  gap: { label: "存在差距", tone: "bad", body: "部分维度与公开条件存在差距，可查看差距项与补充路径。" },
  unconfirmed: { label: "待确认", tone: "warn", body: "信息不足以完成匹配，请补充待确认项后再评估。" },
  not_committed: { label: "未承诺（信息未完成）", tone: "muted", body: "仍有必填项未完成，以下仅为已完成部分的信息整理。" }
};

export default function AssessmentScreen() {
  const route = useRoute<R>();
  const { projectCode } = route.params;
  const [q, setQ] = useState<Questionnaire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);

  useEffect(() => {
    api.getQuestionnaire()
      .then(setQ)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!q) return <Loading label="加载问卷…" />;

  const groups = Array.from(new Set(q.content.questions.map((x) => x.group)));
  const missing = q.content.questions.filter((x) => x.required && (answers[x.code] === undefined || answers[x.code] === "")).map((x) => x.title);

  const submit = async () => {
    if (missing.length > 0) {
      setValidationMsg(`还有 ${missing.length} 个必填项未完成，无法给出确定性结论。`);
      return;
    }
    setValidationMsg(null);
    setSubmitting(true);
    try {
      setResult(await api.evaluate(projectCode, answers));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    const meta = OUTCOME_META[result.outcome];
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
        <Card>
          <Text style={{ fontSize: 11.5, color: colors.faint }}>{projectCode} · 问卷 q-v{result.questionnaireVersion} · 规则 {result.ruleVersion}</Text>
          <View style={{ marginTop: 10 }}><Tag text={meta.label} tone={meta.tone} /></View>
          <Text style={{ fontSize: 13, color: colors.mut, marginTop: 10, lineHeight: 20 }}>{meta.body}</Text>
          {result.notCommittedNote ? <Text style={{ fontSize: 12.5, color: colors.warn, marginTop: 8, lineHeight: 19 }}>{result.notCommittedNote}</Text> : null}
        </Card>
        {(["met", "gap", "unconfirmed"] as const).map((k) => {
          const dims = result.sections[k];
          const title = { met: "符合项", gap: "差距项", unconfirmed: "待确认项" }[k];
          if (dims.length === 0) return null;
          return (
            <Card key={k}>
              <Text style={{ fontSize: 14.5, fontWeight: "800", color: colors.ink, marginBottom: 8 }}>{title}（{dims.length}）</Text>
              {dims.map((d) => (
                <View key={d.code} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.lineSoft }}>
                  <Text style={{ fontSize: 13.5, fontWeight: "600", color: colors.ink }}>{d.label}</Text>
                  {d.reasons.length > 0 ? <Text style={{ fontSize: 12, color: colors.mut, marginTop: 3, lineHeight: 18 }}>{d.reasons.join("；")}</Text> : null}
                </View>
              ))}
            </Card>
          );
        })}
        <Card style={{ backgroundColor: colors.navy50, borderColor: colors.navy100 }}>
          <Text style={{ fontSize: 12, color: colors.navy, lineHeight: 19 }}>{result.disclaimer}</Text>
          <Text style={{ fontSize: 11.5, color: colors.faint, marginTop: 8, lineHeight: 18 }}>{result.sections.sources.note}</Text>
          {result.needsManualNote ? <Text style={{ fontSize: 11.5, color: colors.mut, marginTop: 6, lineHeight: 18 }}>{result.needsManualNote}</Text> : null}
        </Card>
        <GradientButton label="重新评估" variant="berry" onPress={() => setResult(null)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}>
      <Card style={{ backgroundColor: colors.navy50, borderColor: colors.navy100 }}>
        <Text style={{ fontSize: 12.5, color: colors.navy, lineHeight: 19 }}>
          {q.title}（v{q.version}）。答案仅在本机提交做无状态匹配，不保存明细、不产生顾问归属。
        </Text>
      </Card>
      {groups.map((g) => (
        <Card key={g}>
          <Text style={{ fontSize: 13, fontWeight: "800", color: colors.berry, marginBottom: 10 }}>{g}</Text>
          {q.content.questions.filter((x) => x.group === g).map((item) => {
            const val = answers[item.code];
            return (
              <View key={item.code} style={{ marginBottom: 14 }}>
                <Text style={{ fontSize: 13.5, color: colors.ink, fontWeight: "600", marginBottom: 8, lineHeight: 20 }}>
                  {item.title}{item.required ? <Text style={{ color: colors.berry }}> *</Text> : null}
                </Text>
                {item.type === "single" || item.type === "choice" ? (
                  <View style={{ gap: 8 }}>
                    {(item.options ?? []).map((o) => {
                      const on = String(val ?? "") === o.value;
                      return (
                        <Pressable key={o.value} onPress={() => setAnswers((a) => ({ ...a, [item.code]: o.value }))}
                          style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: on ? colors.navy : colors.line, backgroundColor: on ? colors.navy50 : colors.white }}>
                          <View style={{ width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, borderColor: on ? colors.navy : colors.faint, alignItems: "center", justifyContent: "center" }}>
                            {on ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.navy }} /> : null}
                          </View>
                          <Text style={{ fontSize: 13, color: colors.ink }}>{o.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <TextInput
                    value={val === undefined ? "" : String(val)}
                    keyboardType={item.type === "number" ? "numeric" : "default"}
                    onChangeText={(t) => setAnswers((a) => ({ ...a, [item.code]: item.type === "number" ? (t === "" ? undefined : Number(t)) : t }))}
                    placeholder="请填写"
                    placeholderTextColor={colors.faint}
                    style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, height: 44, fontSize: 13.5, color: colors.ink, backgroundColor: colors.white }}
                  />
                )}
              </View>
            );
          })}
        </Card>
      ))}
      {validationMsg ? (
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.warnBg }}>
          <Text style={{ color: colors.warn, fontSize: 12.5, lineHeight: 19 }}>{validationMsg}</Text>
        </View>
      ) : null}
      <GradientButton label={submitting ? "匹配中…" : "查看初步评估结果"} disabled={submitting} onPress={submit} />
    </ScrollView>
  );
}
