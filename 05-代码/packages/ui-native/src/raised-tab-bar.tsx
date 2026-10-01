import React, { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "./tokens";

/* 最小化的 Navigation TabBar 描述（避免本包依赖 react-navigation；字段宽松，运行时按 Navigation 契约使用） */
interface TabBarPropsLite {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  descriptors: Record<string, { options: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: any;
}

/**
 * 带中央凸起 AI 按钮的底部 Tab（React Navigation 自定义 tabBar）：
 *  - 中央为签名渐变圆形 orb，上浮凸起，带缓慢呼吸脉冲；
 *  - 其余 Tab 保持等分布局；视觉契约对齐 AI 高保真 v1.5 / v1.8。
 * Web 与原生共用；动画使用 JS driver（RN Web 兼容）。
 */
export function RaisedTabBar({
  state,
  descriptors,
  navigation,
  centerName = "AI"
}: TabBarPropsLite & { centerName?: string }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2100, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 2100, useNativeDriver: false })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const centerIdx = state.routes.findIndex((r) => r.name === centerName);

  return (
    <View
      style={{
        flexDirection: "row",
        height: 66,
        backgroundColor: colors.white,
        borderTopWidth: 1,
        borderTopColor: colors.line
      }}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const labelText = (typeof options.title === "string" ? options.title : route.name);
        const isFocused = state.index === index;

        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        /* ---------- 中央凸起 orb ---------- */
        if (index === centerIdx) {
          return (
            <View key={route.key} style={{ flex: 1, alignItems: "center" }} pointerEvents="box-none">
              <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={isFocused ? { selected: true } : {}}
                style={{ marginTop: -24 }}>
                <Animated.View style={{ transform: [{ scale }] }}>
                  <LinearGradient
                    colors={["#C63D80", "#AF2D67", "#5E246B", "#002661"]}
                    locations={[0, 0.32, 0.62, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 29,
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#5E246B",
                      shadowOpacity: 0.4,
                      shadowRadius: 13,
                      shadowOffset: { width: 0, height: 7 },
                      elevation: 9,
                      borderWidth: 3,
                      borderColor: "#fff"
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 23, fontWeight: "700" }}>✦</Text>
                  </LinearGradient>
                </Animated.View>
              </Pressable>
              <Text style={{ fontSize: 10.5, fontWeight: "800", marginTop: 3, color: colors.berry }}>
                {labelText}
              </Text>
            </View>
          );
        }

        /* ---------- 普通 Tab ---------- */
        const tint = isFocused ? (options.tabBarActiveTintColor as string) ?? colors.navy : "#8A95A6";
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 3 }}
          >
            {options.tabBarIcon?.({ color: tint, focused: isFocused, size: 20 })}
            <Text style={{ fontSize: 10.5, fontWeight: isFocused ? "700" : "600", color: tint, marginTop: 3 }}>
              {labelText}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
