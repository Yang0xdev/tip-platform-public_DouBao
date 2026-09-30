# AI 技术路线 · 顾问端 v0.2（随重设计增量）

文档状态：v0.2（替代 v0.1 中与本文冲突部分；拓扑/部署/模型不变）
日期：2026-09-30
基线：客户端技术路线 v0.1、顾问端技术路线 v0.1

## 1. 不变部分

- 两阶段拓扑（开发期浏览器直连本机 Ollama；生产期自托管、VPC 内调用）；
- ChatProvider 共享抽象、WordEngine、审计、同意门、流式四态。

## 2. 支撑“客户锚点”的关键设计

1. **AdvisorAiContext（服务端组装、按顾问过滤）**
   入参：advisorId、customerRef（锚点）、场景；
   组装内容：该客户关系状态与主责校验、顾问项目授权范围与有效期、客户阶段、
   timeline 变化（可带 since=上次会面）、缺失材料、co/off 事实、已发布教育/核准素材清单；
   物理排除：支付账户/到账明细、投诉正文、L3 原文、非归属客户数据。
2. **锚点校验失败即拒绝**：关系非 active 主责 / 顾问 frozenNew / 项目授权失效 /
   客户同意缺失（含案件片段时）→ 对应错误码并审计，不返回降级上下文。
3. 端侧持久化“当前客户锚点”，切换客户即重新拉取 context。

## 3. 新增/调整端点（staff realm）

| 方法/路径 | 场景 | 规则 |
|---|---|---|
| GET /advisor/ai/morning-brief | A1/A2 | 返回按风险排序的行动项 + 风险雷达；每项含 deep link（页面+客户锚点） |
| POST /advisor/ai/pre-meeting | B1/B2 | 入参 customerRef、meetingAt；含 since 上次会面的变化、授权边界、核准素材、动线建议 |
| POST /advisor/ai/post-meeting | D1 | 入参现场记录；一次返回四类草稿（follow/task/message/proposal 待更新），不入库 |
| POST /advisor/ai/proposal-draft | D2 | 同 v0.1，附“缺来源段落”标注；采纳后走四眼 |
| POST /advisor/ai/suggest-reply | E1/E3 | 仅 co/off + 已发布；无新事实时 E3 不产出更新（返回 no_new_fact） |
| POST /advisor/ai/explain-letter | E2 | 官方文书白话解释 + 对客草稿 |
| POST /advisor/ai/selfcheck | F1 | 同 v0.1 |
| GET /advisor/ai/learning | F2 | 按本人近失误生成情景微课映射 |
| iPad：POST /advisor/ai/ipad-hint | C1/C3 | 顾问私有 grounded 答案/合规替代说法；演示模式内部字段过滤 |

统一约束：全部为只读 + 草稿生成；任何写动作走既有控制器；采纳动作由端侧在既有端点触发并写审计。

## 4. iPad 展业模式

- 讲解伴侣浮层仅顾问可见：默认关、手动唤起，客户演示区与提示层在视图层分离；
- 现场记录先本地暂存，会后由 post-meeting 统一处理；
- 复用既有 iPad 会话/演示模式守卫（越权 42606、内部访问 40301）。

## 5. 评测增量（红队/验收）

- Spike-4：晨间 deep link → 锚点正确 → 完成动作；
- Spike-5：会前简报完整性（缺变化/授权/素材则不生成）；
- Spike-6：会后四类草稿采纳后分别通过词库/T0/四眼；
- 红线集：承诺/假更新诱导、frozenNew、越权锚点、L3 索取——100% 拒绝并审计；
- iPad：客户视角截图验证提示层不可见。

## 6. 数据与保留

- AI 草稿不入正式库，端侧/会话存储；建议未采纳草稿 7 天失效（待确认）；
- 用量事件匿名化，不含完整对话正文。
