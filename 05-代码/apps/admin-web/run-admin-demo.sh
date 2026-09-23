#!/usr/bin/env bash
# 一键启动总后台演示：后端（含示例数据）+ 总后台网页
set -e
cd "$(dirname "$0")/../.."
pnpm --filter @tip/api build
PORT=3100 setsid nohup node services/api/dist/main.js >/tmp/tip-api.log 2>&1 &
for i in $(seq 1 15); do curl -sf http://localhost:3100/health >/dev/null && break; sleep 1; done
bash services/api/scripts/dev-seed.sh || true
pnpm --filter @tip/admin-web build
cd apps/admin-web
npx vite preview --port 5100 >/tmp/tip-admin.log 2>&1 &
echo "总后台演示地址：http://localhost:5100（点“登录总后台”进入）"
