# UI 与功能冻结说明 — U2 顾问端 AI（v1.7 增补）

- 冻结日期：2026-10-02
- 基线：v1.6（U1 + K1，继续有效）；顾问端 IA（7 Tab、中央凸起 orb）不变
- 原则：功能增量；U1/K1 冻结代码与顾问端其余冻结屏不动

## 1. U2：锚定客户的对话式工作台（顾问端）

- 顶部锚定客户条：客户 chips（本人 active 客户）、当前客户与清除；消息中 `#编号` 自动锚定；非归属客户不可锚定（42117 + 审计）。
- 模式状态条与客户端一致：已连接本地模型（L）/ 基础模式（D）。
- L：本机 Ollama(Qwen) 流式，生成后校验（WordEngine + 数字接地 + 红线）不过即该条降级 D。
- 会后收口：跟进（fact/internal）、T0 任务、对客消息均为**草稿**，顾问可编辑；
  - 跟进确认走 `POST /advisor/clients/:customerRef/follow-ups`；
  - 任务确认走 `POST /admin/tasks`；
  - 消息仅复制、不自动外发；
  - 方案类只引导走 M2 四眼，AI 不自动提交。
- 上下文物理排除：支付账户、到账明细、投诉正文、L3、非归属客户、内部核验备注；sp 不进包。
- 知识投影：KN published + K1 Wiki publishedPages。

## 2. 新增端点

- 顾问：`GET /advisor/ai/context?customerRef=&kind=`
  （kind：morning/premeet/progress/lookup/pipeline/compsolution/postmeeting/general）

## 3. 验收记录

- API 测试：139 tests / 137 pass / 2 skip（PG 集成）/ 0 fail（advisor-ai 5 条，含 U2 两条）。
- Playwright 走查：AI Tab 锚定 #1980 → 晨间简报 D 模式返回真实计数与来源；零页面错误。
- 公网：https://demo.hbwhere.com/live/advisor/ （中央 AI orb）。

## 4. 变更控制

- 顾问 system prompt 版本 advisor-system-v1，改动升版并跑红队回归。
- 草稿确认前不产生任何业务记录（测试锁定）。
- 待办：用户本机配置 OLLAMA_ORIGINS 后可体验 L 流式与草稿确认；U3（K2/K3）在 K1 满一个影子周期后启动。
