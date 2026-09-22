# infra 基础设施

## 本地依赖（docker compose）

`docker-compose.yml` 提供 PostgreSQL 15、Redis 7、Keycloak 25（启动时自动导入 `keycloak/import/` 三个 realm）：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| PostgreSQL | localhost:5432（tip/tip，库 tip） | 业务库；迁移 `pnpm --filter @tip/api prisma:migrate` |
| Redis | localhost:6379 | BullMQ 队列：T0 定时升级、到期回收、通知重试 |
| Keycloak | http://localhost:8080（admin/admin-dev-only） | tip-staff（密码+OTP）、tip-customer（验证码，M1 接 OTP 动作）、tip-partner（密码+OTP） |

```bash
docker compose -f infra/docker-compose.yml up -d
cp services/api/.env.example services/api/.env   # 按需修改
pnpm --filter @tip/api prisma:migrate
```

三 realm 导入 JSON 为 M0 最小配置：员工/门户强制 OTP、客户域关闭注册。M1 接入时补齐：客户短信 OTP 认证器、step-up 动作、客户端 mappers、令牌寿命与签名算法（RS256）、审计事件监听器。

## 环境说明

- 当前构建 VM 无 Docker / 本机 PG，compose 与迁移 SQL 已就位但**未在本环境实跑**；在开发机首次拉起后需验证迁移与 realm 导入，并把结果回填本文档。
- 生产部署（M5）：阿里云境内部署，KMS 信封加密、L3 独立桶、RDS/Redis 高可用、备份 RPO≤24h/RTO≤8h；本 compose 仅用于开发与影子环境。

## 目录规划（后续里程碑填充）

- `deploy/`：环境配置、发布脚本、四环境（dev/test/shadow/prod）
- `observability/`：OpenTelemetry collector、Sentry、日志脱敏配置、Grafana 看板
- `ci/ci.sh`：流水线实际执行脚本（CI 唯一真源，Gitee Go/Jenkins 均调用它）

## 安全红线

所有密钥只经 KMS/环境密钥管理，禁止入仓（含 Gitee 令牌；如令牌曾在聊天/日志明文出现，立即在 Gitee 后台作废旧令牌）。
