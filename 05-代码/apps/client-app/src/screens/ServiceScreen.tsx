import { useCallback, useState } from "react";
import { FlatList, Text, View, Pressable, ScrollView, TextInput } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../api";
import { Card, Tag, colors, signatureGradient } from "../ui";

interface TicketView {
  id: string;
  kind: string;
  title: string;
  state: string;
  complaintCategory: string | null;
  createdAt: string;
}

const EDU = [
  {
    title: "识别“私下转账”",
    body: "平台只认签约主体的对公账户。任何要求把费用转到顾问个人账户、微信或支付宝的行为，都可以一键投诉。",
    tag: "资金安全"
  },
  {
    title: "“包成功 / 有关系”是违规话术",
    body: "审批结果由官方决定，任何承诺获批、暗示内部关系的说法都不成立。系统对这类话术做生产点拦截。",
    tag: "话术红线"
  },
  {
    title: "费用先看清",
    body: "平台服务费、境外服务费、官方费分项列明收取方与币种；待确认费用不会提前收取。",
    tag: "透明收费"
  },
  {
    title: "进度以官方凭据为准",
    body: "受理、批准等关键节点必须有官方凭据并经双人核验；服务方说法会标注“未经官方核验”。",
    tag: "进度核验"
  }
];

const KINDS: Array<{ key: "consult" | "question" | "data_change" | "complaint"; label: string }> = [
  { key: "consult", label: "咨询" },
  { key: "question", label: "疑问" },
  { key: "data_change", label: "资料变更" },
  { key: "complaint", label: "投诉" }
];

export default function ServiceScreen() {
  const [tickets, setTickets] = useState<TicketView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<"consult" | "question" | "data_change" | "complaint">("consult");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.listTickets();
      setTickets(r.records);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      setError("标题与描述必填");
      return;
    }
    setSubmitting(true);
    try {
      await api.createTicket({ kind, title: title.trim(), description: description.trim() });
      setFormOpen(false);
      setTitle("");
      setDescription("");
      setError(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ paddingBottom: 32 }}>
      <LinearGradient colors={[...signatureGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ paddingHorizontal: 20, paddingTop: 26, paddingBottom: 28 }}>
        <Text style={{ color: "rgba(255,255,255,.82)", fontSize: 12.5, fontWeight: "600", letterSpacing: 0.6 }}>服务与保障</Text>
        <Text style={{ color: "white", fontSize: 23, fontWeight: "800", marginTop: 6 }}>有问题，这里闭环</Text>
        <Text style={{ color: "rgba(255,255,255,.85)", fontSize: 13, marginTop: 8, lineHeight: 20 }}>
          咨询、资料变更、投诉都有独立队列与时效；投诉由合规团队处理，被投诉人全程回避。
        </Text>
      </LinearGradient>

      <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <Text style={{ fontSize: 16.5, fontWeight: "800", color: colors.ink }}>我的工单</Text>
          <Pressable onPress={() => setFormOpen((v) => !v)} hitSlop={8}>
            <Text style={{ color: colors.berry, fontSize: 13.5, fontWeight: "700" }}>{formOpen ? "收起" : "＋ 新建工单"}</Text>
          </Pressable>
        </View>

        {formOpen && (
          <Card style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {KINDS.map((k) => (
                <Pressable key={k.key} onPress={() => setKind(k.key)} hitSlop={6}>
                  <Tag text={k.label} tone={kind === k.key ? "berry" : "muted"} />
                </Pressable>
              ))}
            </View>
            <TextInput value={title} onChangeText={setTitle} placeholder="标题"
              style={{ marginTop: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, height: 44, fontSize: 15 }} />
            <TextInput value={description} onChangeText={setDescription} placeholder="描述具体情况" multiline
              style={{ marginTop: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 14, paddingTop: 12, height: 96, fontSize: 15, textAlignVertical: "top" }} />
            {error && <Text style={{ color: colors.bad, fontSize: 12.5, marginTop: 8 }}>{error}</Text>}
            <Pressable onPress={submit} disabled={submitting}
              style={{ marginTop: 12, height: 46, borderRadius: 22, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", opacity: submitting ? 0.6 : 1 }}>
              <Text style={{ color: "white", fontWeight: "700", fontSize: 14.5 }}>{submitting ? "提交中…" : "提交工单"}</Text>
            </Pressable>
          </Card>
        )}

        {(tickets ?? []).map((t) => (
          <Card key={t.id} style={{ marginBottom: 10 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink, flex: 1 }}>{t.title}</Text>
              <Tag text={t.state} tone={t.kind === "complaint" ? "berry" : "info"} />
            </View>
            <Text style={{ fontSize: 12, color: colors.mut, marginTop: 6 }}>
              {t.id} · {t.complaintCategory ?? t.kind} · {t.createdAt.slice(0, 10)}
            </Text>
          </Card>
        ))}
        {tickets && tickets.length === 0 && !formOpen && (
          <Text style={{ color: colors.faint, fontSize: 13, textAlign: "center", marginVertical: 18 }}>还没有工单，有疑问随时新建。</Text>
        )}
      </View>

      <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
        <Text style={{ fontSize: 16.5, fontWeight: "800", color: colors.ink, marginBottom: 10 }}>防骗教育专区</Text>
        {EDU.map((e) => (
          <Card key={e.title} style={{ marginBottom: 10 }}>
            <Tag text={e.tag} tone="warn" />
            <Text style={{ fontSize: 14.5, fontWeight: "700", color: colors.ink, marginTop: 8 }}>{e.title}</Text>
            <Text style={{ fontSize: 13, color: colors.mut, marginTop: 5, lineHeight: 19 }}>{e.body}</Text>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}
