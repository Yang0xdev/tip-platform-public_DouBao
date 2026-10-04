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
if "</body>" in s:
    s = s.replace("</body>", body_script + "</body>", 1)
open(path, "w", encoding="utf-8").write(s)
PY
fi
echo "PWA applied: $TARGET ($NAME)"
