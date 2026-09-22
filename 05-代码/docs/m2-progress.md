# M2 方案与交易 — 开发进展

基线：PRD-M2 v0.1（冻结基线 v1.0，tag prd-frozen-v1.0）。特性开关 transaction 默认 off，M2 全部能力影子环境验证。

## 切片 1：咨询捕获 + A04 分配 + 关系双向确认（M2-01/02）✅
- engagement 限界上下文（services/api/src/engagement/）：
  - 捕获五来源（初评解读/名片预约/名片请求/分享落地/后台手工）；预约与分享**只产生咨询不成立关系、不授权问卷**。
  - 咨询 FSM：pending_assign→pending_accept→accepted（reassigned/closed/conflict_pending/resolved）；关系 FSM：requested→active（decline/reassign/handoff/end）。
  - 双向确认门：平台分配须客户 confirm-assignment 产生客户事件后顾问才可 accept；缺一即 409（42108）。
  - 一名客户一名主责（42102）；客户接受前可撤回；顾问转分配必填原因回队列；后台手工分配留痕。
  - 重复线索（手机号/证件哈希，近 90 天）→ conflict_pending，assertWritable 对冲突客户锁方案/订单（42118），裁决归位/关闭。
  - 问卷解读授权与关系解耦、默认关、可撤回；顾问队列 chips、客户列表仅 active、越权查看他人客户 403+deny 审计（42117）。
- 端点：客户 /v1/engagements（capture、confirm-assignment、withdraw、questionnaire-grant、mine）；顾问 /advisor/engagements/queue、accept、reassign、/advisor/clients；后台 /admin/engagements（queue、relationships、assign、resolve-conflict、manual）。
- 测试：engagement.service.test.ts 11 条（预约不建关系/分享不建关系/双向确认/平台分配门/撤回/转分配/冲突锁定/主责唯一/越权 403/队列隔离/授权解耦）；HTTP 全链路冒烟通过；api 共 33 测试（31 过 2 PG skip），CI 六阶段通过。

## 后续切片
- 切片 2：M2-04/05/06/13 方案版本化 + A05 复核 + 客户确认 + 规则快照（含第四生产点词库、人工署名、改价接口拒绝审计、有效期失效）。
- 切片 3：M2-09/10 订单主体三要素门 + 合同五要素受控登记。
- 切片 4：M2-11/12 付款计划/凭证核验/收据 + 退款调整只冻结不执行。
- 切片 5：M2-03 顾问客户详情三页签 + M2-07/08 iPad 双模式（RN），admin A04/A05 页面。
- M2-0 结转：M1 内存聚合回填 SnapshotStore（M2 新聚合直接持久化）。
