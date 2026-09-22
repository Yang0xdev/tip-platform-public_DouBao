#!/usr/bin/env bash
# CI 唯一真源：Gitee Go / Jenkins / 本地均调用本脚本。
# 阶段：依赖 → 类型 → 领域测试 → Prisma 校验 → 全量构建。
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== [1/5] 依赖（lockfile 冻结） =="
pnpm install --frozen-lockfile

echo "== [2/5] 类型检查 =="
pnpm typecheck

echo "== [3/5] @tip/core 领域内核测试（红线回归） =="
pnpm --filter @tip/core test

echo "== [4/5] Prisma schema 校验 =="
DATABASE_URL="${DATABASE_URL:-postgresql://tip:tip@localhost:5432/tip}" \
  pnpm --filter @tip/api prisma:validate

echo "== [5/5] 全量构建（api + admin-web） =="
pnpm build

echo "== CI 通过 =="
