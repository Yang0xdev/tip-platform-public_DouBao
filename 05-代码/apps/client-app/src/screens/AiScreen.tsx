import { useEffect, useRef, useState } from "react";
import { FlatList, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AiAnswerView } from "../api";
import { AiOrchestrator, type AiMode } from "../ai/orchestrator";
import { Card, colors, signatureGradient } from "../ui";

/**
 * 客户端 AI：
 *  - 首次进入显单独同意（案件片段授权，可拒绝/可撤回）；
 *  - U1 混合：本机 Ollama(Qwen) 在线时走 grounded + LLM 流式（L），
 *    不可用/校验不过自动回退确定性 grounded 问答（D，现有冻结行为）。
 */

interface Msg {
  id: number;
  role: "user" | "ai";
  text: string;
  sources?: AiAnswerView["sources"];
  next?: string;
  streaming?: boolean;
}

const LEVEL_LABEL: Record<string, string> = { cu: "客户记录", co: "公司记录", sp: "服务方", off: "官方核验" };

export default function AiScreen() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<{ mode: AiMode; model: string | null }>({ mode: "D", model: null });
  const seq = useRef(0);
  const listRef = useRef<FlatList<Msg>>(null);
  const orch = useRef(new AiOrchestrator());

  useEffect(() => {
    api.aiConsent().then((c) => setConsent(c.granted)).catch(() => setConsent(false));
    api.aiSuggestions().then((d) => setSuggestions(d.records.map((r) => r.text))).catch(() => {});
    orch.current.probe().then(setMode).catch(() => {});
  }, []);

  const nextId = () => {
    seq.current += 1;
    return seq.current;
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: nextId(), role: "user", text: q }]);
    const aiId = nextId();
    setMessages((m) => [...m, { id: aiId, role: "ai", text: "", streaming: true }]);
    const patch = (p: Partial<Msg>) =>
      setMessages((m) => m.map((x) => (x.id === aiId ? { ...x, ...p } : x)));
    try {
      const r = await orch.current.ask(q, {
        onDelta: (full) => patch({ text: full })
      });
      if (r.needConsent) {
        setConsent(false);
        setMessages((m) => m.filter((x) => x.id !== aiId));
      } else {
        setMode({ mode: r.mode, model: r.model ?? null });
        patch({ text: r.text, sources: r.sources, next: r.next, streaming: false });
      }
    } catch (e) {
      patch({
        text: `暂时无法回答：${(e as Error).message}。请稍后再试或联系顾问。`,
        streaming: false
      });
    } finally {
      setBusy(false);
    }
  };

  const grant = async (granted: boolean) => {
    await api.aiSetConsent(granted);
    setConsent(granted);
  };

  if (consent === null) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  if (!consent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, padding: 18 }}>
        <LinearGradient colors={signatureGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ borderRadius: 24, padding: 24, marginTop: 30 }}>
          <Text style={{ color: "#fff", fontSize: 19, fontWeight: "800" }}>AI 身份规划助手</Text>
          <Text style={{ color: "rgba(255,255,255,.9)", fontSize: 13, marginTop: 12, lineHeight: 21 }}>
            为回答你的问题，将向模型提供必要的案件片段（如进度、费用项）。
            L3 原件不会进入模型；你可以随时在「我的」中撤回授权。
          </Text>
        </LinearGradient>
        <Card style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, color: colors.mut, lineHeight: 21 }}>
            AI 回答为信息整理，不做资格认定、不预测获批结果、不构成法律意见；
            正式结论以人工复核和官方审核为准。
          </Text>
        </Card>
        <Pressable onPress={() => grant(true)} style={{ marginTop: 22 }}>
          <LinearGradient colors={signatureGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ borderRadius: 22, paddingVertical: 15, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>同意并开始对话</Text>
          </LinearGradient>
        </Pressable>
        <Pressable onPress={() => grant(false)} style={{ marginTop: 12, alignItems: "center", padding: 10 }}>
          <Text style={{ color: colors.mut, fontSize: 13 }}>暂不使用</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 10 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListHeaderComponent={
          messages.length === 0 ? (
            <View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                  backgroundColor: mode.mode === "L" ? "#E6F4EE" : colors.navy50,
                  borderRadius: 999,
                  paddingVertical: 7,
                  paddingHorizontal: 13,
                  marginBottom: 14,
                  alignSelf: "flex-start"
                }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: mode.mode === "L" ? "#177A5B" : colors.faint
                  }}
                />
                <Text style={{ fontSize: 11.5, color: mode.mode === "L" ? "#177A5B" : colors.mut, fontWeight: "600" }}>
                  {mode.mode === "L"
                    ? `已连接本地模型${mode.model ? ` · ${mode.model}` : ""}`
                    : "基础模式（未检测到本地模型）"}
                </Text>
              </View>
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink, marginBottom: 4 }}>
                你好，我是你的 AI 助手
              </Text>
              <Text style={{ fontSize: 13, color: colors.mut, marginBottom: 14 }}>
                可以和我聊聊需求，或问案件进度、费用、材料、防骗问题
              </Text>
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
            <View
              style={{
                maxWidth: "86%",
                borderRadius: 18,
                padding: 13,
                backgroundColor: item.role === "user" ? colors.navy : "#fff",
                borderWidth: item.role === "user" ? 0 : 1,
                borderColor: colors.line
              }}>
              <Text style={{ fontSize: 13.5, color: item.role === "user" ? "#fff" : colors.ink, lineHeight: 21 }}>
                {item.text || (item.streaming ? "正在调取已核验记录…" : "")}
              </Text>
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
          </View>
        )}
      />
      <View style={{ flexDirection: "row", padding: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.line, gap: 8 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="输入你的问题…"
          placeholderTextColor={colors.faint}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 22, paddingHorizontal: 16, fontSize: 14, color: colors.ink, height: 44 }}
          onSubmitEditing={() => send(input)}
        />
        <Pressable onPress={() => send(input)} disabled={busy} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.berry, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 18 }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
