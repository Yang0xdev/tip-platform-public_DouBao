import { useEffect, useState } from "react";
import { Text, View, Pressable, ScrollView } from "react-native";
import { api, type GlobalAccessStatus } from "../api";
import { Card, Loading, ErrorBox, Tag, colors } from "../ui";

/**
 * 全球通行（M1-16 框架态 / Q6 门）：
 * 数据源未授权时只返回维护态与三页骨架，零国别数据；授权失效同样回到本态。
 */
const PAGES = [
  { key: "my_passport", label: "我的护照", desc: "护照信息与通行力概览（授权开放后可用）" },
  { key: "visa_check", label: "签证要求", desc: "按目的地查询签证/入境材料要求（授权开放后可用）" },
  { key: "passport_compare", label: "护照对比", desc: "多本护照通行力对比（不自创排名，仅展示授权数据与署名）" }
] as const;

export default function GlobalAccessScreen() {
  const [status, setStatus] = useState<GlobalAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof PAGES)[number]["key"]>("my_passport");

  useEffect(() => {
    api.globalAccessStatus("visa_passport_data")
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!status) return <Loading label="加载全球通行状态…" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ backgroundColor: colors.navy50, borderColor: colors.navy100 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: "800", color: colors.navy }}>{status.available ? "已开放" : status.title ?? "维护中"}</Text>
          <Tag text={status.available ? "已授权" : "未授权"} tone={status.available ? "ok" : "muted"} />
        </View>
        <Text style={{ fontSize: 12.5, color: colors.navy, marginTop: 8, lineHeight: 19 }}>
          {status.available
            ? "数据来自官方授权数据源，页面将显示提供方署名与更新节拍。"
            : status.body ?? "全球通行依赖官方授权数据源，当前尚未开放。"}
        </Text>
      </Card>

      <View style={{ flexDirection: "row", backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 4 }}>
        {PAGES.map((p) => {
          const on = tab === p.key;
          return (
            <Pressable key={p.key} onPress={() => setTab(p.key)} style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9, backgroundColor: on ? colors.navy50 : "transparent" }}>
              <Text style={{ fontSize: 12.5, fontWeight: on ? "700" : "500", color: on ? colors.navy : colors.faint }}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Card>
        <Text style={{ fontSize: 15, fontWeight: "800", color: colors.ink }}>{PAGES.find((p) => p.key === tab)?.label}</Text>
        <Text style={{ fontSize: 12.5, color: colors.mut, marginTop: 8, lineHeight: 19 }}>{PAGES.find((p) => p.key === tab)?.desc}</Text>
        <View style={{ marginTop: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.line, borderRadius: 12, padding: 26, alignItems: "center" }}>
          <Tag text="框架预览 · 无国别数据" tone="muted" />
          <Text style={{ fontSize: 12, color: colors.faint, marginTop: 10, textAlign: "center", lineHeight: 18 }}>
            数据源授权（合同、范围、节拍、提供方署名、有效期五要件）齐备并通过审核后开放；授权失效将在 30 分钟内全网下架。
          </Text>
        </View>
      </Card>

      <Text style={{ fontSize: 11.5, color: colors.faint, lineHeight: 18, paddingHorizontal: 4 }}>
        税务居民判定（如 183 天规则）等衍生能力不在 M1 范围，二期评估。签证政策请以目的地官方渠道为准。
      </Text>
    </ScrollView>
  );
}
