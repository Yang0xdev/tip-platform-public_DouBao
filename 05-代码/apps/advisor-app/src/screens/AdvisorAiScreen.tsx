import { useEffect, useRef, useState } from "react";
import { FlatList, Text, View, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { api, type AiAnswerView } from "../api";
import { Card } from "../ui";
import { colors } from "@tip/ui-native";

/**
 * 顾问端 AI（初步功能）：对话式 grounded 助手。
 * 晨间简报/会前准备/资料查询/客户进展，答案由服务端从顾问有权访问的真实数据拼装、带来源。
 * 本版不接 LLM；ChatProvider(Qwen) 后续升级。
 */

interface Msg {
  id: number;
  role: "user" | "ai";
  text: string;
  sources?: AiAnswerView["sources"];
  next?: string;
}

const LEVEL_LABEL: Record<string, string> = { cu: "客户记录", co: "公司记录", sp: "服务方", off: "官方核验" };

export default function AdvisorAiScreen() {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
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
      setMessages((m) => [...m, { id: nextId(), role: "ai", text: a.text, sources: a.sources, next: a.next }]);
    } catch (e) {
      setMessages((m) => [...m, { id: nextId(), role: "ai", text: `暂时无法回答：${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

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
              <LinearGradient
                colors={["#AF2D67", "#5E246B", "#002661"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{ borderRadius: 24, padding: 22, marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: "#fff" }}>展业 AI 助手</Text>
                <Text style={{ fontSize: 12.5, color: "rgba(255,255,255,.9)", marginTop: 8, lineHeight: 20 }}>
                  用一句话安排工作：晨间简报、会前准备、资料查询、客户进展。
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
                    <Text key={i} style={{ fontSize: 11.5, color: colors.mut ?? "#5E6B7E", marginTop: 2 }}>
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
          placeholder="描述你要做的工作…"
          placeholderTextColor={colors.faint ?? "#8A95A6"}
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
