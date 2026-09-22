# M1 开发进展（内容治理与初步评估）

依据冻结基线 `02-功能设计/PRD/PRD-M1`（v1.0）。M0 未在开发机完成的事项（compose 实跑、Keycloak 真实接入、RN 真机验收）不阻塞 M1 服务层开发：当前持久化为内存仓储（dev/test），Prisma 仓储在 PG 环境就绪后替换，状态机与闸门均在 @tip/core，替换不改业务规则。

## 切片 1：内容目录四眼发布（M1-02 / M1-04 / M1-05 / M1-06 服务侧）✅

- `catalog` 模块：项目版本、收费方案版本的草稿→提交→四眼复核→发布→下架/驳回修订全链路。
- 闸门（服务端强制，6 条 node:test 服务测试 + HTTP 冒烟全过）：
  - 四眼：编制人≠复核人，同人复核返回 REVIEWER_IS_AUTHOR；驳回后修订清空复核人，必须重走四眼；
  - 词库：标题/正文在"素材"生产点过 WordEngine，block 命中禁止起草（42201，返回命中明细）；warn 命中允许起草但通过复核须显式知情确认（42202）；
  - 金额铁律：收费方案过 validateFeeItems（tbc 不得填金额、缺收取方拒绝、无总价字段）；
  - 状态白名单：草稿直接 approve 返回 40901；
  - 对客只读：仅 published 经 `/v1/catalog` 可见（游客可读，M1-12/13），草稿/在审/下架不可见；
  - realm：游客写 401、customer 写 403、仅 staff 可写，全部留痕。
- 端点：
  - staff：`GET/POST /admin/catalog/:kind`、`POST /admin/catalog/:kind/:id/{submit,review,revise}`（kind=projects|fee-schedules）
  - 公开：`GET /v1/catalog/projects`、`/v1/catalog/projects/:id`、`/v1/catalog/fee-schedules[/{id}]`

## 后续切片（按 PRD-M1 顺序）

2. M1-01 境内机构台账 + M1-03 核验台账（VerificationRecord 与项目版本挂钩，未核验事实不可发布）。
3. M1-09/10 顾问入驻审核 + 学习必读与授权五步（authorizationMachine 已在内核）。
4. M1-07/08 问卷/结论模板审核 + 初评四结果引擎 API（assessment 内核已就绪）。
5. M1-11 名片白名单只读、M1-14 本机收藏比较（客户端）。
6. M1-15 初评端流程、M1-16 数据源开关框架（FeatureFlag 已就绪）、M1-17 质量基线看板。
7. admin-web A01/A03 页面接真实端点；客户端 M1 页面（RN）。
8. Prisma 仓储替换内存实现（开发机 PG 就绪后），含审计落库。

## 验证

```bash
./infra/ci/ci.sh    # 7 类型检查 + 50 core 测试 + 6 api 测试 + prisma validate + 全量构建
```
