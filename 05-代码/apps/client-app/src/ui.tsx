import React from "react";
import { ActivityIndicator, Pressable, Text, View, type ViewStyle, type TextStyle } from "react-native";
import Animated, { Easing, useSharedValue, useAnimatedStyle, withTiming, withSpring, withDelay } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { colors, motion, radius, signatureGradient, navyButtonGradient, berryButtonGradient } from "@tip/ui-native";
import { CURRENCY_DECIMALS, fromMinor, type Currency, type FeeItem } from "@tip/core";

/* ---------- 主按钮：微渐变 + inset 高光 + 按压缩放（G-P6 v1.3） ---------- */
export function GradientButton({
  label,
  onPress,
  variant = "navy",
  disabled = false,
  style
}: {
  label: string;
  onPress: () => void;
  variant?: "navy" | "berry";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const g = variant === "berry" ? berryButtonGradient : navyButtonGradient;
  return (
    <Animated.View style={[animStyle, style, { opacity: disabled ? 0.55 : 1 }]}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPressIn={() => (scale.value = withSpring(motion.pressScale, { damping: 20, stiffness: 300 }))}
        onPressOut={() => (scale.value = withSpring(1, { damping: 15, stiffness: 200 }))}
        onPress={onPress}
      >
        <LinearGradient
          colors={[...g]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ height: 48, borderRadius: radius.button, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colors.white, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 }}>{label}</Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, padding: 16 }, style]}>
      {children}
    </View>
  );
}

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontSize: 16, fontWeight: "800", color: colors.ink, letterSpacing: 0.2 }}>{title}</Text>
      {sub ? <Text style={{ fontSize: 12, color: colors.faint, marginTop: 3, lineHeight: 17 }}>{sub}</Text> : null}
    </View>
  );
}

export function Tag({ text, tone = "info" }: { text: string; tone?: "info" | "ok" | "warn" | "bad" | "berry" | "muted" }) {
  const map = {
    info: [colors.infoBg, colors.info],
    ok: [colors.okBg, colors.ok],
    warn: [colors.warnBg, colors.warn],
    bad: [colors.badBg, colors.bad],
    berry: [colors.berry50, colors.berry],
    muted: [colors.lineSoft, colors.mut]
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: bg, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

export function Loading({ label = "加载中…" }: { label?: string }) {
  return (
    <View style={{ padding: 40, alignItems: "center", gap: 12, flexDirection: "row", justifyContent: "center" }}>
      <ActivityIndicator color={colors.navy} />
      <Text style={{ color: colors.mut, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <View style={{ margin: 16, padding: 14, borderRadius: radius.control, backgroundColor: colors.badBg, borderWidth: 1, borderColor: "rgba(192,50,33,.25)" }}>
      <Text style={{ color: colors.bad, fontSize: 13, lineHeight: 19 }}>{message}</Text>
      <Text style={{ color: colors.faint, fontSize: 11.5, marginTop: 6 }}>请检查网络或稍后重试；我们不会用缓存假数据顶替。</Text>
    </View>
  );
}

export function EmptyBox({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ padding: 34, alignItems: "center" }}>
      <Text style={{ color: colors.mut, fontSize: 14, fontWeight: "600" }}>{title}</Text>
      {sub ? <Text style={{ color: colors.faint, fontSize: 12, marginTop: 6, textAlign: "center", lineHeight: 18 }}>{sub}</Text> : null}
    </View>
  );
}

/* ---------- 费用行：分项/收取方/币种/确定性；永不出现跨币种总价 ---------- */
const CERTAINTY_LABEL: Record<FeeItem["certainty"], string> = {
  confirmed: "确定",
  estimated: "估算",
  tbc: "待确认",
  not_incurred: "本路径不发生"
};

export function FeeLine({ item }: { item: FeeItem }) {
  let amount = "—";
  if (item.certainty === "tbc") amount = "待确认（不计入任何合计）";
  else if (item.certainty === "not_incurred") amount = "不发生";
  else if (item.currency && item.amountMinor !== null) {
    const cur = item.currency as Currency;
    const decimals = CURRENCY_DECIMALS[cur] ?? 2;
    amount = `${cur} ${fromMinor(BigInt(item.amountMinor), cur)}${decimals === 0 ? "" : ""}`;
  }
  return (
    <View style={{ paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.lineSoft }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink, fontWeight: "600" }}>{item.label}</Text>
        <Text style={{ fontSize: 13.5, color: colors.navy, fontWeight: "700" }}>{amount}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
        <Tag text={CERTAINTY_LABEL[item.certainty]} tone={item.certainty === "confirmed" ? "ok" : item.certainty === "estimated" ? "warn" : "muted"} />
        <Text style={{ fontSize: 11.5, color: colors.faint, flex: 1, lineHeight: 17 }}>
          收取方：{item.collectorTbc || !item.collector ? "待确认" : item.collector}
        </Text>
      </View>
    </View>
  );
}

/* ---------- 分层入场（rise 14px，nth-child +40ms 由调用方传 level） ---------- */
export function Rise({ children, level = 0, style }: { children: React.ReactNode; level?: number; style?: ViewStyle }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue<number>(motion.riseDistance);
  React.useEffect(() => {
    const delay = Math.min(level, motion.riseMaxLevel) * motion.riseStep;
    const t = motion.screenDuration * 0.7;
    const easing = Easing.bezier(motion.screenEasing[0], motion.screenEasing[1], motion.screenEasing[2], motion.screenEasing[3]);
    opacity.value = withDelay(delay, withTiming(1, { duration: t, easing }));
    translateY.value = withDelay(delay, withTiming(0, { duration: t, easing }));
  }, [opacity, translateY, level]);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: translateY.value }] }));
  return <Animated.View style={[anim, style]}>{children}</Animated.View>;
}

export const screenTitle: TextStyle = { fontSize: 22, fontWeight: "800", color: colors.ink, letterSpacing: 0.3 };
export { colors, signatureGradient };
