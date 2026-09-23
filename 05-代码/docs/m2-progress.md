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

## 切片 2：方案版本化 + A05 复核 + 客户确认 + 规则快照（M2-04/05/06/13）✅
- proposal 限界上下文（services/api/src/proposal/）：
  - 前置门：关系 active 且主责为该顾问（assertWritable）+ 项目授权有效（assertCanPitch）+ 项目/费表 published；缺一拒编（42301/42302/42119）。
  - 方案第四生产点：文案过词库，block 强拦截（42310）；超模板个性化结论必须人工署名（姓名+时间戳）或追溯项目条件版本（42311）。
  - 费表只读快照：顾问无改价入口；偏离仅允许 discount/installment 且只能选自标准费表项，不得新增收费方/收费项（42305），待确认费不可减免（42306），减免额不可高于原价（42307），偏离必填说明（42308）。
  - 四眼复核：复核人≠编制人（42314）；减免超 10%（SECOND_REVIEW_THRESHOLD 影子期校准）需第二复核人且三人互异（42315/42316）；驳回必填原因回草稿（42317）。
  - 客户确认：仅 pending_customer 且有效期内（默认 14 天，core proposalConfirmGuard），确认固化 confirmSnapshot（词库/项目/费表版本+全文+费表快照），供订单永久留痕。
  - 版本化：金额/项目/申请人/责任变更及客户“我要修改”（必填修改点 42320）→ 同号 revision+1 新草稿、旧版不可确认（42319）；项目暂停 invalidateForProject 批量失效在途方案。
  - 三视角越权：顾问/客户查看他人方案 403（42323）+deny 审计；客户列表只回每链最新版（rootOf 回溯）。
  - 持久化：SnapshotStore 写透（kind "proposal"）；onModuleInit 经 listAll 全量加载（含同号各版本），修订链重启不断裂、seq 接续。
- 端点：顾问 /advisor/proposals（drafts、submit、mine、:id）；后台 /admin/proposals（review-queue、approve{secondReviewerId?}、reject{reasons[]}）；客户 /v1/proposals（mine、:id、confirm、revision{note}）。
- 测试：proposal.service.test.ts 8 场景全绿；HTTP 全链路冒烟（草稿→提交→自审 42314→后台通过→客户确认固化 baseline-v1）；CI 通过。

## 切片 3：订单主体三要素门 + 合同五要素受控登记（M2-09/10/13）✅
- order 限界上下文（services/api/src/order/）：
  - 订单生成：客户确认方案即自动生成订单草稿（proposal 控制器联动），固化方案/费表/词库版本快照与归因三字段（来源/关系/佣金分离）；佣金规则仅槽位，点击/咨询/预约/方案确认均不产生可提现佣金（M4）。
  - 主体三要素门（唯一实现，四入口同关、无强制通过参数）：①签约方=境内备案有效主体（entity.usable）；②境外交付方已关联（持牌方或自营交付部门）；③收款账户户名=签约主体（白名单）。阻断列差异项并留 deny 审计；24h 内反复提交 ≥3 次触发 blocked_alert 合规告警线索。
  - 合同模板版本化：五要素（服务范围与边界/退款规则/境外段告知/平台保障边界/隐私跨境告知）齐备才可发布；未发布模板不可进入签署（42202）。
  - 告知 Consent：费用逐项/不承诺结果/隐私跨境逐条时间戳，缺一不可登记；线下/外部签署受控登记（签署时间+完成件引用+核验人，核验人≠顾问）；电子签通道 B 供应商未定不开发。
  - 生效门：D 门未开（D2 未拍板）仅影子环境可生效（core effectiveGuard）；取消必填原因。
  - 越权：客户/顾问查看他人订单 403（42244）+deny 审计；客户只能对本人订单作告知确认（42234）。
- 端点：顾问 /advisor/orders（list、:id、block-reason、drafts 重建通道）；后台 /admin/orders（config、subject-check、signing/start、contract/register、make-effective、cancel）、/admin/contract-templates（drafts、update、publish）；客户 /v1/orders（mine、:id、consents）。
- 测试：order.service.test.ts 9 场景全绿（含 ORD-2409-018 户名不符反例、D 门非影子不可生效、三要素阻断与告警）；HTTP 全链路冒烟通过；dev-seed 增补方案→订单全链路（影子生效 ORD-0001）。

## 后续切片
- 切片 2：M2-04/05/06/13 方案版本化 + A05 复核 + 客户确认 + 规则快照（含第四生产点词库、人工署名、改价接口拒绝审计、有效期失效）。
- 切片 3：M2-09/10 订单主体三要素门 + 合同五要素受控登记。
- 切片 4：M2-11/12 付款计划/凭证核验/收据 + 退款调整只冻结不执行。
- 切片 5：M2-03 顾问客户详情三页签 + M2-07/08 iPad 双模式（RN），admin A04/A05 页面。
- M2-0 结转：M1 内存聚合回填 SnapshotStore（M2 新聚合直接持久化）。
