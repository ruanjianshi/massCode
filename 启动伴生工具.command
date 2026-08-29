#!/bin/bash
# ============================================
#  massCode Runner 启动（前台运行）
#  服务在前台跑，关闭窗口或按 Ctrl+C 即停止
# ============================================
cd "$(dirname "$0")/masscode-runner" || { echo "找不到 masscode-runner 目录"; read -r -p "按回车退出"; exit 1; }
PORT="${MASSCODE_RUNNER_PORT:-4877}"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  端口 $PORT 已被占用（可能已在运行）。"
  echo "    如需重启：先 Ctrl+C 或结束旧进程，再重新双击本脚本。"
  read -r -p "按回车退出"
  exit 1
fi

echo "启动 massCode Runner（前台运行，Ctrl+C 停止）"
echo "页面：http://127.0.0.1:$PORT"
( sleep 1.2; open "http://127.0.0.1:$PORT" ) &
exec node server.js
