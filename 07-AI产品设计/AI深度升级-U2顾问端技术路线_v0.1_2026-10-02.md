# U2 顾问端 AI 深度升级 — 技术路线 v0.1

- 日期：2026-10-02
- 基线：U1（客户端混合模块 src/ai/*，已冻结）；顾问端 advisor-ai 初步代码
- 约束：不动 7 Tab IA / orb；U1 冻结代码不迁移、不重写（增量）

## 1. 总体结构

- 顾问 App 内新建 `src/ai/`（与客户端同构、顾问口径）：
  `types.ts / prompts.ts（advisor system-v1）/ ollama-provider.ts / validator.ts / orchestrator.ts`
- 复用 U1 机制：探测（/api/tags 1.5s）、流式 NDJSON、WordEngine+接地校验、失败降级 D。
- 服务端在 `AdvisorAiService` 增 `context(advisorId, customerRef, kind)`，新增端点
  `GET /advisor/ai/context?customerRef=&kind=`；D 模式 `/advisor/ai/ask` 不动。

## 2. 顾问上下文包（advisor ctx-v1）

kind：`morning | premeet | progress | lookup | pipeline | compsolution | postmeeting | general`

- 锚定校验：customerRef 必须是该顾问 active 主责客户（复用 eng.advisorClients），否则 403/42117 审计。
- 片段：
  - morning：接待队列计数、在服务客户、逾期任务；
  - premeet/progress：案件阶段、co/off 时间线（sp 不进包）、未完成任务、未齐材料（listForAdvisor 投影）；
  - lookup：已发布项目/费表投影（未发布/失效不返回）；
  - pipeline：关系线索与阶段（无支付/佣金明细）；
  - compsolution：已发布项目 + 费表 feeItems 投影 + 诉求维度；
  - postmeeting：客户案件/任务现状（作为草稿生成的接地依据）。
- 知识投影：KnowledgeService published + K1 Wiki publishedPages。
- **物理排除**：支付账户、到账明细、投诉正文、L3 原件、非归属客户、内部核验备注。
- 注入预扫：与客户端同一 INJECTION_RE，命中隔离+审计。

## 3. 草稿与确认（AI 不直接触发业务动作）

- LLM 输出在端侧解析为结构化草稿（JSON 信封，validator 校验）：
  - follow：{text, kind: fact|internal} → 确认走 `POST /advisor/clients/:customerRef/follow-ups`；
  - task：{caseId,title,ownerId,dueAt,source,t0} → 确认走 `POST /admin/tasks`；
  - message：{text} → 仅复制/顾问自行发送，无自动外发端点；
  - proposal：仅提示去「方案」Tab 走 M2 四眼，不自动提交。
- 草稿卡支持编辑后确认、丢弃；确认/丢弃均审计（服务端由真实端点审计 + 端侧丢弃不审计，仅会话内）。
- 解析失败：按只读文本呈现，不生成草稿按钮。

## 4. 模式与配置

- L：本机 Ollama（白名单 qwen3/qwen2.5；EXPO_PUBLIC_AI_BASE/MODEL 同 U1）；
- S：预留 EXPO_PUBLIC_AI_MODE=server；D：永久保底（/advisor/ai/ask）。
- 状态条与客户端一致（已连接本地模型/基础模式）。
- 语音：Web 端可选 webkitSpeechRecognition（仅转文字）；native 后置；不可用时显 mic 禁用态。

## 5. 落点与测试

- 服务端：advisor-ai.service.ts（+context）、advisor-ai.controller.ts（+GET context）。
- 顾问 App：src/ai/* 五文件；AdvisorAiScreen 重写（锚定条+流式+草稿卡确认）；api.ts 增 aiContext/任务/跟进调用（已有跟进？按需补）。
- 测试：
  - 新增 `advisor-ai.context.test.ts`：锚定越权拒绝、sp/L3 不进包、compsolution 只含已发布；
  - 草稿确认走现有 follow-up/task 端点（复用既有测试锁定）；
  - 全量测试不减少（基线 137/135/2skip）。
- 部署：服务端改动 → Render 重部署；顾问 web 重新 export → wrangler。

## 6. 风险

- 小模型 JSON 信封遵从性：解析失败降级为文本/ D，不阻断。
- 任务创建字段严格（caseId 必填）：无案件客户只出跟进/消息草稿。
- localhost 混合内容：localhost 视为安全上下文；超时按 U1（首 token 20s）。
