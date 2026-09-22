# packages 共享包

| 包 | 职责 | 状态 |
| --- | --- | --- |
| core | 领域内核（状态机/金额/词库/初评/审计哈希链） | M0 已建，**50 测试通过** |
| api-contract | OpenAPI 3.1 契约与生成的 TS 类型（前后端唯一接口真源） | M1 建 |
| ui | Web 组件库（后台/门户，Tailwind + 设计 token） | M1 建 |
| ui-native | RN 组件库（客户/顾问/iPad）：品牌 token、v1.3 动效原语（screenEntering/riseEntering/PrimaryButton/TabBar） | **M0 Spike 已建，typecheck 通过；真机动效待验** |
| icons | 内联 SVG 图标体系（无 emoji） | M1 建 |
| config | eslint/tsconfig/prettier 共享配置 | M0 部分（tsconfig.base 已在根） |
