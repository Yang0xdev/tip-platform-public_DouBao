/**
 * M0 动效 Spike（G-P6 v1.3 在 RN 的可行性验证）
 * 验证项：
 *  1) 页面推进 420ms cubic-bezier(.22,1,.36,1) + 0.985→1 缩放 + 14px rise
 *  2) 内容分层入场（nth-child +40ms，最多 10 级）
 *  3) 底部 Tab 活动项 Navy-50 胶囊 spring 滑动
 *  4) 主按钮微渐变 + 按压缩放 .96 spring
 * 本文件是验证用演示页，M1 起替换为 React Navigation 与真实页面。
 */
import React, { useState } from "react";
import { SafeAreaView, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Animated from "react-native-reanimated";
import {
  colors,
  radius,
  spacing,
  PrimaryButton,
  TabBar,
  screenEntering,
  riseEntering
} from "@tip/ui-native";

const TABS = ["首页", "项目", "全球通行", "办理", "服务", "我的"];

function Card({ level, title, sub }: { level: number; title: string; sub: string }) {
  return (
    <Animated.View
      entering={riseEntering(level)}
      style={{
        backgroundColor: colors.white,
        borderRadius: radius.card,
        padding: spacing(4),
        marginBottom: spacing(3),
        shadowColor: "#102043",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.08,
        shadowRadius: 18,
        elevation: 2
      }}
    >
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.ink }}>{title}</Text>
      <Text style={{ fontSize: 12.5, color: colors.mut, marginTop: 6, lineHeight: 19 }}>{sub}</Text>
    </Animated.View>
  );
}

function HomeScreen({ onOpen }: { onOpen: () => void }) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing(4), paddingBottom: spacing(8) }}>
      <Animated.View entering={riseEntering(0)} style={{ marginBottom: spacing(4) }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.navy }}>透明身份规划</Text>
        <Text style={{ fontSize: 13, color: colors.faint, marginTop: 4 }}>M0 动效 Spike · 示例内容，非真实数据</Text>
      </Animated.View>
      <Card level={1} title="受控透明服务" sub="项目、收费、办理进度均可核验；无成功率承诺，费用分项列明收取方。" />
      <Card level={2} title="初步评估" sub="问卷结论仅输出：符合 / 有差距 / 待确认 / 暂不承诺。" />
      <Card level={3} title="全球通行（框架态）" sub="护照与签证数据需第三方授权，授权落地前不对客上线。" />
      <Animated.View entering={riseEntering(4)} style={{ marginTop: spacing(2) }}>
        <PrimaryButton label="进入页面转场验证" onPress={onOpen} />
      </Animated.View>
    </ScrollView>
  );
}

function DetailScreen({ onBack }: { onBack: () => void }) {
  return (
    <Animated.View entering={screenEntering()} style={{ flex: 1, padding: spacing(4), backgroundColor: colors.paper }}>
      <Text style={{ fontSize: 20, fontWeight: "800", color: colors.navy }}>页面推进</Text>
      <Text style={{ fontSize: 13, color: colors.mut, marginTop: 8, lineHeight: 21 }}>
        本页以 420ms cubic-bezier(.22,1,.36,1) 进入，伴随 14px 上移与 0.985→1 缩放；
        M1 接入 React Navigation 后，将该曲线绑定到栈导航的 card 插值。
      </Text>
      <View style={{ flex: 1 }} />
      <PrimaryButton label="返回" variant="berry" onPress={onBack} />
    </Animated.View>
  );
}

export default function App() {
  const [tab, setTab] = useState(0);
  const [detail, setDetail] = useState(false);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {detail ? (
          <DetailScreen onBack={() => setDetail(false)} />
        ) : tab === 0 ? (
          <HomeScreen onOpen={() => setDetail(true)} />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.faint, fontSize: 14 }}>{TABS[tab]} · M1 交付</Text>
          </View>
        )}
      </View>
      {!detail && <TabBar tabs={TABS} activeIndex={tab} onChange={setTab} />}
    </SafeAreaView>
  );
}
