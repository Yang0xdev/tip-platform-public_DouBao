# M0 地基进展（2026-09-22）

## 已完成并验证

| 项 | 内容 | 验证方式 |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo；apps/services/packages/infra/e2e/docs 骨架 | `pnpm install` 通过 |
| @tip/core 领域内核 | 19 台状态机、金额铁律、词库引擎、初评四结果引擎 | **45 条单测全过**、`tsc` 构建通过 |
| @tip/api 后端骨架 | NestJS；健康检查、realm 守卫（四类账号白名单）、审计留痕、状态机只读端点 | 构建通过；实跑冒烟：无身份 401 且审计 deny、staff/customer 访问 allow 且审计、19 台状态机可查 |

### 红线在代码层的落点（首批）

- 四眼原则：`fourEyesGuard`（编制人≠复核人），项目/费表/授权/合规共用。
- 主体三要素门：`subjectGateGuard`，状态机白名单中不存在绕过事件（测试断言）。
- 待核验≠到账：payment 状态机无 unpaid→verified 直达路径。
- 官方节点凭据：`officialEvidenceGuard`（凭据必需 + 核验人≠发起人）。
- 佣金不可跳步：not_accrued→settled、accrued→pay 等迁移不存在；结算双人。
- 异币种不合计：金额 API 不提供跨币种求和；tbc 不参与合计、不允许填金额。
- 词库四生产点：block/warn 分级，按生产点生效，命中带词库版本。
- D 门/Q6：合同生效门、数据源启用门均为状态机守卫，门不开真实环境不可迁移。

## M0 剩余（下一步）

1. Keycloak 三 realm 接入（当前为 dev 头模拟）：员工 MFA、客户验证码、门户 MFA；step-up。
2. Prisma schema 骨架 + PostgreSQL/Redis 本地 compose；事件表 + outbox + 审计哈希链最小实现。
3. admin-web（Vite+React+Tailwind）登录壳 + 高保真首页用真组件还原（视觉契约：04-UI设计/hifi）。
4. RN 工程初始化 + Reanimated 3 动效 Spike（页面推进 420ms 曲线、Tab 胶囊、按钮按压）；不达标评估 Flutter。
5. CI（Gitee Go/Jenkins）：typecheck + core 测试 + Playwright 骨架。
6. 开工前安全动作：轮换会话中出现过的 Gitee 令牌；新令牌只走密钥管理，不入仓。

## 命令

```bash
cd 05-代码
pnpm install
pnpm --filter @tip/core test      # 领域内核测试
pnpm --filter @tip/api build
pnpm --filter @tip/api start      # http://localhost:3100/health
```
