#!/bin/bash
# ============================================================
# HBWhere · Mac 本机视觉解析一键配置（v4：彻底退出应用本体 + 通道归属校验）
# 双击运行（若被 Gatekeeper 拦截：右键 → 打开 → 打开）
# 幂等，可重复执行；全程不使用 sudo，不产生任何费用
#
# 架构：浏览器 → 127.0.0.1:11434（本地安全通道，仅 loopback）
#            → 127.0.0.1:11435（Ollama）
# 安全通道为 Chrome 私有网络访问（PNA）预检补响应头。
# ============================================================
set -u

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok(){ echo -e "${GREEN}✔ $1${NC}"; }
info(){ echo -e "${YELLOW}▶ $1${NC}"; }
fail(){ echo -e "${RED}✖ $1${NC}"; }

ORIGINS="https://demo.hbwhere.com,http://localhost:5100,http://127.0.0.1:5100,http://localhost:8081,http://127.0.0.1:8081"
VL="qwen2.5vl:7b"
RELAY_DIR="$HOME/.hbwhere"
RELAY_PL="$RELAY_DIR/ollama-relay.pl"
PLIST="$HOME/Library/LaunchAgents/com.hbwhere.ollama-relay.plist"
UID_NUM="$(id -u)"

echo "=========================================="
echo "  HBWhere 本机视觉解析配置（Mac）v4"
echo "=========================================="

