#!/bin/bash
# ============================================================
# HBWhere · Mac 本机视觉解析一键配置
# 双击运行（若被 Gatekeeper 拦截：右键 → 打开 → 打开）
# 幂等，可重复执行；全程不使用 sudo，不产生任何费用
# ============================================================
set -u

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok(){ echo -e "${GREEN}✔ $1${NC}"; }
info(){ echo -e "${YELLOW}▶ $1${NC}"; }
fail(){ echo -e "${RED}✖ $1${NC}"; }

ORIGINS="https://demo.hbwhere.com,http://localhost:5100,http://127.0.0.1:5100,http://localhost:8081,http://127.0.0.1:8081"
VL="qwen2.5vl:7b"

echo "=========================================="
echo "  HBWhere 本机视觉解析配置（Mac）"
echo "=========================================="

# 1) 定位 ollama
OLLAMA=""
for c in /usr/local/bin/ollama /opt/homebrew/bin/ollama "$HOME/.ollama/bin/ollama" /Applications/Ollama.app/Contents/Resources/ollama; do
  [ -x "$c" ] && OLLAMA="$c" && break
done
if [ -z "$OLLAMA" ]; then
  if command -v brew >/dev/null 2>&1; then
    info "未发现 Ollama，通过 Homebrew 安装中…"
    brew install --cask ollama || brew install ollama
    sleep 2
    command -v ollama >/dev/null 2>&1 && OLLAMA="$(command -v ollama)"
  fi
fi
if [ -z "$OLLAMA" ] && [ -x /Applications/Ollama.app/Contents/Resources/ollama ]; then
  OLLAMA=/Applications/Ollama.app/Contents/Resources/ollama
fi
if [ -z "$OLLAMA" ]; then
  fail "未找到 Ollama。请先从 https://ollama.com/download 安装后重新运行本脚本。"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi
ok "Ollama：$OLLAMA"

# 2) 启动 Ollama App
if [ -d /Applications/Ollama.app ]; then open -a Ollama; fi

# 3) 写入环境变量（launchctl 对从启动台/Dock 打开的 GUI App 生效）
launchctl setenv OLLAMA_ORIGINS "$ORIGINS"
launchctl setenv OLLAMA_HOST "127.0.0.1:11434"
ok "已写入 OLLAMA_ORIGINS（放行 demo.hbwhere.com）与 OLLAMA_HOST"

# 4) 重启 Ollama 使变量生效
info "重启 Ollama 使配置生效…"
osascript -e 'quit app "Ollama"' 2>/dev/null || true
sleep 2
open -a Ollama 2>/dev/null || true
for i in $(seq 1 20); do
  curl -s --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done
if curl -s --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  ok "Ollama 已重启"
else
  fail "Ollama 未就绪，请手动打开 Ollama App 后重新运行本脚本。"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi

# 5) 拉取视觉模型（已存在则跳过）
if $OLLAMA list 2>/dev/null | grep -q "qwen2.5vl"; then
  ok "已存在 Qwen2.5-VL 模型，跳过下载"
else
  info "开始拉取 ${VL}（约 4.7GB，取决于网速，请勿关闭窗口）…"
  ${OLLAMA} pull ${VL}
fi

# 6) 自检
info "自检中…"
if curl -s --max-time 3 http://127.0.0.1:11434/api/tags | grep -q "qwen2.5vl"; then
  ok "全部就绪！正在打开配置页，你也可以直接进入 A14 点「检测本机视觉环境」。"
  open "https://demo.hbwhere.com/mac-vision" 2>/dev/null || true
else
  fail "视觉模型未就绪，可手动执行：$OLLAMA pull $VL"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi

echo
echo "=========================================="
echo "  配置完成。接下来："
echo "  1. 打开 https://demo.hbwhere.com/live/admin/"
echo "  2. A14 → 检测本机视觉环境 → 视觉模型就绪"
echo "  3. 上传扫描 PDF → 浏览器视觉解析"
echo "=========================================="
read -n1 -r -p "按任意键关闭窗口…"
