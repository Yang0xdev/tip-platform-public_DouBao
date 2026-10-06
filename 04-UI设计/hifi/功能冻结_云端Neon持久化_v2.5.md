# 功能冻结：云端 PostgreSQL 持久化接通（Neon + Render）v2.5

- 冻结日期：2026-10-06
- 基线：v2.4（通用状态快照编排 + 本地嵌入式 PG 验证）
- 版本号：v2.5
- 冻结范围：将 v2.4 的持久化能力从「本地/嵌入式 PG」接通到**云端 Neon PostgreSQL**，Render 容器运行时真正使用云端数据库，实现「重启/重新部署后业务数据自动恢复」。

## 一、本次变更（只做接通，不改业务功能）

1. 云端数据库：Neon（PostgreSQL），区域 AWS ap-southeast-1（新加坡），库名 neondb。
2. 迁移：`prisma migrate deploy` 对 Neon 执行成功，全部迁移已应用（含 service_states 表）。
3. Render 服务（srv-datj0f5g1s2s739irgb0）新增环境变量 `DATABASE_URL`（经 Render 官方 env-vars 端点写入；连接串只存于 Render 与本地凭据文件，不入仓库）。
4. 容器启动即用云端库：首次启动 seed 播种 → 10 秒内自动保存到 Neon；后续启动从 Neon 恢复，seed 幂等跳过。

## 二、验收结果（真实执行，可复核）

| 验收点 | 结果 |
|---|---|
| 迁移在 Neon 应用 | 通过，全部 migration applied |
| 首次部署后数据落 Neon | 通过，service_states 34 行（34 个有状态服务） |
| 持久化状态接口 | `enabled=true, populated=true, serviceCount=34` |
| 重新部署（重启）后恢复 | 通过，`restored=true` |
| 会话内变更跨重启存活 | 通过，重启前创建工单 TKT-0003，重启后仍在 |
| seed 幂等跳过 | 通过，重启后无重复数据、示例记录时间戳仍为首次启动时刻 |

验证后已将测试工单 TKT-0003 撤回（withdrawn），保持演示数据干净。

## 三、未改动项（保持冻结）

- 全部业务功能、五端 UI、AI 三端初步功能、PWA、门户均未改动，与 v2.4 及之前冻结状态一致。
- 本地开发仍可用嵌入式 PG（scripts/dev-pg.mjs）；无 DATABASE_URL 时行为不变。

## 四、已知边界 / 后续

- Render 免费版冷启动 30–50 秒、15 分钟无访问休眠；唤醒后从 Neon 恢复，数据不丢。
- Neon 免费额度按计算时长/存储计量，演示用量在免费范围内。
- 发布流水线仍需集成：重新 expo export 后重跑 `06-发布/pwa/apply-pwa.sh`（与本次无关，既有待办）。
- 临时诊断端点 `/admin/seed-log` 仍在，正式上线前移除（既有待办）。

## 五、凭据存放（不入仓库）

- Neon 连接串：本地 `~/.neon/url`（600）+ Render 环境变量 DATABASE_URL。
