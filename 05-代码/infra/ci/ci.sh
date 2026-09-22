#!/usr/bin/env bash
# CI 唯一真源：Gitee Go / Jenkins / 本地均调用本脚本。
# 阶段：依赖 → 类型 → 领域测试 → 服务测试 → Prisma 校验 → 全量构建。
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== [1/6] 依赖（lockfile 冻结） =="
pnpm install --frozen-lockfile

echo "== [2/6] 类型检查 =="
pnpm typecheck

echo "== [3/6] @tip/core 领域内核测试（红线回归） =="
pnpm --filter @tip/core test

echo "== [4/6] @tip/api 服务测试 =="
pnpm --filter @tip/api build
pnpm --filter @tip/api test

echo "== [5/6] Prisma schema 校验 =="
DATABASE_URL="${DATABASE_URL:-postgresql://tip:tip@localhost:5432/tip}" \
  pnpm --filter @tip/api prisma:validate

echo "== [6/6] 全量构建（api + admin-web） =="
pnpm build

echo "== CI 通过 =="
