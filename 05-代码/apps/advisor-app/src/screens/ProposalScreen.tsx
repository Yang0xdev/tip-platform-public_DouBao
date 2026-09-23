import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View
} from "react-native";
import { api, type ProposalView, type RelationshipView } from "../api";
import { Card, SectionLabel, Tag } from "../ui";
import { PrimaryButton, riseEntering } from "@tip/ui-native";

const STATE: Record<string, { text: string; tone: "default" | "ok" | "warn" | "berry" }> = {
  advisor_draft: { text: "草稿", tone: "default" },
  pending_review: { text: "待复核", tone: "warn" },
  pending_customer: { text: "待客户确认", tone: "berry" },
  customer_confirmed: { text: "客户已确认", tone: "ok" },
  rejected_review: { text: "复核驳回", tone: "warn" },
  invalid: { text: "已失效", tone: "default" }
};

export default function ProposalScreen() {
  const [records, setRecords] = useState<ProposalView[] | null>(null);
  const [clients, setClients] = useState<RelationshipView[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ customerRef: "", advice: "", responsibilities: "", validDays: "14" });

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([api.proposals(), api.clients()]);
    setRecords(p.records);
    setClients(c.records);
    if (!form.customerRef && c.records[0]) setForm((f) => ({ ...f, customerRef: c.records[0]!.customerRef }));
  }, [form.customerRef]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (submit: boolean) => {
    setError(null);
    if (!form.customerRef || !form.advice.trim() || !form.responsibilities.trim()) {
      setError("客户、个性化建议、责任分工均必填");
      return;
    }
    setBusy(true);
    try {
      const body = {
        customerRef: form.customerRef,
        projectCode: "PROJ-TECH-A",
        advice: [{ text: form.advice, manualSignature: { name: "陈某", signedAt: new Date().toISOString() } }],
        responsibilities: form.responsibilities,
        nonCommitments: ["不承诺获批结果", "官方费用以递交时为准"],
        validDays: Number(form.validDays) || 14
      };
      const p = await api.createProposal(body);
      if (submit) await api.submitProposal(p.id);
      setShowForm(false);
      setForm((f) => ({ ...f, advice: "", responsibilities: "" }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: "#F5F7FA" }}
      contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      data={records ?? []}
      keyExtractor={(r) => r.id}
      ListHeaderComponent={
        <View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 22, fontWeight: "800", color: "#1B2433" }}>方案</Text>
            <Text
              onPress={() => setShowForm((v) => !v)}
              style={{ backgroundColor: "#002661", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, color: "#fff", fontWeight: "700", fontSize: 13, overflow: "hidden" }}
            >
              {showForm ? "收起" : "新建方案"}
            </Text>
          </View>

          {showForm && (
            <Card style={{ marginTop: 14 }}>
              <SectionLabel text="编制方案（费表只读快照）" />
              <Text style={{ fontSize: 13, color: "#5E6B7E", marginBottom: 6 }}>选择客户</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {clients.map((c) => (
                  <Pressable key={c.id} onPress={() => setForm((f) => ({ ...f, customerRef: c.customerRef }))} style={{ marginRight: 8, marginBottom: 8 }}>
                    <Tag text={c.customerRef} tone={form.customerRef === c.customerRef ? "navy" : "default"} />
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={form.advice}
                onChangeText={(v) => setForm((f) => ({ ...f, advice: v }))}
                placeholder="个性化建议（超模板内容将人工署名）"
                multiline
                style={input}
              />
              <TextInput
                value={form.responsibilities}
                onChangeText={(v) => setForm((f) => ({ ...f, responsibilities: v }))}
                placeholder="责任分工"
                multiline
                style={input}
              />
              <TextInput
                value={form.validDays}
                onChangeText={(v) => setForm((f) => ({ ...f, validDays: v }))}
                placeholder="有效期（天，默认 14）"
                keyboardType="number-pad"
                style={[input, { height: 44 }]}
              />
              {error && <Text style={{ color: "#C03221", marginBottom: 8 }}>{error}</Text>}
              {busy ? (
                <ActivityIndicator />
              ) : (
                <View>
                  <PrimaryButton label="保存草稿并提交复核" onPress={() => void create(true)} />
                  <View style={{ height: 8 }} />
                  <PrimaryButton label="仅保存草稿" variant="berry" onPress={() => void create(false)} />
                </View>
              )}
            </Card>
          )}

          {records === null && <ActivityIndicator style={{ marginTop: 40 }} />}
          {records !== null && records.length === 0 && !showForm && (
            <Card style={{ marginTop: 14 }}><Text style={{ color: "#5E6B7E" }}>还没有方案，点右上角“新建方案”。</Text></Card>
          )}
        </View>
      }
      renderItem={({ item, index }) => {
        const st = STATE[item.state] ?? { text: item.state, tone: "default" as const };
        return (
          <Card {...riseEntering(Math.min(index, 8))} style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontWeight: "700", color: "#1B2433", fontSize: 15 }}>
                {item.id} · v{item.revision}
              </Text>
              <Tag text={st.text} tone={st.tone} />
            </View>
            <Text style={{ marginTop: 8, color: "#5E6B7E", fontSize: 13 }}>
              客户 {item.customerRef} · {item.projectCode}
            </Text>
            {item.validUntil && (
              <Text style={{ marginTop: 4, color: "#8A95A6", fontSize: 12 }}>
                有效期至 {new Date(item.validUntil).toLocaleDateString()}
              </Text>
            )}
          </Card>
        );
      }}
    />
  );
}

const input: object = {
  backgroundColor: "#F5F7FA", borderRadius: 12, borderWidth: 1, borderColor: "#E5E9F0",
  paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10, minHeight: 72, textAlignVertical: "top"
};
