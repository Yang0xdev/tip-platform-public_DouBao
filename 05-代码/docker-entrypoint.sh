#!/usr/bin/env bash
# Render 容器入口：启动 API；DEMO_SEED=1 时自动播种虚构示例数据
set -uo pipefail

PORT="${PORT:-3100}"
BASE="http://127.0.0.1:${PORT}"

node services/api/dist/main.js &
PID=$!

if [ "${DEMO_SEED:-0}" = "1" ]; then
  echo "等待 API 就绪后播种示例数据…"
  ok=0
  for _ in $(seq 1 30); do
    if curl -s "${BASE}/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" = "1" ]; then
    NODE_ENV=development BASE="${BASE}" bash services/api/scripts/dev-seed.sh 2>&1 | tee /tmp/seed.log || echo "seed 执行异常（不影响服务）"
  else
    echo "API 未就绪，跳过 seed"
  fi
fi

# API 退出则容器退出
wait "$PID"
