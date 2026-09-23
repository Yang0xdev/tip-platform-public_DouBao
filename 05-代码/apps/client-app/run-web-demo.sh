#!/usr/bin/env bash
# 一键启动客户端网页演示：先启动后端（含示例数据），再打开网页
set -e
cd "$(dirname "$0")/../.."
pnpm --filter @tip/api build
PORT=3100 setsid nohup node services/api/dist/main.js >/tmp/tip-api.log 2>&1 &
for i in $(seq 1 15); do curl -sf http://localhost:3100/health >/dev/null && break; sleep 1; done
bash services/api/scripts/dev-seed.sh || true
cd apps/client-app/dist-web
python3 -m http.server 8090 >/tmp/tip-web.log 2>&1 &
echo "客户端演示地址：http://localhost:8090"
