#!/usr/bin/env bash
# 发布演示站到 Cloudflare Pages（公网：https://demo.hbwhere.com）
# 前置：Token 存于 ~/.cf/token（不进仓库）；Account ID 固定如下。
set -e
cd "$(dirname "$0")/.."
export CLOUDFLARE_API_TOKEN="$(cat ~/.cf/token)"
export CLOUDFLARE_ACCOUNT_ID="8c5ca3dd5c0ed446e027a96ac5424be1"
# 先从冻结高保真同步发布包（保持与 UI Freeze v1.3 一致）
cp "04-UI设计/hifi/客户端高保真_v1.0.html" 06-发布/demo-site/client.html
cp "04-UI设计/hifi/顾问端高保真_v1.0.html" 06-发布/demo-site/advisor.html
cp "04-UI设计/hifi/顾问iPad高保真_v1.0.html" 06-发布/demo-site/advisor-ipad.html
cp "04-UI设计/hifi/总后台高保真_v1.0.html" 06-发布/demo-site/admin.html
cp "04-UI设计/hifi/服务方门户高保真_v1.0.html" 06-发布/demo-site/portal.html
npx wrangler pages deploy 06-发布/demo-site --project-name=hbwhere-demo --branch=main --commit-dirty=true
echo "已发布：https://demo.hbwhere.com"
