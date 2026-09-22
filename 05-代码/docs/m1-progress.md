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

## 切片 4：初评问卷/结论模板 + 规则集与无状态引擎（M1-07/08）✅
- **模板版本（M1-07）**：问卷与结论模板各自 draft→in_review→published→superseded，四眼复核；assessment 生产点过词库（"包过"等在题面/选项/结论块均拦截）；客户端只加载已发布版本并带版本号；新版发布旧版自动 superseded。
- **规则集（M1-08）**：随项目管理，项目无已发布版本不可建；每个维度必须挂核验证据，发布门=证据全部 verified 且核验人≠规则集编辑人；同项目新版发布旧版 superseded。
- **无状态评估**：`POST /v1/assessment/evaluate`（游客可用 POST，不保存明细）；输出固定四类 eligible/gap/unconfirmed/not_committed + 三段结构（符合/差距/待确认/来源）+ 固定性质提示（非资格认定、非法律意见、不代表获批）；必填缺失只给已完成部分整理不出确定结论；相同输入幂等；无规则集项目返回"暂无匹配路径"；needs_manual 提示"顾问人工解读即将开放"，M1 不产生任务/归属/佣金。
- RealmGuard 支持 @AllowAnonymous 按方法声明（评估 POST 游客可用，其余游客端点仍仅 GET）。
- 测试：api 17（新增 3 例）；HTTP 冒烟四类结果全过。
- 端点：`/admin/assessment/templates/:kind/{drafts,submit,review}`、`/admin/assessment/rulesets/{drafts,:id/submit,:id/review}`；游客 `GET /v1/assessment/{questionnaire,result-template}`、`POST /v1/assessment/evaluate`。

## 切片 5：Q6 数据源开关框架 + 质量基线看板（M1-16/17）✅
- **M1-16**：DataSourceService 内置单条 visa_passport_data 记录强制 off（提供方/范围/合同期/节拍/署名全空）；`POST /admin/data-sources/:key/configure` 开启前校验五要件齐全且合同未过期（42280/42281），切换写审计；游客 `GET /v1/global-access/:key/status` 在 off/过期时只返回维护态与三页骨架标识，无任何国别数据出口；真实接入留 M5。
- **M1-17**：`GET /admin/quality/dashboard`（staff 只读），口径版本 m1-baseline-v1：核验覆盖率/临期失效数、发布周期中位数（<5 样本显"样本积累中"）、机构可用/临期/不可用、入驻与授权状态分布、初评漏斗（RuleSetService 内仅聚合计数，不落游客明细）；响应显式列出禁止指标（获批率/成功率、成交额排名、词库负向计数）。
- 测试：api 19（新增 2 例）；HTTP 冒烟：游客维护态、强开 42280、看板聚合全过。

## 后续切片
6. M1-14 本机收藏比较（客户端 RN）、M1-15 初评端流程（RN，含全球通行三页维护态骨架）。
7. admin-web A01/A02/A03/A11/A12 页面接真实端点（项目/收费/核验/机构/入驻授权/模板规则集/数据源/看板）。
8. Prisma 仓储替换内存实现（开发机 PG 就绪后），审计落 audit_events。

## 验证
```bash
./infra/ci/ci.sh    # 7 类型检查 + 59 core 测试 + 19 api 测试 + prisma validate + 全量构建
```

## 切片 7：admin-web 接真实端点（A01/A02/A03/A11/A12）✅
- 模块页全部改为真实接口读取（项目版本台账/收费版本/Q6 数据源、境内机构台账、入驻审核与授权五步、质量基线、问卷模板与规则集）；空态显式"影子期种子为空，由真实操作产生"。
- 修复 Vite 代理遗漏 /admin、/advisor（此前后台接口返回 index.html）；新增 services/api/scripts/dev-seed.sh（虚构【示例】数据，仅 dev，走完整四眼发布链；重跑内存仓储重启即清空）。
- Playwright 五页+工作台截图验证零控制台错误；种子走查中验证词库拦截"成功率"（种子文案被 M1-06 正确拒绝后修正）。

## 切片 6：客户端 RN（M1-12～M1-16）✅（代码门）
- React Navigation 7（bottom-tabs + native-stack），M1 仅 4 tab：首页/项目/全球通行/我的；办理中、服务等随 M3/M4 加入，不放假入口。
- 页面：首页（签名渐变 hero + 已发布项目 + 全球通行维护卡 + 收藏入口）、发现（搜索）、项目详情（版本/核验标识/费用分项 FeeLine 无总价/收藏/初评 CTA）、初步评估（问卷 single/choice/number/text、必填校验、四结果 met/gap/unconfirmed + 固定免责声明 + 版本号）、全球通行（三页签骨架，读 visa_passport_data/status，零国别数据）、本机收藏与 2–3 项并列比较（AsyncStorage，不产生画像/归属/佣金）、我的（游客态+承诺）。
- 金额展示复用 @tip/core（CURRENCY_DECIMALS/fromMinor），UI 组件复用 @tip/ui-native token 与动效契约（rise 分层、按钮按压 spring）。
- 验证门：`pnpm --filter @tip/client-app typecheck` 通过；全仓 CI 六阶段通过（7 类型任务/59 core/19 api/构建）。
- **诚实限制**：本 VM 无 iOS/Android 模拟器与真机，RN 运行时视觉与手势验收未执行，留待模拟器/真机（视觉契约以 04-UI设计/hifi 客户端高保真 v1.3 为准）。

## 切片 8：Prisma 持久化地基（真实 PG15 验证）✅（部分范围，见结转）
- 本机无 Docker，引入 embedded-postgres 15.18（devDependency，仅开发/集成测试）：`scripts/dev-pg.mjs`（pg:start/pg:stop），数据目录 .embedded-pg（gitignore）；生产仍走 docker-compose/托管 PG。
- 新增迁移 `20260922104057_m1_aggregate_snapshots`：aggregate_snapshots 投影表（kind+aggregate_id+version 复合主键、JSONB snapshot、state 索引），已对真实 PG15 `migrate dev/deploy` 验证。
- PrismaService（DATABASE_URL 存在才连接，否则内存降级并告警）；SnapshotStore（save 版本化 upsert / latest / listLatest DISTINCT ON）。
- **审计链完整持久化**：AuditService 启动从 audit_events 重放重建哈希链，断链拒绝启动；record 串行队列只追加落库；flush 供停机/测试。HTTP 实测：带 DATABASE_URL 启动→留痕→杀进程重启→链连续 verify ok。
- 集成测试 `src/persistence/persistence.pg.test.ts`（`pnpm --filter @tip/api test:pg`，真实 PG15）：重启连续性+seq 接续、快照版本化、无库降级，3/3 通过；默认 CI 无库时自动 skip（api 22 测试 20 过 2 skip）。
- **结转 M2-0**：catalog/advisors/assessment/globalaccess 等 M1 内存聚合尚未逐一改走 SnapshotStore（读多写少、影子前不阻塞）；M2 交易类聚合从第一行代码起直接采用 SnapshotStore，M2-0 顺带回填 M1 聚合。
