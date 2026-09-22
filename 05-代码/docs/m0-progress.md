# M0 地基进展（2026-09-22）

## 已完成并验证

| 项 | 内容 | 验证方式 |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo；apps/services/packages/infra/e2e/docs 骨架 | `pnpm install` 通过 |
| @tip/core 领域内核 | 19 台状态机、金额铁律、词库引擎、初评四结果引擎、审计哈希链 | **50 条单测全过**、构建通过 |
| @tip/api 后端骨架 | NestJS；健康检查、realm 守卫（四类账号白名单）、审计留痕、状态机只读端点 | 冒烟：无身份 401 且审计 deny、staff/customer 放行且审计、19 台状态机可查 |
| 审计哈希链 | core 追加/校验纯函数（注入哈希，Node 注入 sha256）；api 内存链 + /audit/verify、/audit/tail（仅 staff/service） | 50 单测；冒烟 anon 401、customer 403、staff `{ok:true}` |
| 特性开关 | FeatureFlagService 六门种子（全 off）+ /v1/_meta/feature-flags（仅 staff/service）；admin-web 实时读取 | 冒烟 staff 可见、customer 403；后台显示 0/6 |
| Prisma 地基 | schema.prisma：audit_events / outbox_events / feature_flags；M0 迁移 SQL 已生成 | `prisma validate`、generate、`migrate diff` 通过；**迁移实跑待开发机 PG** |
| 本地基础设施 | infra/docker-compose.yml（PG15/Redis7/Keycloak25）+ 三 realm 导入（员工/门户 OTP、客户验证码域） | 配置就位；**构建 VM 无 Docker，未实跑** |
| admin-web 总后台 | Vite6+React18+Tailwind；登录壳（真实过 realm 守卫，不假成功）、工作台（真实读状态机/审计链/六门）、A01–A12 地图 | 构建通过；Playwright 三屏零控制台错误 |
| RN 动效 Spike | @tip/ui-native（品牌 token + screenEntering/riseEntering/PrimaryButton/TabBar）；client-app Expo52 演示页 | 双包 typecheck 通过；**真机/模拟器逐帧待验（VM 无模拟器）** |
| CI | infra/ci/ci.sh（依赖冻结→typecheck→core 测试→prisma validate→全量构建）；.gitee/pipeline.yml 调用同一脚本 | 本环境全绿（4 构建任务） |
| 安全 | Gitee 令牌轮换；新令牌仅存仓库外 ~/.git-credentials（600），仓库扫描零残留 | 已核对 |

### 红线在代码层的落点（首批）

- 四眼原则：`fourEyesGuard`（编制人≠复核人），项目/费表/授权/合规共用。
- 主体三要素门：`subjectGateGuard`，状态机白名单中不存在绕过事件（测试断言）。
- 待核验≠到账：payment 状态机无 unpaid→verified 直达路径。
- 官方节点凭据：`officialEvidenceGuard`（凭据必需 + 核验人≠发起人）。
- 佣金不可跳步：not_accrued→settled、accrued→pay 等迁移不存在；结算双人。
- 异币种不合计：金额 API 不提供跨币种求和；tbc 不参与合计、不允许填金额。
- 词库四生产点：block/warn 分级，按生产点生效，命中带词库版本。
- D 门/Q6：合同生效门、数据源启用门均为状态机守卫；六门开关服务端可读、默认全关，门不开真实环境不可迁移。

## M0 剩余（进入 M1 前在开发机完成）

1. 拉起 docker compose，实跑 Prisma 迁移；AuditService 落库 audit_events 替换内存链，每日 verifyChain 定时任务 + 断链告警。
2. Keycloak 三 realm 真实接入替换 dev 头：员工/门户 OTP、客户短信 OTP、step-up；后端 JWT 校验。
3. 真机/模拟器跑 client-app Spike，按 G-P6 四项动效逐条验收；不达标按技术方案评估 Flutter。
4. Gitee Go 关联 .gitee/pipeline.yml 首跑；补 Playwright Web E2E 骨架（登录成功/越权拒绝/审计可见）。

## 命令

```bash
cd 05-代码
./infra/ci/ci.sh                  # 本地跑完整 CI
pnpm --filter @tip/core test      # 领域内核测试
pnpm --filter @tip/api start      # http://localhost:3100/health
pnpm --filter @tip/admin-web dev  # http://localhost:5100（需先起 api）
docker compose -f infra/docker-compose.yml up -d   # PG/Redis/Keycloak
```
