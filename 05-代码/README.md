# 05-代码（工程实现区，M0 已启动）

研发按 `02-功能设计/PRD/` 冻结基线 v1.0（tag `prd-frozen-v1.0`）与《技术路线与架构方案 v0.1》执行；变更走 PRD 索引中的变更控制流程。

**合规门仍然有效**：D 门/Q6 未开的功能（真实交易、门户跨境、结算、电子签、全球通行真实数据、T2）默认开关关闭，只在影子环境可用。

## 当前进展

见 `docs/m0-progress.md`：monorepo 已建；`@tip/core` 领域内核（19 台状态机/金额铁律/词库/初评引擎）45 条单测通过；`@tip/api` NestJS 骨架（realm 守卫+审计+状态机端点）冒烟通过。

## 工程文档

- 《技术路线与架构方案 v0.1》（2026-09-22）：选型与权衡、分层架构、闸门管线、事件溯源落地、数据分级、安全合规、环境与 CI/CD、monorepo 结构、M0–M5 路线、风险与行动项。
- 《技术架构总览 v0.1》HTML：五端分层、请求闸门、事件机制、L3 隔离、里程碑五张图（浏览器直接打开）。
- `docs/m0-progress.md`：M0 进展与剩余项。

## 仓库结构（pnpm workspaces + Turborepo）

```
05-代码/
├── apps/
│   ├── client-app/      # 客户服务端（React Native）
│   ├── advisor-app/     # 顾问展业端手机 + iPad（React Native）
│   ├── admin-web/       # 统一总后台（React + Vite + Tailwind）
│   └── partner-portal/  # 服务方受控门户（React Web，ext/in 双模式）
├── services/api/        # NestJS 模块化单体（iam/catalog/transaction/delivery/engagement/settlement/governance）
├── packages/
│   ├── core/            # @tip/core 领域内核（状态机/金额/词库/初评，前后端共用）
│   ├── api-contract/    # OpenAPI 3.1 契约与类型（M1）
│   └── ui/ ui-native/ icons/ config/
├── infra/               # postgres/redis/keycloak/oss-kms/deploy/observability/ci
├── e2e/                 # Playwright（Web）+ Maestro/Detox（RN），AT 用例
└── docs/                # ADR 与工程进展
```

## 本地命令

```bash
pnpm install
pnpm --filter @tip/core test      # 领域内核红线回归
pnpm --filter @tip/api build
pnpm --filter @tip/api start      # http://localhost:3100/health
```

## 开发铁律（继承产品红线）

- 所有闸门（主体三要素、T0 升级、授权范围、家庭授权、门户越权）必须**服务端强制**，前端控制只作体验；
- 无成功率/获批率；费用分项收取方、异币种不相加；待核验≠到账；
- 佣金六态、授权闭环、素材白名单、门户水印与到期回收按 GP3/GP4、冻结 PRD 与 AT 用例实现；
- 所有高保真稿中的数据均为虚构示例，生产 seed 不得包含（M5 发布扫描断言）。
