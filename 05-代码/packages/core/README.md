# @tip/core 领域内核

前后端共用的纯 TypeScript 业务规则包（无 IO、无框架依赖），是 PRD 冻结基线 v1.0 的可执行表达。

## 内容

- `fsm.ts`：通用状态机内核（白名单迁移 + 守卫，无"强制通过"）
- `machines.ts`：19 台聚合状态机（项目/费表四眼发布、授权五步、咨询关系、方案、订单三态、案件、材料、家庭/监护授权、门户批次、送达、工单、合规事件、佣金六态、数据源授权）
- `money.ts`：金额铁律（最小单位 bigint、异币种不合计、tbc≠0、未发生不预记、重复凭证判定）
- `banned-words.ts`：禁表述词库引擎（block/warn × 四生产点：初评/方案/讲解/素材）
- `assessment.ts`：初评四结果引擎（符合/差距/待确认/未承诺，无分数无概率）

## 命令

```bash
pnpm --filter @tip/core test     # 45 条规则测试（红线回归集起点）
pnpm --filter @tip/core build
```

新增/修改状态迁移必须同步在 `tests/machines.test.ts` 增加成功与非法跳步用例。
