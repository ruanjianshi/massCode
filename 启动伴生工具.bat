@echo off
chcp 65001 >nul
rem ============================================
rem  massCode Runner 一键启动（Windows，双击运行）
rem  前台运行，关闭窗口或按 Ctrl+C 即停止
rem ============================================
cd /d "%~dp0"

rem 工具目录同级通常就是 markdown-vault（整个文件夹一起放云盘时最稳），自动指向
if exist "%~dp0markdown-vault" set "MASSCODE_VAULT=%~dp0markdown-vault"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装: https://nodejs.org  （装完重开本窗口）
  pause
  exit /b 1
)

set "PORT=4877"
echo 启动 massCode Runner（前台运行，Ctrl+C 停止）
echo 页面：http://127.0.0.1:%PORT%
start "" "http://127.0.0.1:%PORT%"

node server.js

echo.
echo 服务已停止。
pause
