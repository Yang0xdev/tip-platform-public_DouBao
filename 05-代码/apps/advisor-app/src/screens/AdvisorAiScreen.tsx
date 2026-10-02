import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList, Text, View, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ScrollView
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "../api";
import { Card } from "../ui";
import { colors } from "@tip/ui-native";
import { AdvisorAiOrchestrator } from "../ai/orchestrator";
import type { AiMode, Draft } from "../ai/types";

/**
 * 顾问端 AI（U2）：锚定客户的对话式工作台。
 *  - 顶部锚定客户条 + 模式状态条；
 *  - L 本机模型流式；D 基础模式保底；
 *  - 跟进/任务/消息均为草稿，顾问编辑并显式确认才入库/复制。
 */

interface Msg {
  id: number;
  role: "user" | "ai";
  text: string;
  sources?: Array<{ level: string; title: string; ref: string }>;
  next?: string;
  drafts?: Draft[];
  streaming?: boolean;
}

interface ClientChip {
  customerRef: string;
  label: string;
}

const LEVEL_LABEL: Record<string, string> = {
  cu: "客户记录", co: "公司记录", sp: "服务方", off: "官方核验"
};

export default function AdvisorAiScreen() {
  const orchRef = useRef<AdvisorAiOrchestrator | null>(null);
  if (!orchRef.current) orchRef.current = new AdvisorAiOrchestrator();
  const orch = orchRef.current;

  const [clients, setClients] = useState<ClientChip[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [mode, setMode] = useState<AiMode>("D");
  const [model, setModel] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    api.clients().then((d) =>
      setClients(d.records.map((r) => ({
        customerRef: r.customerRef,
        label: r.customerRef.replace("c-", "#")
      })))
    ).catch(() => {});
    api.aiSuggestions().then((d) => setSuggestions(d.records.map((r) => r.text))).catch(() => {});
    orch.probe().then((s) => { setMode(s.mode); setModel(s.model); }).catch(() => {});
  }, []);

  const nextId = () => {
    seq.current += 1;
    return seq.current;
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;

    // 消息中带 #编号 → 自动锚定（必须是本人客户）
    const m = q.match(/#(\d{4})\b/);
    let useAnchor = anchor;
    if (m) {
      const ref = `c-${m[1]}`;
      if (clients.some((c) => c.customerRef === ref)) {
        useAnchor = ref;
        setAnchor(ref);
      }
    }

    setInput("");
    setBusy(true);
    const streamId = nextId();
    setMessages((x) => [
      ...x,
      { id: nextId(), role: "user", text: q },
      { id: streamId, role: "ai", text: "", streaming: true }
    ]);

    const onDelta = (full: string) => {
      setMessages((x) => x.map((mm) => (mm.id === streamId ? { ...mm, text: full } : mm)));
    };

    try {
      const r = await orch.ask(q, { customerRef: useAnchor ?? undefined, onDelta });
      setMessages((x) => x.map((mm) =>
        mm.id === streamId
          ? { ...mm, streaming: false, text: r.text, sources: r.sources, next: r.next, drafts: r.drafts }
          : mm
      ));
    } catch (e) {
      setMessages((x) => x.map((mm) =>
        mm.id === streamId
          ? { ...mm, streaming: false, text: `暂时无法回答：${(e as Error).message}` }
          : mm
      ));
    } finally {
      setBusy(false);
    }
  };

  const anchorLabel = useMemo(
    () => clients.find((c) => c.customerRef === anchor)?.label ?? null,
    [anchor, clients]
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>

      {/* 锚定客户条 */}
      <View style={{
        backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: colors.line,
        paddingHorizontal: 14, paddingVertical: 10
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 12, color: colors.mut, fontWeight: "700" }}>
            当前客户：{anchorLabel ?? "未锚定（通用问答）"}
          </Text>
          <Pressable onPress={() => setAnchor(null)} hitSlop={8}>
            <Text style={{ fontSize: 11.5, color: colors.berry, fontWeight: "600" }}>清除</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {clients.map((c) => {
            const active = c.customerRef === anchor;
            return (
              <Pressable
                key={c.customerRef}
                onPress={() => setAnchor(active ? null : c.customerRef)}
                style={{
                  paddingHorizontal: 13, height: 30, borderRadius: 999,
                  backgroundColor: active ? colors.navy : colors.navy50,
                  alignItems: "center", justifyContent: "center", marginRight: 8
                }}>
                <Text style={{ fontSize: 12, color: active ? "#fff" : colors.navy, fontWeight: "600" }}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {/* 模式状态条 */}
        <View style={{
          marginTop: 9, flexDirection: "row", alignItems: "center",
          backgroundColor: mode === "L" ? colors.okBg : colors.navy50,
          borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6
        }}>
          <View style={{
            width: 7, height: 7, borderRadius: 4, marginRight: 7,
            backgroundColor: mode === "L" ? colors.ok : colors.navy
          }} />
          <Text style={{ fontSize: 11.5, color: mode === "L" ? colors.ok : colors.navy, fontWeight: "600" }}>
            {mode === "L" ? `已连接本地模型 · ${model ?? ""}` : "基础模式（未检测到本地模型）"}
          </Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 10 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListHeaderComponent={
          messages.length === 0 ? (
            <View>
              <LinearGradient
                colors={["#AF2D67", "#5E246B", "#002661"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 24, padding: 22, marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: "#fff" }}>展业 AI 工作台</Text>
                <Text style={{ fontSize: 12.5, color: "rgba(255,255,255,.9)", marginTop: 8, lineHeight: 20 }}>
                  先锚定客户，再用一句话安排工作：会前准备、会后收口、跟进与任务草稿、资料查询、综合诉求方案。
                </Text>
              </LinearGradient>
              {suggestions.map((s) => (
                <Pressable key={s} onPress={() => send(s)} style={{ marginBottom: 8 }}>
                  <Card>
                    <Text style={{ fontSize: 13.5, color: colors.navy, fontWeight: "600" }}>{s}</Text>
                  </Card>
                </Pressable>
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={{ alignItems: item.role === "user" ? "flex-end" : "flex-start", marginBottom: 12 }}>
            <View style={{
              maxWidth: "90%", borderRadius: 18, padding: 13,
              backgroundColor: item.role === "user" ? colors.navy : "#fff",
              borderWidth: item.role === "user" ? 0 : 1, borderColor: colors.line
            }}>
              {item.streaming && !item.text ? (
                <Text style={{ fontSize: 13, color: colors.faint }}>正在调取已核验记录…</Text>
              ) : (
                <Text style={{ fontSize: 13.5, color: item.role === "user" ? "#fff" : colors.ink, lineHeight: 21 }}>
                  {item.text}
                </Text>
              )}
              {item.sources && item.sources.length > 0 && (
                <View style={{ marginTop: 9, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8 }}>
                  {item.sources.map((src, i) => (
                    <Text key={i} style={{ fontSize: 11.5, color: colors.mut, marginTop: 2 }}>
                      来源[{LEVEL_LABEL[src.level] ?? src.level}]：{src.title}
                    </Text>
                  ))}
                </View>
              )}
              {item.next ? (
                <Text style={{ fontSize: 11.5, color: colors.berry, marginTop: 7 }}>{item.next}</Text>
              ) : null}
            </View>

            {/* 草稿卡（确认才入库） */}
            {item.drafts && item.drafts.length > 0 ? (
              <DraftList
                drafts={item.drafts}
                anchor={anchor}
                onDone={() =>
                  setMessages((x) => x.map((mm) =>
                    mm.id === item.id ? { ...mm, drafts: [] } : mm
                  ))
                }
              />
            ) : null}
          </View>
        )}
      />

      <View style={{
        flexDirection: "row", padding: 10, backgroundColor: "#fff",
        borderTopWidth: 1, borderTopColor: colors.line, gap: 8
      }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={anchor ? `对 ${anchorLabel} 安排工作…` : "描述你要做的工作…"}
          placeholderTextColor={colors.faint}
          style={{
            flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 22,
            paddingHorizontal: 16, fontSize: 14, color: colors.ink, height: 44
          }}
          onSubmitEditing={() => send(input)}
        />
        <Pressable
          onPress={() => send(input)}
          disabled={busy}
          style={{
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: colors.berry, alignItems: "center", justifyContent: "center"
          }}>
          <Text style={{ color: "#fff", fontSize: 18 }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ================= 草稿列表 ================= */

function DraftList({
  drafts, anchor, onDone
}: {
  drafts: Draft[];
  anchor: string | null;
  onDone: () => void;
}) {
  const [local, setLocal] = useState<Draft[]>(drafts);
  const [status, setStatus] = useState<Record<number, string>>({});

  const remove = (i: number) =>
    setLocal((x) => x.filter((_, idx) => idx !== i));

  if (local.length === 0) {
    onDone();
    return null;
  }

  return (
    <View style={{ width: "92%", marginTop: 2 }}>
      <Text style={{ fontSize: 11.5, color: colors.mut, fontWeight: "700", marginBottom: 6 }}>
        待确认草稿（确认前不入库）
      </Text>
      {local.map((d, i) => (
        <DraftCard
          key={i}
          draft={d}
          anchor={anchor}
          statusMsg={status[i]}
          onEdit={(text) =>
            setLocal((x) => x.map((y, idx) => (idx === i ? ({ ...y, text } as Draft) : y)))
          }
          onStatus={(msg) => setStatus((s) => ({ ...s, [i]: msg }))}
          onDiscard={() => remove(i)}
        />
      ))}
    </View>
  );
}

function DraftCard({
  draft, anchor, statusMsg, onEdit, onStatus, onDiscard
}: {
  draft: Draft;
  anchor: string | null;
  statusMsg?: string;
  onEdit: (text: string) => void;
  onStatus: (msg: string) => void;
  onDiscard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const titleMap = { follow: "跟进记录", task: "T0 任务", message: "对客消息" };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (draft.kind === "follow") {
        if (!anchor) throw new Error("请先锚定客户");
        await api.addFollow(anchor, draft.text, draft.visibility);
        onStatus("已保存为跟进记录");
      } else if (draft.kind === "task") {
        if (!draft.caseId) throw new Error("缺少案件，无法建任务（可改为跟进）");
        await api.createTask({
          caseId: draft.caseId,
          type: "advisor_draft",
          title: draft.title,
          ownerId: draft.ownerId || anchor || "",
          dueAt: draft.dueAt,
          source: draft.source || "contract",
          t0: draft.t0 ?? true
        });
        onStatus("任务已创建");
      } else {
        if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(draft.text);
          onStatus("已复制，可自行粘贴发送");
        } else {
          onStatus("请长按文本复制");
        }
      }
    } catch (e) {
      onStatus(`未成功：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const textValue =
    draft.kind === "task" ? draft.title : draft.text;

  return (
    <View style={{
      backgroundColor: "#fff", borderRadius: 16, borderWidth: 1,
      borderColor: colors.line, padding: 12, marginBottom: 8
    }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 7 }}>
        <Text style={{ fontSize: 12, fontWeight: "800", color: colors.navy }}>
          {titleMap[draft.kind]}
          {draft.kind === "follow" ? `（${draft.visibility === "fact" ? "对客可见" : "仅内部"}）` : ""}
        </Text>
        <Pressable onPress={onDiscard} hitSlop={8}>
          <Text style={{ fontSize: 11.5, color: colors.faint }}>丢弃</Text>
        </Pressable>
      </View>
      <TextInput
        value={textValue}
        onChangeText={onEdit}
        multiline
        style={{
          borderWidth: 1, borderColor: colors.line, borderRadius: 12,
          padding: 9, fontSize: 13, color: colors.ink, minHeight: 40, textAlignVertical: "top"
        }}
      />
      {statusMsg ? (
        <Text style={{ fontSize: 11.5, color: statusMsg.includes("未成功") ? colors.bad : colors.ok, marginTop: 7 }}>
          {statusMsg}
        </Text>
      ) : (
        <Pressable
          onPress={confirm}
          disabled={busy}
          style={{
            marginTop: 9, height: 38, borderRadius: 19,
            backgroundColor: colors.navy, alignItems: "center", justifyContent: "center"
          }}>
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
            {draft.kind === "message" ? "复制消息" : "确认入库"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
