# 功能冻结 — PostgreSQL 持久化 v2.4

日期：2026-10-04　基线：v2.3

## 目标

内存仓储重启即清空，不满足真机/正式使用。引入 PostgreSQL 持久化，
服务状态在重启后自动恢复。

## 方案（通用状态快照，零侵入业务代码）

1. 新表 **service_states(key PK, data JSONB, 时间戳)**；
2. **StateOrchestrator**（persistence/state.orchestrator.ts）：
   - 注册 34 个有状态服务；
   - 深快照：Map/Set/Date/BigInt 用标记序列化，类实例（注入依赖、
     Logger、机器对象）一律跳过，只保留纯数据；
   - `onApplicationBootstrap`：库中有数据则恢复全部服务（Map 清填、
     数组保持引用替换内容）；
   - 每 10 秒自动保存（事务 upsert）；
   - SIGTERM/SIGINT 经 onModuleDestroy 关停落盘（main.ts 启用
     shutdownHooks；销毁顺序保证 Orchestrator 先于 Prisma 落盘）；
3. **dev-seed 幂等**：启动时查 GET /v1/persistence/status，
   已填充则跳过 seed，避免重启重复播种；
4. 端点：GET /v1/persistence/status（staff）。

## 本地嵌入式 PG 验证（全部通过）

- 首次启动：seed 成功，10 秒内自动落盘（34 个服务）；
- 会话内新建工单 TKT-0003；
- 重启 API：日志「已从数据库恢复服务状态（34 个服务）」，
  TKT-0003 存活，重跑 seed 正确跳过；
- 全量测试：139 tests / 137 pass / 2 skip / 0 fail。

## 部署

- 本地/开发：embedded PG（scripts/dev-pg.mjs）；
- 云端：Neon Postgres 免费档，Render 配置 DATABASE_URL（进行中）；
- Prisma 迁移：…service_state。

## 冻结

持久化机制自本说明起冻结；后续新增有状态服务须在 Orchestrator 注册。
现行版本：…v2.3 → **v2.4**。
