#!/usr/bin/env bash
# 用法: apply-pwa.sh <目标目录，如 06-发布/demo-site/live/client> <全名> <短名> <iOS标题> <描述>
set -e
TARGET="$1"; NAME="$2"; SHORT="$3"; TITLE="$4"; DESC="$5"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -f "$TARGET/index.html" ] || { echo "目标 index.html 不存在: $TARGET"; exit 1; }

cp "$HERE/icon-192.png" "$HERE/icon-512.png" "$HERE/icon-maskable-512.png" "$HERE/sw.js" "$TARGET/"

# 生成 manifest
sed -e "s|__NAME__|$NAME|g" -e "s|__SHORT__|$SHORT|g" -e "s|__DESC__|$DESC|g" \
  "$HERE/manifest.tmpl.json" > "$TARGET/manifest.webmanifest"

# 注入 head（幂等：以标记注释判断）
if ! grep -q "tip-pwa-injected" "$TARGET/index.html"; then
  python3 - "$TARGET/index.html" "$TITLE" <<'PY'
import sys
path, title = sys.argv[1], sys.argv[2]
s = open(path, encoding="utf-8").read()
head = (
    '<!-- tip-pwa-injected -->\n'
    '    <link rel="manifest" href="manifest.webmanifest">\n'
    '    <meta name="mobile-web-app-capable" content="yes">\n'
    '    <meta name="apple-mobile-web-app-capable" content="yes">\n'
    '    <meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
    f'    <meta name="apple-mobile-web-app-title" content="{title}">\n'
    '    <link rel="apple-touch-icon" href="icon-192.png">\n'
    '    <meta name="theme-color" content="#002661">\n'
    '    <link rel="preconnect" href="https://tip-api-niy0.onrender.com" crossorigin>\n'
    '    <link rel="dns-prefetch" href="https://tip-api-niy0.onrender.com">\n'
    '    <style>#boot-splash{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;'
    'background:linear-gradient(135deg,#AF2D67 0%,#002661 100%);color:#fff;'
    'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;z-index:9999}'
    '#boot-splash .brand{font-size:15px;letter-spacing:.18em;font-weight:600;opacity:.85}'
    '#boot-splash .spin{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.28);border-top-color:#fff;animation:bootspin .9s linear infinite}'
    '#boot-splash .tip{font-size:13px;opacity:.8}'
    '@keyframes bootspin{to{transform:rotate(360deg)}}</style>\n'
)
splash = (
    '    <div id="boot-splash"><div class="brand">透明身份规划</div>'
    '<div class="spin"></div><div class="tip">正在加载，请稍候…</div></div>\n'
)
body_script = (
    '  <script>\n'
    '    if ("serviceWorker" in navigator) {\n'
    "      window.addEventListener('load', function () {\n"
    "        navigator.serviceWorker.register('sw.js').catch(function () {});\n"
    '      });\n'
    '    }\n'
    '  </script>\n'
)
if "</head>" in s:
    s = s.replace("</head>", head + "  </head>", 1)
else:
    s = head + s
# 启动屏放在 #root 内，React 挂载后自动替换
if '<div id="root">' in s:
    s = s.replace('<div id="root"></div>', '<div id="root">\n' + splash + '  </div>', 1)
if "</body>" in s:
    s = s.replace("</body>", body_script + "</body>", 1)
open(path, "w", encoding="utf-8").write(s)
PY
fi
echo "PWA applied: $TARGET ($NAME)"
