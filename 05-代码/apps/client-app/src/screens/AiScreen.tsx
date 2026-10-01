import { useEffect, useRef, useState } from "react";
import { FlatList, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AiAnswerView } from "../api";
import { Card, colors, signatureGradient } from "../ui";

/**
 * 客户端 AI（初步功能）：
 *  - 首次进入显单独同意（案件片段授权，可拒绝/可撤回）；
 *  - 对话式问答，答案由服务端从真实 co/off 事实确定性拼装、带来源；
 *  - 本版不接 LLM；ChatProvider(Qwen) 为后续升级。
 */

interface Msg {
  id: number;
  role: "user" | "ai";
  text: string;
  sources?: AiAnswerView["sources"];
  next?: string;
}

const LEVEL_LABEL: Record<string, string> = { cu: "客户记录", co: "公司记录", sp: "服务方", off: "官方核验" };

export default function AiScreen() {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    api.aiConsent().then((c) => setConsent(c.granted)).catch(() => setConsent(false));
    api.aiSuggestions().then((d) => setSuggestions(d.records.map((r) => r.text))).catch(() => {});
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
    try {
      const a = await api.aiAsk(q);
      if (a.needConsent) {
        setConsent(false);
      } else {
        setMessages((m) => [...m, { id: nextId(), role: "ai", text: a.text, sources: a.sources, next: a.next }]);
      }
    } catch (e) {
      setMessages((m) => [
        ...m,
        { id: nextId(), role: "ai", text: `暂时无法回答：${(e as Error).message}。请稍后再试或联系顾问。` }
      ]);
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
              <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink, marginBottom: 4 }}>
                你好，我是你的 AI 助手
              </Text>
              <Text style={{ fontSize: 13, color: colors.mut, marginBottom: 14 }}>
                可以问我案件进度、费用、材料，或防骗问题
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
                {item.text}
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
