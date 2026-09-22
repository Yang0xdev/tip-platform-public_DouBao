# apps 前端四端

| 目录 | 端 | 技术 | 状态 |
| --- | --- | --- | --- |
| client-app | 客户服务端（手机） | Expo SDK 52 / React Native 0.76 + Reanimated 3.16 | **M0 动效 Spike 已建（typecheck 通过，真机待验）**，M1 起交付业务页 |
| advisor-app | 顾问展业端（手机 + iPad 同源） | React Native（平板布局，复用 client 工程模式） | M1/M2 |
| admin-web | 统一总后台 | React 18 + Vite + Tailwind + TanStack | **M0 登录壳+工作台已通**（真实接后端，Playwright 验证零错误） |
| partner-portal | 服务方受控门户（ext/in 双模式） | React 18 + Vite，响应式 Web | M3 |

视觉契约：`04-UI设计/hifi/`（内容 v1.3）；设计 token 见设计系统组件库 v1.1 与 `packages/ui-native/src/tokens.ts`。
所有前端只做展示与交互，红线判定一律以服务端 + @tip/core 为准。
