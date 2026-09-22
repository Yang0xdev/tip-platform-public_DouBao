# @tip/admin-web 统一总后台（M0）

React 18 + Vite 6 + Tailwind 3 + TypeScript。视觉契约：`04-UI设计/hifi/总后台高保真_v1.0.html` 与设计系统 token（Navy/Berry 签名渐变、sh1/sh2、Manrope+Noto Sans SC）。

## M0 范围

- 登录壳：开发期经 `x-tip-realm/x-tip-user` 头模拟身份（M1 替换为 Keycloak staff realm + MFA）；登录必须真实连通后端并通过 realm 守卫，不做假成功。
- 运营工作台：真实读取 `/v1/_meta/machines`（状态机数量）与 `/v1/_meta/audit/verify`（哈希链完整性）；六门特性开关状态；A01–A12 模块地图（按 PRD 里程碑占位，不提前放半成品）。
- Vite dev/preview 已配置 `/v1`、`/health` 代理到 `http://localhost:3100`。

## 运行

```bash
# 终端 1：后端
pnpm --filter @tip/api start
# 终端 2：后台
pnpm --filter @tip/admin-web dev      # http://localhost:5100
# 生产构建
pnpm --filter @tip/admin-web build && pnpm --filter @tip/admin-web preview
```

## 后续（按冻结 PRD）

M1：A01 内容治理（项目/费表四眼发布、词库、数据源开关）、A03 顾问授权五步；M2：A04/A05；M3：A02/A06/A09；M4：A07/A08/A10/A11/A12。
