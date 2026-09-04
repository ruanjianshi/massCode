#!/bin/bash
# 码境 CodeScope 启动（前台运行；关闭窗口或按 Ctrl+C 即停止）
cd "$(dirname "$0")"
PORT="${CODESCOPE_PORT:-${MASSCODE_RUNNER_PORT:-4877}}"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  端口 $PORT 已被占用（可能已在运行），直接打开页面…"
  open "http://127.0.0.1:$PORT"
  exit 0
fi
echo "启动码境 CodeScope（前台运行，Ctrl+C 停止）"
echo "页面：http://127.0.0.1:$PORT"
( sleep 1.2; open "http://127.0.0.1:$PORT" ) &
exec node server.js
