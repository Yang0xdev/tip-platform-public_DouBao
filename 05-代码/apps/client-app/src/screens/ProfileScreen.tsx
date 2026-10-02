import { useCallback, useState } from "react";
import { ScrollView, Text, View, Pressable, Switch, TextInput, Alert, Platform } from "react-native";

const notify = (title: string, message: string) => {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}：${message}`);
    return;
  }
  Alert.alert(title, message);
};
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { listFavorites } from "../storage";
import { Card, Tag, colors } from "../ui";
import { api } from "../api";
import type { RootStackParamList } from "../navigation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const CASE_ID = "CASE-0001";
const ACTION_LABEL: Record<string, string> = {
  "progress:view": "查看进度",
  "material:view_submit": "查看与提交材料",
  "matter:confirm": "确认事项",
  "notice:receive": "接收通知"
};

export default function ProfileScreen() {
  const nav = useNavigation<Nav>();
  const [favCount, setFavCount] = useState(0);
  const [advisorId, setAdvisorId] = useState<string | null>(null);
  const [grants, setGrants] = useState<Array<{
    id: string; personRef: string; action: string; state: string; validUntil: string | null;
  }>>([]);
  const [prefs, setPrefs] = useState<{ app: boolean; sms: boolean; email: boolean } | null>(null);
  const [aiGranted, setAiGranted] = useState(false);
  const [deletion, setDeletion] = useState<{
    id: string; state: string; coolingUntil: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listFavorites().then((f) => setFavCount(f.length));
    api.myEngagements().then((d) => {
      const active = d.records.find((r) => r.relationshipState === "active");
      setAdvisorId(active?.advisorId ?? null);
    }).catch(() => {});
    api.consents(CASE_ID).then((d) => setGrants(d.records)).catch(() => {});
    api.notifPrefs(CASE_ID).then(setPrefs).catch(() => {});
    api.aiConsent().then((c) => setAiGranted(c.granted)).catch(() => {});
    api.myDeletions().then((d) => setDeletion(d.records[0] ?? null)).catch(() => {});
  }, []);

  useFocusEffect(load);

  const togglePref = async (key: "app" | "sms" | "email", value: boolean) => {
    if (!prefs) return;
    const next = { ...prefs, [key]: value };
    // 不可全关
    if (!next.app && !next.sms && !next.email) {
      notify("通知渠道", "至少保留一种通知渠道。");
      return;
    }
    setPrefs(next);
    api.setNotifPrefs(CASE_ID, next).catch(() => setPrefs(prefs));
  };

  const submitDeletion = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      const r = await api.requestDeletion(reason.trim());
      setDeletion({ id: r.id, state: r.state, coolingUntil: "" });
      setDeleting(false);
      setReason("");
    } catch (e) {
      notify("注销申请", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelDeletion = async () => {
    if (!deletion) return;
    await api.cancelDeletion(deletion.id).catch(() => {});
    setDeletion(null);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={{ padding: 16, gap: 14 }}>

      {/* 身份卡 */}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{
            width: 46, height: 46, borderRadius: 23,
            backgroundColor: colors.navy50, alignItems: "center", justifyContent: "center"
          }}>
            <Text style={{ fontSize: 18, color: colors.navy, fontWeight: "800" }}>客</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15.5, fontWeight: "800", color: colors.ink }}>客户 #1980</Text>
            <Text style={{ fontSize: 12, color: colors.faint, marginTop: 2 }}>
              联系方式已验证，敏感信息脱敏存储
            </Text>
          </View>
          <Tag text="已核验" tone="ok" />
        </View>
      </Card>

      {/* 我的顾问 */}
      <Card>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.ink, marginBottom: 8 }}>我的顾问</Text>
        <Text style={{ fontSize: 12.5, color: colors.mut }}>
          {advisorId ? `主责顾问：${advisorId}（服务关系已建立）` : "暂无主责顾问，可发起咨询由平台安排。"}
        </Text>
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Pressable
            onPress={() => nav.navigate("CaseTab" as never)}
            style={{
              flex: 1, height: 38, borderRadius: 19, backgroundColor: colors.navy50,
              alignItems: "center", justifyContent: "center"
            }}>
            <Text style={{ fontSize: 12.5, color: colors.navy, fontWeight: "700" }}>我的办理</Text>
          </Pressable>
          <Pressable
            onPress={() => nav.navigate("ServiceTab" as never)}
            style={{
              flex: 1, height: 38, borderRadius: 19, backgroundColor: colors.navy,
              alignItems: "center", justifyContent: "center"
            }}>
            <Text style={{ fontSize: 12.5, color: "#fff", fontWeight: "700" }}>联系顾问</Text>
          </Pressable>
        </View>
      </Card>

      {/* 家庭授权 */}
      <Card>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.ink, marginBottom: 8 }}>
          家庭与授权
        </Text>
        {grants.filter((g) => g.state === "active").slice(0, 6).map((g) => (
          <View key={g.id} style={{
            flexDirection: "row", justifyContent: "space-between",
            paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.lineSoft
          }}>
            <Text style={{ fontSize: 12.5, color: colors.ink }}>
              {g.personRef} · {ACTION_LABEL[g.action] ?? g.action}
            </Text>
            <Text style={{ fontSize: 11, color: colors.faint }}>
              {g.validUntil ? `至 ${g.validUntil.slice(0, 10)}` : "有效"}
            </Text>
          </View>
        ))}
        {grants.filter((g) => g.state === "active").length === 0 ? (
          <Text style={{ fontSize: 12, color: colors.faint }}>暂无授权记录；授权在案件办理中由成员本人授予。</Text>
        ) : null}
      </Card>

      {/* 通知偏好 */}
      <Card>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.ink, marginBottom: 6 }}>
          通知渠道（至少保留一种）
        </Text>
        {prefs ? (
          [
            { k: "app" as const, label: "App 通知" },
            { k: "sms" as const, label: "短信" },
            { k: "email" as const, label: "邮件" }
          ].map((r) => (
            <View key={r.k} style={{
              flexDirection: "row", justifyContent: "space-between",
              alignItems: "center", paddingVertical: 6
            }}>
              <Text style={{ fontSize: 12.5, color: colors.ink }}>{r.label}</Text>
              <Switch
                value={prefs[r.k]}
                onValueChange={(v) => togglePref(r.k, v)}
                trackColor={{ false: colors.line, true: colors.berry }}
                thumbColor="#fff"
              />
            </View>
          ))
        ) : (
          <Text style={{ fontSize: 12, color: colors.faint }}>加载中…</Text>
        )}
      </Card>

      {/* AI 与收藏 */}
      <View style={{ gap: 10 }}>
        <Pressable onPress={() => nav.navigate("AiTab" as never)}>
          <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>AI 助手授权</Text>
            <Text style={{ fontSize: 12, color: aiGranted ? colors.ok : colors.berry, fontWeight: "700" }}>
              {aiGranted ? "已授权 ›" : "未授权 ›"}
            </Text>
          </Card>
        </Pressable>
        <Pressable onPress={() => nav.navigate("Favorites")}>
          <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.ink }}>本机收藏与对比</Text>
            <Text style={{ fontSize: 12.5, color: colors.navy, fontWeight: "600" }}>{favCount} 项 ›</Text>
          </Card>
        </Pressable>
      </View>

      {/* 账号注销 */}
      <Card>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.ink, marginBottom: 6 }}>账号注销</Text>
        {deletion ? (
          <View>
            <Text style={{ fontSize: 12.5, color: colors.bad }}>
              注销申请处理中（{deletion.state}），有 15 天冷静期。
            </Text>
            <Pressable
              onPress={cancelDeletion}
              style={{
                marginTop: 10, height: 38, borderRadius: 19, backgroundColor: colors.navy,
                alignItems: "center", justifyContent: "center"
              }}>
              <Text style={{ color: "#fff", fontSize: 12.5, fontWeight: "700" }}>撤回注销申请</Text>
            </Pressable>
          </View>
        ) : deleting ? (
          <View>
            <Text style={{ fontSize: 11.5, color: colors.faint, marginBottom: 8 }}>
              注销前如有在办案件或生效订单将被拦截；数据进入 15 天冷静期后匿名化。
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="请填写注销原因（必填）"
              placeholderTextColor={colors.faint}
              multiline
              style={{
                borderWidth: 1, borderColor: colors.line, borderRadius: 12,
                padding: 10, fontSize: 13, color: colors.ink, minHeight: 56, textAlignVertical: "top"
              }}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable
                onPress={() => { setDeleting(false); setReason(""); }}
                style={{
                  flex: 1, height: 38, borderRadius: 19, backgroundColor: colors.navy50,
                  alignItems: "center", justifyContent: "center"
                }}>
                <Text style={{ fontSize: 12.5, color: colors.navy, fontWeight: "700" }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={submitDeletion}
                disabled={busy || !reason.trim()}
                style={{
                  flex: 1, height: 38, borderRadius: 19, backgroundColor: colors.bad,
                  alignItems: "center", justifyContent: "center",
                  opacity: reason.trim() ? 1 : 0.5
                }}>
                <Text style={{ fontSize: 12.5, color: "#fff", fontWeight: "700" }}>确认申请</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setDeleting(true)}
            style={{
              height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.line,
              alignItems: "center", justifyContent: "center"
            }}>
            <Text style={{ fontSize: 12.5, color: colors.mut, fontWeight: "700" }}>申请注销账号</Text>
          </Pressable>
        )}
      </Card>

      <Text style={{ fontSize: 11, color: colors.faint, textAlign: "center", marginTop: 4 }}>
        透明身份规划平台客户端 · v1.7
      </Text>
    </ScrollView>
  );
}
