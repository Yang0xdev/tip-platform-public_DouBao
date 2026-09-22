# services/api — NestJS 模块化单体后端

- 框架：NestJS + Prisma + PostgreSQL 15 + Redis/BullMQ
- 限界上下文（按 PRD 里程碑演进）：iam / catalog / transaction / delivery / engagement / settlement / governance
- 请求管线：认证 → 限流幂等 → PEP 授权（Casbin）→ 应用校验（金额/词库/同意）→ FSM 守卫（@tip/core）→ 事务（投影+事件+outbox）→ 哈希链审计
- M0 目标：四类账号 realm 打通、越权拒绝入审计、健康检查、core 状态机可调用

详细契约见 `02-功能设计/PRD/` 与 `技术路线与架构方案_v0.1`。
