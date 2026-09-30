# AI 技术路线 · 总后台 v0.1（增量）

文档状态：v0.1
日期：2026-09-30
基线：《AI 技术路线·客户端 v0.1》《AI 技术路线·顾问端 v0.1》

## 1. 复用

- 自托管两阶段拓扑、ChatProvider、WordEngine、审计与同意门、红队评测管线全部复用；
- 总后台前端沿用 React 18 + Vite + TanStack 技术栈（同 admin-web）。

## 2. 数据模型（Prisma 新增，均为知识与运营域）

| 模型 | 关键字段 |
|---|---|
| KnowledgeItem | id、分类（project/country/fee/policy/template/education）、标题、正文/字段 JSON、来源 refs、状态（draft/in_review/published/expired/archived）、版本、提交人/复核人 |
| KnowledgeVersion | 条目版本树、发布/失效时间、变更说明 |
| SourceRecord | 来源类型、核验状态、核验人、有效期（对接 VerificationRecord 口径） |
| AiPromptVersion | 场景、system prompt、护栏规则集/越狱库版本、状态、提交/复核/发布人 |
| AiModelConfig | 提供方（ollama_local/vllm_self/online）、模型 tag、路由场景、开关 |
| AiUsageEvent | 端、场景、用户匿名 ref、结果（采纳/转人工/未找到/拦截）、资源用量、时间 |
| RedTeamRun | 评测集版本、结果明细、通过率、门禁结论、执行人 |
| ConsentLedger | 客户 ref、授予/撤回、时间戳、版本 |

要点：知识条目与版本分离，失效/回滚不改写历史；用量事件只存匿名 ref 与必要元数据，不含完整对话正文（正文按会话治理单独存储与删除）。

## 3. 新增端点（NestJS `ai-ops` 模块，staff realm，按角色授权）

- 知识：`POST /admin/ai/knowledge/import`、GET list、`:id/submit`、`:id/review{approve|reject}`、`publish|expire|rollback`、GET gaps；
- 来源：`POST /admin/ai/sources`、`:id/verify`；
- 模型/Prompt：GET/POST `/admin/ai/models`、`/admin/ai/prompts`、`:id/submit|review|publish|rollback`；
- 运营：GET `/admin/ai/metrics?dim=`（口径固定，样本不足显积累态）；
- 同意/审计：GET `/admin/ai/consents`、`/admin/ai/audit`（脱敏默认）；
- 红队：POST `/admin/ai/redteam/run`、GET runs；
- 生成内容：GET `/admin/ai/generated`（只读聚合）。

控制要点：
- 所有发布/模型变更类动作服务端强制四眼与红队门禁，无绕过参数；
- 在线模型开关默认 false，开启需独立授权（V1 不实现开启路径，仅留配置位）；
- metrics 白名单字段，禁止输出获批率/成功率等业务红线指标。

## 4. 失效联动

- 来源/授权失效 → 调度任务将关联 KnowledgeItem 置 expired 并触发各端缓存失效；
- 签证类沿用 Q6：授权失效 30 分钟全网下架，配套演练脚本与计时审计。

## 5. 前端

- admin-web 新增 `modules-ai-ops.tsx`（八个页面，复用 Panel/useApi/通用组件）；
- 监控图表统一走既有图表规范，标注口径与时间范围；
- 草稿/待复核/已发布状态色与既有后台一致。

## 6. 验证

- Spike-6：知识全链（导入→提取→四眼→发布→客户端检索→失效下架）；
- Spike-7：模型/prompt 变更红队门禁（不通过不可发布）；
- 安全用例：自动发布、越权查看、在线外传、L3 入库四类拒绝并审计。
