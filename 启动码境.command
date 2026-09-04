#!/bin/bash
# ============================================
#  码境 CodeScope 启动（前台运行）
#  服务在前台跑，关闭窗口或按 Ctrl+C 即停止
# ============================================
cd "$(dirname "$0")/masscode-runner" || { echo "找不到 masscode-runner 目录"; read -r -p "按回车退出"; exit 1; }
PORT="${CODESCOPE_PORT:-${MASSCODE_RUNNER_PORT:-4877}}"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装：https://nodejs.org/"
  read -r -p "按回车退出"
  exit 1
fi
if [ "$(node -p 'Number(process.versions.node.split(".")[0])')" -lt 18 ]; then
  echo "Node.js 版本过低：当前 $(node --version)，需要 18 或更高版本。"
  read -r -p "按回车退出"
  exit 1
fi
if [ ! -f node_modules/@novnc/novnc/core/rfb.js ] || [ ! -d node_modules/ws ]; then
  command -v npm >/dev/null 2>&1 || { echo "未找到 npm，无法安装码境依赖。"; read -r -p "按回车退出"; exit 1; }
  echo "首次启动：正在安装 SSH/VNC 界面依赖…"
  npm ci --omit=dev || { echo "依赖安装失败，请检查网络后重试。"; read -r -p "按回车退出"; exit 1; }
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  端口 $PORT 已被占用（可能已在运行）。"
  echo "    如需重启：先 Ctrl+C 或结束旧进程，再重新双击本脚本。"
  read -r -p "按回车退出"
  exit 1
fi

echo "启动码境 CodeScope（前台运行，Ctrl+C 停止）"
echo "页面：http://127.0.0.1:$PORT"
( sleep 1.2; open "http://127.0.0.1:$PORT" ) &
exec node server.js
