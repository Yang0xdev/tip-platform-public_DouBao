import React, { useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { colors, motion } from "./tokens";

interface TabBarProps {
  tabs: string[];
  activeIndex: number;
  onChange: (index: number) => void;
  style?: ViewStyle;
}

/**
 * 底部 Tab：活动项 Navy-50 胶囊，切换走 spring（图标 1.14→1 弹性在各端接入图标后补）。
 * 胶囊位移按等分宽度计算；等宽布局与客户端 6 tab 一致。
 */
export function TabBar({ tabs, activeIndex, onChange, style }: TabBarProps) {
  const [width, setWidth] = useState(0);
  const indicator = useSharedValue(0);
  const itemWidth = width / tabs.length;

  const capsule = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: withSpring(indicator.value, {
          damping: motion.spring.damping,
          stiffness: motion.spring.stiffness,
          mass: motion.spring.mass
        })
      }
    ]
  }));

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setWidth(w);
        indicator.value = activeIndex * (w / tabs.length);
      }}
      style={[
        {
          flexDirection: "row",
          height: 62,
          backgroundColor: colors.white,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          paddingBottom: 6
        },
        style
      ]}
    >
      {width > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 8,
              left: 0,
              width: itemWidth - 12,
              height: 46,
              marginLeft: 6,
              borderRadius: 23,
              backgroundColor: colors.navy50
            },
            capsule
          ]}
        />
      )}
      {tabs.map((tab, i) => {
        const active = i === activeIndex;
        return (
          <Pressable
            key={tab}
            onPress={() => {
              indicator.value = i * itemWidth;
              onChange(i);
            }}
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: active ? "700" : "500",
                color: active ? colors.navy : colors.faint
              }}
            >
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
