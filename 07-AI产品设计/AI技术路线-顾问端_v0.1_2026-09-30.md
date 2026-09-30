# AI 技术路线 · 顾问端 v0.1（增量）

文档状态：v0.1
日期：2026-09-30
基线：《AI 技术路线·客户端 v0.1》（拓扑、Ollama、ChatProvider、护栏通用，本文只写差异）

## 1. 复用部分（不重复建设）

1. 两阶段拓扑不变：开发期浏览器直连本机 Ollama；生产期公司自托管、服务端 VPC 内调用；
2. **ChatProvider 抽象上移为共享客户端模块**（OllamaLocal / Server 两实现），客户/顾问两端共用；
3. system prompt 版本化、WordEngine 词库、输出校验、流式四态、审计与同意门全部复用。

## 2. 新增服务端端点（NestJS `ai` 模块，顾问 realm）

| 方法/路径 | 作用 | 关键规则 |
|---|---|---|
| `GET /advisor/ai/search?q=` | 知识库检索问答（B1） | 仅已发布/有效内容；逐条返回出处与版本 |
| `POST /advisor/ai/proposal-draft` | 方案草稿生成（B2） | 输入客户/画像；费表只读快照、偏离规则同 proposal 服务；返回草稿+来源，**不入库、不提交** |
| `POST /advisor/ai/followup` | 跟进记录整理（B3） | 输出 fact/internal 候选；过 pitch 词库；顾问采纳后才写跟进 |
| `POST /advisor/ai/suggest-reply` | 客户建议回复（B4） | 仅 co/off + 已发布内容；顾问确认后才发送 |
| `POST /advisor/ai/selfcheck` | 提交前合规自检（B8） | 跑词库/必填/费项/四眼资格，返回问题清单；不改变任何状态 |
| `GET /advisor/ai/digest` | 今日/每周摘要（B6） | 按顾问归属聚合逾期、截止、待跟进 |

要点：
- 所有顾问 AI 端点为**只读 + 草稿生成**，不直接写业务库；写操作仍走既有控制器（proposal submit、follow-up add…）；
- 上下文组装复用客户端 `/v1/ai/context` 的过滤管线，额外叠加：顾问 active 主责校验、顾问授权状态（frozenNew 拒绝，码沿用授权域）、staff realm；
- 客户同意门缺失时，任何含案件片段的端点返回 44101（同客户端口径）。

## 3. 端侧落点

| 位置 | 内容 |
|---|---|
| `apps/advisor-app/src/ai/` | 复用共享 ChatProvider；顾问 prompt 模板（检索/起草/自检）、草稿面板组件 |
| 工作台/客户详情/方案页 | 嵌入 AI 摘要、建议回复、AI 起草入口 |
| iPad 讲解模式 | 顾问可见 AI 浮层（默认关），演示模式强制内部字段过滤 |

## 4. 护栏增量

1. 草稿与正式内容在数据结构上分离（`draft` 标记 + 来源数组），未“采纳并署名”不可进入提交流程；
2. AI 自检结果不作为复核结论，仅在顾问端展示并留审计；
3. 评测集增补：诱导 AI 代替复核、frozenNew 状态试探、越权索取其他顾问客户、要求生成承诺措辞——红线拦截 100%。

## 5. 验证

- Spike-4：方案草稿生成 → 顾问采纳 → 完整四眼通过（验证无捷径）；
- Spike-5：越权与 frozenNew 两场景拒绝并审计；
- 其余沿用客户端 Spike 结论。
