import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { api, type ClientDetailView } from "../api";
import { Card, SectionLabel, Tag } from "../ui";

const TABS = ["业务", "跟进", "可见范围"] as const;

export default function ClientDetailScreen({ route }: { route: { params: { relationshipId: string; customerRef: string } } }) {
  const { relationshipId, customerRef } = route.params;
  const [tab, setTab] = useState<(typeof TABS)[number]>("业务");
  const [data, setData] = useState<ClientDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .clientDetail(relationshipId)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [relationshipId]);

  React.useEffect(load, [load]);

  return (
    <ScrollView style={{ backgroundColor: "#F5F7FA" }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: "#1B2433" }}>客户 {customerRef}</Text>
      <View style={{ flexDirection: "row", marginTop: 12, marginBottom: 14 }}>
        {TABS.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={{ marginRight: 8 }}>
            <Tag text={t} tone={tab === t ? "navy" : "default"} />
          </Pressable>
        ))}
      </View>

      {loading && <ActivityIndicator color="#0B3A82" />}
      {error && (
        <View style={{ backgroundColor: "#FCEBEA", borderRadius: 14, padding: 14 }}>
          <Text style={{ color: "#C03221", fontSize: 13 }}>{error}</Text>
        </View>
      )}

      {data && tab === "业务" && (
        <View>
          <Card>
            <SectionLabel text="方案" />
            {data.tabs.biz.proposals.length === 0 && <Text style={{ color: "#8A95A6", fontSize: 13 }}>暂无方案</Text>}
            {data.tabs.biz.proposals.map((p) => (
              <View key={p.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontFamily: "monospace", fontWeight: "700", color: "#1B2433", fontSize: 13 }}>{p.id}</Text>
                  <View style={{ width: 8 }} />
                  <Tag text={p.state} tone={p.state === "customer_confirmed" ? "ok" : "navy"} />
                </View>
                <Text style={{ marginTop: 4, color: "#8A95A6", fontSize: 12 }}>rev{p.revision} · 有效期至 {p.validUntil.slice(0, 10)}</Text>
              </View>
            ))}
          </Card>
          <Card>
            <SectionLabel text="订单（无支付明细）" />
            {data.tabs.biz.orders.length === 0 && <Text style={{ color: "#8A95A6", fontSize: 13 }}>暂无订单</Text>}
            {data.tabs.biz.orders.map((o) => (
              <View key={o.id} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Text style={{ fontFamily: "monospace", fontWeight: "700", color: "#1B2433", fontSize: 13 }}>{o.id}</Text>
                  <View style={{ width: 8 }} />
                  <Tag text={o.contractState} tone={o.contractState === "effective" ? "ok" : "navy"} />
                  {o.freezeStatus && (
                    <>
                      <View style={{ width: 6 }} />
                      <Tag text={o.freezeStatus} tone="warn" />
                    </>
                  )}
                </View>
                <Text style={{ marginTop: 4, color: "#8A95A6", fontSize: 12 }}>
                  {o.readyForCaseAt ? "已待建案（M3）" : data.tabs.biz.officialReceipts}
                </Text>
              </View>
            ))}
          </Card>
        </View>
      )}

      {data && tab === "跟进" && <FollowTab data={data} onChange={load} />}

      {data && tab === "可见范围" && (
        <View>
          <Card>
            <SectionLabel text="可见" />
            {data.tabs.scope.visible.map((s, i) => (
              <Text key={i} style={{ color: "#5E6B7E", fontSize: 14, lineHeight: 22 }}>· {s}</Text>
            ))}
          </Card>
          <Card>
            <SectionLabel text="不可见" />
            {data.tabs.scope.notVisible.map((s, i) => (
              <Text key={i} style={{ color: "#5E6B7E", fontSize: 14, lineHeight: 22 }}>· {s}</Text>
            ))}
            <View style={{ marginTop: 10, backgroundColor: "#EDF1F8", borderRadius: 12, padding: 10 }}>
              <Text style={{ color: "#0B3A82", fontSize: 12.5 }}>原件批次申请：{data.tabs.scope.originalBatchApply}</Text>
            </View>
          </Card>
        </View>
      )}
    </ScrollView>
  );
}

