# UI 冻结增补 · P1 客户端「我的」真实个人中心（v1.8）

日期：2026-10-02
范围：仅客户端 App「我的」Tab（ProfileScreen）；其余已冻结页面与 IA 不变。

## 变更内容（由 P0 全功能走查发现的死路修复）

原「我的」显示"游客模式"，与客户端固定身份 c-1980 矛盾，确认为死路。重写为真实个人中心：

1. **身份卡**：客户 #1980、联系方式已验证、敏感信息脱敏存储；"已核验"标签。
2. **我的顾问**：从 `GET /v1/engagements/mine` 读取 active 关系与主责顾问；按钮"我的办理"（跳办理 Tab）、"联系顾问"（跳服务 Tab）。
3. **家庭与授权**：`GET /v1/consents?caseId=CASE-0001`，列 active 授权（成员·动作·有效期）；无记录显示说明，不放假入口。
4. **通知渠道**：`GET/POST /v1/notifications/prefs`，App/短信/邮件开关；不可全关（服务端 43105，前端同步拦截）。
5. **AI 助手授权**：显示 `/v1/ai/consent` 状态，点击跳 AI Tab。
6. **本机收藏与对比**：保留原入口与计数。
7. **账号注销（M5 真实闭环）**：
   - 申请两步确认 + 必填原因；
   - 有在办案件/生效订单 → 43902 拒绝（线上实测 c-1980 正确拦截）；
   - 无阻断 → cooling，15 天冷静期（线上实测 c-9099 成功，coolingUntil 正确）；
   - 冷静期可撤回（线上实测 cancelled）。

## 服务端修复（同批）

- `DeletionError` 原继承 Error → Nest 返回 500；改为继承 HttpException，按码映射状态（43901→400、43902/43903/43904→409、43905→404），响应体 `{code,message}`。
- `GET /v1/account/deletion/mine` 原返回单对象/null，统一为 `{records:[...]}`。
- M5 测试断言适配 HttpException 响应形状。

## 验收

- API 全量：**136 tests / 136 pass / 0 fail**（本地 dist；PG 集成 2 skip 不在内）。
- 公网 Render（commit 88160a9）：注销三路径（拦截/申请/撤回）全部实测通过。
- Playwright：新版个人中心渲染正常，3 个通知开关就位，零页面错误、零控制台错误。
- 已部署 https://demo.hbwhere.com/live/client/ ；Gitee + GitHub 已同步。

## 变更控制

本文件之后，「我的」Tab 视觉与功能冻结；后续只允许增量（如真实 Keycloak 登录替换固定身份），不得改动现有区块布局与交互。
