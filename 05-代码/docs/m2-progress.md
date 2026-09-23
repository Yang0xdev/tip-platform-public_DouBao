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

## 切片 4：付款计划/凭证核验/收据 + 变更退款冻结（M2-11/12，D8 保守口径）✅
- payment 限界上下文（services/api/src/payment/）：
  - PaymentPlan：M3 前仅合同首付（平台服务费 confirmed）到期；官方/第三方费显“未发生/not_accrued”，不预记应收；期次与案件节点挂钩。
  - 收款指引：仅展示签约主体对公账户（白名单、户名=主体），“请勿向个人账户转账”等防骗提示常驻；非主体账户无信息。
  - 凭证：客户上传（文件哈希+引用+金额+币种）→ pending_verify，客户端明确“待核验，不代表到账”；重复凭证（哈希+金额+期次，跨订单）拦截 42204。
  - 财务核验（双人/银行核对）：核验人≠顾问（42409）、双人第二核验人留痕（42412/42413）、凭证金额不符不可通过（42411）；verified 自动开收据（编号/期次/币种/金额/水印）；reject 必填原因（户名/金额/不清/重复）回 unpaid 可重传、原凭证留存。
  - 首付 verified + 合同 effective → 订单“待建案”（markReadyForCase，M3 建案）。
  - PaymentGateway 接口仅定义无实现；D8 拍板后装在线/跨境通道，不动状态机。
  - M2-12：变更/退款/分期/争议申请提交即生成编号工单并冻结订单（change_pending/refund_pending），冻结期不可并行付款（42401）、不可并行申请（42251）；执行流转在 M4，“提交即生效”不存在；平台外交易不假装受理。
- 端点：客户 /v1/orders/:id（payment-plan、payee-info、payment-vouchers、receipts、change-requests）；后台 /admin/payments（pending-verify、:orderId/verify、receipts）、/admin/order-changes。
- 测试：payment.service.test.ts 6 场景全绿（待核验≠到账/重复凭证/金额不符与驳回重传/顾问禁验/退款冻结并行门/空说明与平台外边界）；HTTP 全链路冒烟；dev-seed 增补首付凭证→双人核验→收据→待建案。

## 切片 5：顾问客户详情三页签 + iPad 双模式 + 后台 A04/A05（M2-03/07/08）✅
- clientdetail 限界上下文（services/api/src/clientdetail/）：
  - 客户详情 GET /advisor/clients/:relationshipId/detail（复用关系归属校验 advisorClientView，不与既有 clients/:relationshipId 路由冲突），三页签：
    biz（方案编号/版本/状态/有效期 + 订单编号/合同态/冻结态/待建案，官方回执只读占位；**字段级 DTO 无支付账户/到账明细/投诉正文/服务方结算**）；
    follow（跟进时间线 + 新增）；scope（可见/不可见清单，原件批次申请显“办理阶段开放 M3”）。
  - 跟进记录：过词库生产点 pitch（42503），仅本人 active 客户可写（assertWritable）；fact 对客可见、internal 不对客；**不可删除只能更正**：旧条标 corrected 留存、新条 correctedOf 关联并必填更正原因（42505）；对客 GET /v1/follow-ups/mine 字段级过滤。
  - 可选 SnapshotStore 持久化（kind=followup）。
- ipad 限界上下文（services/api/src/ipad/），M2-07/08 双模式硬规则：
  - 会话 start 默认 work；switch 需显式、重复切同模式拒（42602）；end 清理；模式切换/停留/尝试内部内容全部审计；一位客户一会话、他人不可操作（42606）。
  - I-01 projects：仅已发布项目 + 已发布费表费项投影；演示模式境外收取方改中性“境外持牌方”。
  - I-02 proposal：仅 pending_customer/customer_confirmed 可共读（未过 A05 拒 42603）；演示模式剔除 wordVersion/authorId/reviewerId/confirmSnapshot 等内部字段（抓包可验）；attemptInternal 演示模式 403/40301 + deny 审计。
  - 讲解备注 checkRemark 过 pitch 词库（42604，第五生产点）。
- admin-web：A04 关系分配（咨询队列：分配顾问/冲突裁决；双向关系只读表）、A05 报价与合同（复核队列通过/驳回带原因；订单一键“主体门→签署登记（客户 Consent 模拟）→生效”；合同模板五要素核验表）。
- advisor-app：ClientDetailScreen 重写为真实三页签 + 新增跟进（fact/internal 切换）+ 内联更正表单。
- 测试：clientdetail 4 场景、ipad 4 场景全绿（API 非 PG 合计 62）；Playwright 走查顾问端新增/更正跟进、后台 A04/A05 五视图零控制台错误；CI 六阶段通过。
- 全局补丁：main.ts 增加 BigInt.prototype.toJSON（金额 amountMinor 统一字符串输出）。

## 后续切片
- 切片 2：M2-04/05/06/13 方案版本化 + A05 复核 + 客户确认 + 规则快照（含第四生产点词库、人工署名、改价接口拒绝审计、有效期失效）。
- 切片 3：M2-09/10 订单主体三要素门 + 合同五要素受控登记。
- 切片 4：M2-11/12 付款计划/凭证核验/收据 + 退款调整只冻结不执行。
- M2-0 结转：M1 内存聚合回填 SnapshotStore（M2 新聚合直接持久化）。
