#!/usr/bin/env bash
# 一键启动顾问展业端网页演示（依赖后端与示例数据）
set -e
cd "$(dirname "$0")/../.."
pnpm --filter @tip/api build
PORT=3100 setsid nohup node services/api/dist/main.js >/tmp/tip-api.log 2>&1 &
for i in $(seq 1 15); do curl -sf http://localhost:3100/health >/dev/null && break; sleep 1; done
bash services/api/scripts/dev-seed.sh || true
cd apps/advisor-app
EXPO_PUBLIC_API_BASE=http://localhost:3100 npx expo export --platform web --output-dir dist-web >/dev/null 2>&1
cd dist-web
python3 -m http.server 8093 >/tmp/tip-advisor-web.log 2>&1 &
echo "顾问展业端演示地址：http://localhost:8093"
