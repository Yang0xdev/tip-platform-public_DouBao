import "react-native-gesture-handler";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import RootNavigator from "./src/navigation";

/**
 * 客户端 M1（PRD-M1 M1-12～M1-16）：
 * 游客态首页/发现与详情/本机收藏比较/无状态初评/全球通行框架态。
 * 动效契约见 @tip/ui-native（G-P6 v1.3）：420ms 推进、rise 分层、按钮按压 spring。
 * M0 动效 Spike 已验证可行性，本文件起替换为真实导航与页面。
 */
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
