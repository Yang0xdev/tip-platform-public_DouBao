# @tip/client-app 客户服务端（M0 动效 Spike）

Expo SDK 52（React Native 0.76）+ Reanimated 3.16。一套代码出客户/顾问手机与 iPad（顾问端 M1/M2 复用）。

## M0 Spike 验证项（对应 G-P6 v1.3 动效契约）

1. 页面推进：420ms `cubic-bezier(.22,1,.36,1)` + 14px 上移 + 0.985→1 缩放（`screenEntering`）；
2. 内容分层入场：子元素逐级 +40ms，最多 10 级（`riseEntering`）；
3. 底部 Tab：活动项 Navy-50 胶囊，位移走 spring（`TabBar`）；
4. 主按钮：Navy/Berry 微渐变 + 按压缩放 0.96 spring（`PrimaryButton`）。

动效原语与品牌 token 在 `packages/ui-native`（@tip/ui-native），客户/顾问/iPad 三端共用；
`prefers-reduced-motion` 对应 RN `AccessibilityInfo.isReduceMotionEnabled()` 的全局降级在 M1 接入导航时统一处理。

## 运行

```bash
pnpm install
pnpm --filter @tip/client-app start     # Expo Dev Server，真机/模拟器扫码
```

monorepo 下 Metro 需在 `metro.config.js` 配置 watchFolders 指向上层目录（M1 随导航接入一并配置并验证）。

## 验证状态（诚实记录）

- 类型检查：随 CI 的 `pnpm typecheck` 通过；
- 真机/模拟器动效：当前构建环境无模拟器，**尚未做逐帧目视验证**；开发机首次 `expo start` 后按上述 4 项逐条验收，若 Reanimated 曲线与高保真不一致，先调 `ui-native/tokens.ts` 的 motion 常量，不允许在页面内散落硬编码动画。
- 不达标回退：若 Reanimated 3 在目标机型达不到高保真手感，按技术方案 §11 评估 Flutter 重写成本后再决策，不在 M1 中途静默换栈。
