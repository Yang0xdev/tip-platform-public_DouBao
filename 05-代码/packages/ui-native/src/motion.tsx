import React from "react";
import { Pressable, type PressableProps, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  withDelay,
  withTiming,
  withSpring,
  useSharedValue,
  useAnimatedStyle
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { motion, navyButtonGradient, berryButtonGradient, radius } from "./tokens";

/** 页面推进自定义进入动画：420ms 贝塞尔 + 14px 上移 + 0.985→1 缩放（G-P6 v1.3） */
export function screenEntering(delay = 0) {
  return () => {
    "worklet";
    const easing = Easing.bezier(motion.screenEasing[0], motion.screenEasing[1], motion.screenEasing[2], motion.screenEasing[3]);
    const t = (target: number) =>
      delay > 0
        ? withDelay(delay, withTiming(target, { duration: motion.screenDuration, easing }))
        : withTiming(target, { duration: motion.screenDuration, easing });
    return {
      animations: {
        opacity: t(1),
        transform: [{ translateY: t(0) }, { scale: t(1) }]
      },
      initialValues: {
        opacity: 0,
        translateY: motion.riseDistance,
        scale: motion.screenEnterStartScale
      }
    };
  };
}

/** 内容分层入场：第 n 个子元素延迟 n*40ms（仅 fade+rise；交互行只用 fade） */
export function riseEntering(level: number, translate = true) {
  const clamped = Math.min(Math.max(level, 0), motion.riseMaxLevel);
  return () => {
    "worklet";
    const easing = Easing.bezier(0.22, 1, 0.36, 1);
    const d = clamped * motion.riseStep;
    return {
      animations: {
        opacity: withDelay(d, withTiming(1, { duration: 360, easing })),
        transform: translate
          ? [{ translateY: withDelay(d, withTiming(0, { duration: 360, easing })) }]
          : []
      },
      initialValues: { opacity: 0, translateY: translate ? motion.riseDistance : 0 }
    };
  };
}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

type Variant = "navy" | "berry";

interface PrimaryButtonProps extends Omit<PressableProps, "style"> {
  label: string;
  variant?: Variant;
  style?: ViewStyle;
}

/** 主按钮：微渐变 + inset 高光（由内边距亮边模拟）+ 按压缩放 .96 spring */
export function PrimaryButton({ label, variant = "navy", style, ...rest }: PrimaryButtonProps) {
  const pressed = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(pressed.value, {
          damping: motion.spring.damping,
          stiffness: motion.spring.stiffness,
          mass: motion.spring.mass
        })
      }
    ]
  }));

  return (
    <Pressable
      onPressIn={() => (pressed.value = motion.pressScale)}
      onPressOut={() => (pressed.value = 1)}
      {...rest}
    >
      <AnimatedLinearGradient
        colors={variant === "navy" ? [...navyButtonGradient] : [...berryButtonGradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          {
            height: 48,
            borderRadius: radius.button,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 0
          },
          animStyle,
          style
        ]}
      >
        <Animated.Text
          style={{ color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.2 }}
        >
          {label}
        </Animated.Text>
      </AnimatedLinearGradient>
    </Pressable>
  );
}