function FollowTab({ data, onChange }: { data: ClientDetailView; onChange: () => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"fact" | "internal">("fact");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [correctId, setCorrectId] = useState<string | null>(null);
  const [newText, setNewText] = useState("");
  const [note, setNote] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    setBusy(true);
    setErr(null);
    api
      .addFollow(data.customerRef, text.trim(), kind)
      .then(() => setText(""))
      .catch((e: Error) => setErr(e.message))
      .finally(() => {
        setBusy(false);
        onChange();
      });
  };

  const submitCorrect = () => {
    if (!newText.trim() || !note.trim()) return;
    setBusy(true);
    api
      .correctFollow(correctId!, newText.trim(), note.trim())
      .then(() => {
        setCorrectId(null);
        setNewText("");
        setNote("");
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => {
        setBusy(false);
        onChange();
      });
  };

  const records = [...data.tabs.follow.records].reverse();

  return (
    <View>
      <Card>
        <SectionLabel text="跟进时间线（不可删除，只能更正）" />
        {records.length === 0 && <Text style={{ color: "#8A95A6", fontSize: 13 }}>暂无跟进</Text>}
        {records.map((f) => (
          <View key={f.id} style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontFamily: "monospace", fontWeight: "700", color: "#0B3A82", fontSize: 12 }}>{f.id}</Text>
              <View style={{ width: 6 }} />
              <Tag text={f.kind === "fact" ? "对客可见" : "内部"} tone={f.kind === "fact" ? "ok" : "warn"} />
              {f.corrected && (
                <>
                  <View style={{ width: 6 }} />
                  <Tag text="已更正" tone="warn" />
                </>
              )}
            </View>
            <Text style={{ marginTop: 4, color: f.corrected ? "#8A95A6" : "#1B2433", fontSize: 14, lineHeight: 21 }}>{f.text}</Text>
            <Text style={{ marginTop: 2, color: "#8A95A6", fontSize: 11.5 }}>{new Date(f.createdAt).toLocaleString()}</Text>
            {f.correctedOf && <Text style={{ marginTop: 2, color: "#B45309", fontSize: 11.5 }}>更正自 {f.correctedOf}：{f.correctionNote}</Text>}
            {!f.corrected && (
              <Pressable onPress={() => setCorrectId(correctId === f.id ? null : f.id)} style={{ marginTop: 6 }}>
                <Text style={{ color: "#0B3A82", fontSize: 12.5, fontWeight: "700" }}>{correctId === f.id ? "取消更正" : "更正"}</Text>
              </Pressable>
            )}
            {correctId === f.id && (
              <View style={{ marginTop: 8 }}>
                <TextInput value={newText} onChangeText={setNewText} placeholder="更正后的内容" multiline style={input} />
                <TextInput value={note} onChangeText={setNote} placeholder="更正原因（必填）" style={{ ...input, marginTop: 8 }} />
                <Pressable onPress={submitCorrect} disabled={busy} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                  <Tag text={busy ? "提交中…" : "提交更正"} tone="navy" />
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </Card>

      <Card>
        <SectionLabel text="新增跟进（过词库校验）" />
        <View style={{ flexDirection: "row", marginBottom: 10 }}>
          <Pressable onPress={() => setKind("fact")} style={{ marginRight: 8 }}>
            <Tag text="事实（对客可见）" tone={kind === "fact" ? "ok" : "default"} />
          </Pressable>
          <Pressable onPress={() => setKind("internal")}>
            <Tag text="内部（不对客）" tone={kind === "internal" ? "warn" : "default"} />
          </Pressable>
        </View>
        <TextInput value={text} onChangeText={setText} placeholder="记录本次沟通事实…" multiline style={input} />
        {err && <Text style={{ color: "#C03221", fontSize: 12.5, marginTop: 8 }}>{err}</Text>}
        <Pressable onPress={submit} disabled={busy} style={{ marginTop: 12, alignSelf: "flex-start" }}>
          <Tag text={busy ? "提交中…" : "保存跟进"} tone="navy" />
        </Pressable>
      </Card>
    </View>
  );
}

const input = {
  borderWidth: 1,
  borderColor: "#E5E9F0",
  borderRadius: 14,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  color: "#1B2433",
  backgroundColor: "#fff",
  minHeight: 44
} as const;