port_busy(){ lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
relay_owns_11434(){
  local pid
  pid="$(lsof -nP -iTCP:11434 -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [ -n "$pid" ] && ps -p "$pid" -o comm= 2>/dev/null | grep -q "perl"
}

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
ok "Ollama：${OLLAMA}"

# 2) 彻底停旧：先卸载旧通道；先退出 GUI 应用本体（否则它会自动拉起服务），
#    再按端口精确结束持有进程，直到两个端口都释放
info "停止旧 Ollama 与旧安全通道…"
launchctl bootout "gui/${UID_NUM}/com.hbwhere.ollama-relay" 2>/dev/null || true
launchctl unload "$PLIST" 2>/dev/null || true

osascript -e 'tell application "Ollama" to quit' 2>/dev/null || true
osascript -e 'quit app "Ollama"' 2>/dev/null || true
# Ollama App 主程序在不同版本叫 Ollama 或 ollama-darwin；先把它本身结束，防止它重启服务
killall ollama-darwin 2>/dev/null || true
killall Ollama 2>/dev/null || true
sleep 4

# 端口仍被占用：按 PID 精确结束（不依赖进程名），最多等约 40 秒
for i in $(seq 1 20); do
  port_busy 11434 || port_busy 11435 || break
  PIDS="$(lsof -nP -iTCP:11434 -sTCP:LISTEN -t 2>/dev/null; lsof -nP -iTCP:11435 -sTCP:LISTEN -t 2>/dev/null)"
  for p in $PIDS; do kill "$p" 2>/dev/null || true; done
  # 应用本体若又拉起，再结束一轮
  killall ollama-darwin 2>/dev/null || true
  killall Ollama 2>/dev/null || true
  sleep 2
done
# 仍占用则强制结束
if port_busy 11434 || port_busy 11435; then
  PIDS="$(lsof -nP -iTCP:11434 -sTCP:LISTEN -t 2>/dev/null; lsof -nP -iTCP:11435 -sTCP:LISTEN -t 2>/dev/null)"
  for p in $PIDS; do kill -9 "$p" 2>/dev/null || true; done
  sleep 3
fi
if port_busy 11434 || port_busy 11435; then
  fail "端口 11434/11435 仍被占用。请手动操作：菜单栏点 Ollama 图标 → Quit Ollama；若终端里跑过 ollama serve，请在那个终端按 Ctrl+C，然后重新运行本脚本。"
  lsof -nP -iTCP:11434 -sTCP:LISTEN 2>/dev/null
  lsof -nP -iTCP:11435 -sTCP:LISTEN 2>/dev/null
  read -n1 -r -p "按任意键关闭…"; exit 1
fi
ok "Ollama 应用与服务已全部停止，端口已释放"

# 3) 写入 Ollama 环境变量（GUI App 从 launchd 继承）
launchctl setenv OLLAMA_ORIGINS "$ORIGINS"
launchctl setenv OLLAMA_HOST "127.0.0.1:11435"
ok "已写入 OLLAMA_ORIGINS（放行演示站点）与 OLLAMA_HOST（127.0.0.1:11435）"

# 4) 安装本地安全通道（Perl，macOS 自带）
mkdir -p "$RELAY_DIR" "$HOME/Library/LaunchAgents"
cat > "$RELAY_PL" <<'PERL_EOF'
#!/usr/bin/perl
# HBWhere Ollama 本地安全通道：11434 -> 11435，仅 loopback；为 PNA 预检补头。
use strict; use warnings;
use IO::Socket::INET; use IO::Select;
$|=1; $SIG{CHLD}='IGNORE';
my $LISTEN=$ENV{HW_LISTEN}||'127.0.0.1:11434';
my $UPHOST='127.0.0.1'; my $UPPORT=$ENV{HW_UP_PORT}||'11435';
my $srv=IO::Socket::INET->new(LocalAddr=>$LISTEN,Proto=>'tcp',Listen=>16,ReuseAddr=>1) or die;
while(my $c=$srv->accept()){ my $pid=fork(); if(!defined $pid){close $c;next;} if($pid==0){handle($c);exit 0;} close $c; }
sub handle{
  my($c)=@_; my $raw='';
  while($raw !~ /\r?\n\r?\n/){ my $n=sysread($c,my $d,8192); return unless $n; $raw.=$d; }
  my($head,$body)=split(/\r?\n\r?\n/,$raw,2); $body='' unless defined $body;
  my @lines=split(/\r?\n/,$head); my $req=shift @lines;
  my($method,$path)=$req=~/^(\S+)\s+(\S+)/;
  my %h; for my $l (@lines){ next unless $l=~/^([^:]+):\s?(.*)$/i; $h{lc($1)}=$2; }
  my $cl=int($h{'content-length'}||0);
  while(length($body)<$cl){ my $n=sysread($c,my $d,$cl-length($body)); last unless $n; $body.=$d; }
  if($method eq 'OPTIONS'){
    print $c "HTTP/1.1 204 No Content\r\n".
      "Access-Control-Allow-Origin: *\r\n".
      "Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS\r\n".
      "Access-Control-Allow-Headers: Authorization,Content-Type,User-Agent,Accept,X-Requested-With\r\n".
      "Access-Control-Allow-Private-Network: true\r\n".
      "Access-Control-Max-Age: 43200\r\n".
      "Content-Length: 0\r\nConnection: close\r\n\r\n";
    close $c; return;
  }
  my $up=IO::Socket::INET->new(PeerAddr=>$UPHOST,PeerPort=>$UPPORT,Proto=>'tcp',Timeout=>10)
    or do { print $c "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"; close $c; return; };
  my $fwd="$method $path HTTP/1.1\r\n";
  for my $l (@lines){ $l=~/^([^:]+):/i; my $k=lc($1); next if $k eq 'connection'||$k eq 'proxy-connection'; $fwd.=$l."\r\n"; }
  $fwd.="Connection: close\r\n\r\n".$body; print $up $fwd;
  my $s=IO::Select->new($up);
  while(1){ my @r=$s->can_read(120); last unless @r; my $n=sysread($up,my $d,16384); last unless $n; print $c $d; }
  close $up; close $c;
}
PERL_EOF
chmod 755 "$RELAY_PL"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hbwhere.ollama-relay</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/perl</string><string>${RELAY_PL}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>HW_UP_PORT</key><string>11435</string></dict>
  <key>StandardOutPath</key><string>/tmp/hbwhere-relay.log</string>
  <key>StandardErrorPath</key><string>/tmp/hbwhere-relay.log</string>
</dict>
</plist>
PLIST_EOF

launchctl bootstrap "gui/${UID_NUM}" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
RELAY_OK=0
for i in $(seq 1 15); do
  if relay_owns_11434; then RELAY_OK=1; break; fi
  sleep 1
done
if [ "$RELAY_OK" != 1 ]; then
  fail "安全通道未能接管 11434 端口。请关闭本窗口后重新运行本脚本；若仍失败，截图本窗口。"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi
ok "本地安全通道已启动并接管 11434（开机自启）"

# 5) 启动 Ollama（11435）
if [ -d /Applications/Ollama.app ]; then open -a Ollama; fi
for i in $(seq 1 40); do
  curl -s --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
  sleep 1
done
if curl -s --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  ok "Ollama 已经安全通道就绪（监听 11435）"
else
  fail "Ollama 未就绪。请手动打开 Ollama App 后重新运行本脚本。"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi

# 6) 拉取视觉模型（CLI 默认连 11434，即安全通道）
if ${OLLAMA} list 2>/dev/null | grep -q "qwen2.5vl"; then
  ok "已存在 Qwen2.5-VL 模型，跳过下载"
else
  info "开始拉取 ${VL}（约 6GB，取决于网速，请勿关闭窗口）…"
  ${OLLAMA} pull ${VL}
fi

# 7) 自检：安全通道归属 + PNA 头 + 视觉模型
info "自检中…"
if ! relay_owns_11434; then
  fail "11434 被 Ollama 直接占用（安全通道未生效）。请完全退出 Ollama 后重跑本脚本。"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi
PNA="$(curl -s -i -X OPTIONS http://127.0.0.1:11434/api/tags \
  -H "Origin: https://demo.hbwhere.com" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Private-Network: true" 2>/dev/null | grep -ci "Access-Control-Allow-Private-Network")"
HASVL="$(curl -s --max-time 3 http://127.0.0.1:11434/api/tags | grep -c qwen2.5vl)"
if [ "$PNA" -ge 1 ] && [ "$HASVL" -ge 1 ]; then
  ok "全部就绪（Safari / Chrome 均可用）！正在打开配置页…"
  open "https://demo.hbwhere.com/mac-vision" 2>/dev/null || true
else
  fail "自检未通过（PNA=${PNA} 视觉模型=${HASVL}）。请完全退出 Ollama 后重跑本脚本；仍失败则截图本窗口。"
  read -n1 -r -p "按任意键关闭…"; exit 1
fi

echo
echo "=========================================="
echo "  配置完成。接下来："
echo "  1. 在 Safari 或 Chrome 打开"
echo "     https://demo.hbwhere.com/live/admin/"
echo "  2. A14 → 检测本机视觉环境 → 视觉模型就绪"
echo "  3. 上传扫描 PDF → 浏览器视觉解析"
echo "=========================================="
read -n1 -r -p "按任意键关闭窗口…"
