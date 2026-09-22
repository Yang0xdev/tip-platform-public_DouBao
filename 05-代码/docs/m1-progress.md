# M1 开发进展（内容治理与初步评估）

依据冻结基线 `02-功能设计/PRD/PRD-M1`（v1.0）。M0 未在开发机完成的事项（compose 实跑、Keycloak 真实接入、RN 真机验收）不阻塞 M1 服务层：当前为内存仓储（dev/test，种子为空），Prisma 仓储在 PG 环境就绪后替换；状态机与闸门均在 @tip/core，替换不改业务规则。

## 切片 1：内容目录四眼发布（M1-02/04/05/06 服务侧初版）✅
- 项目/收费方案版本的草稿→复核→发布全链路；词库素材生产点 block 拦截 + warn 确认；金额铁律；游客只读目录。
- 切片 2 已按冻结 PRD 将项目状态机升级为"待核验/待发布复核"两段式，切片 1 的简版流程被替换（见下）。

## 切片 2：核验门 + 机构台账 + 项目两段发布（M1-01/02/03/04/05）✅
- **项目版本状态机对齐 PRD**（@tip/core）：`draft→pending_verification→pending_publish→published→suspended→delisted`，核验/发布驳回回草稿（带原因）；修订已发布版本=新建版本，旧版归档只读。
- **收费方案状态机**：`draft→in_review→published→superseded`；同 code 新版本发布时旧版系统自动 superseded。
- **事实核验台账 VerificationRecord（M1-03）**：逐事实登记（事实/类型/三级来源/来源日期/核验人/核验日期/下次复核日期），节拍政策与持牌 90 天、其他 180 天（初始参数）；状态 verified/due/invalid；`refreshDue` 模拟定时到期置 due；invalid 自动阻断关联项目对客展示（列表与详情均隐藏，详情转"内容复核中"口径）。
- **发布门（服务端强制）**：关键事实至少 1 条且全部 verified/due；核验人≠最后编辑人；发布人≠最后编辑人；发布前必须关联已发布收费方案；词库零 block；暂停必须填原因类别+在办客户处置说明。
- **境内机构台账（M1-01）**：名称/统一社会信用代码（唯一）/备案编号/有效期/联系人(L2)/状态；置有效前必须有备案编号与有效期；60 天内自动显示"临期"（仍可用、进看板）；到期自动不可用（停新接旧门 `assertUsable`）；影子期单人可改但全部审计。
- 测试：core 54（新增项目/收费机 7 例）、api 7 服务测试；HTTP 冒烟全过（自核验 422、自发布 422、失效即隐藏、待备案不可置有效）。
- 端点：
  - 项目：`GET /admin/catalog/projects`、`POST .../drafts|/:id/{draft,new-version,submit-verification,verification,publication,suspend,delist}`
  - 收费：`GET /admin/catalog/fee-schedules`、`POST .../drafts|/:id/{submit,review}`
  - 核验：`GET/POST /admin/verifications`、`POST /admin/verifications/:id/invalidate`
  - 机构：`GET/POST /admin/entities`、`POST /admin/entities/:id/{active,status,update}`
  - 对客：`GET /v1/catalog/{projects,fee-schedules}[/{id}]`（游客只读，仅 published 且核验未失效）

## 切片 3：顾问入驻 + 授权五步 + 名片白名单（M1-09/10/11）✅
- **入驻（M1-09）**：草稿→提交→通过/驳回/补正；提交门=机构有效 + 四条承诺逐条时间戳签署 + 通识培训确认 + L3 材料引用 + 自述在 pitch 生产点过词库；审核中/驳回账号展业门接口级拒绝（非仅 UI 隐藏）；驳回必填原因（含申诉说明）。
- **授权五步（M1-10）**：applied→learning（三份必读：项目规则/禁表述清单/费用说明，逐项记录版本+时间）→grant_pending→authorized（有效期=min(申请时长, 机构备案剩余)，禁永久，上限 2 年）；不可跳步（缺确认 42250）；申请人不可自批；60/30/7 临期、到期定时 expired 停新接旧；项目新版本发布自动重确认，旧确认清空，重走阅读+审批前 assertCanPitch 拒绝；驳回可重申。
- **名片（M1-11）**：游客只读端点只返回白名单字段；自述单独审核通过才展示并带"未经平台核验"；统计固定"样本积累中"无假数字；动作区"即将开放"，不产生关系/归属；响应体无手机号、材料、承诺、佣金、内部备注。
- 测试：core 59、api 14；HTTP 冒烟全过。
- 端点：`/advisor/onboarding/*`、`/advisor/grants/:code/{start,confirm,submit}`、`/advisor/learning/materials`；`/admin/advisors/{onboarding,grants}/*`；游客 `GET /v1/advisor-cards?projectCode=`。

## 后续切片
4. M1-07/08 问卷/结论模板审核 + 初评四结果引擎 API（assessment 内核已就绪；词库挂 assessment 生产点）。
5. M1-14 本机收藏比较（客户端 RN）。
6. M1-15 初评端流程、M1-16 数据源开关框架（FeatureFlag 已就绪）、M1-17 质量基线看板。
7. admin-web A01/A02/A03 页面接真实端点；客户端 M1 页面（RN）。
8. Prisma 仓储替换内存实现（开发机 PG 就绪后），审计落 audit_events。

## 验证
```bash
./infra/ci/ci.sh    # 7 类型检查 + 59 core 测试 + 14 api 测试 + prisma validate + 全量构建
```
