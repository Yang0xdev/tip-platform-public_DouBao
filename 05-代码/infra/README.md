# infra 基础设施

规划内容（技术方案 v0.1 §8/§9）：

- `postgres/`：PostgreSQL 15 初始化、Prisma 迁移入口
- `redis/`：Redis + BullMQ 队列（T0 定时升级、到期回收、通知重试）
- `keycloak/`：三 realm 配置（员工 MFA / 客户验证码 / 门户 MFA）
- `oss-kms/`：对象存储桶策略（L3 独立桶 + KMS 信封加密 + 预签名）
- `deploy/`：dev → test → shadow → prod 环境模板与变更单流程
- `observability/`：OpenTelemetry、Sentry、日志脱敏、告警规则
- `gitee-go/`（或 Jenkinsfile）：CI 流水线（lint/typecheck/test/E2E/安全扫描）

所有密钥只经 KMS/环境密钥管理，禁止入仓（含 Gitee 令牌，开工前轮换会话中出现过的令牌）。
