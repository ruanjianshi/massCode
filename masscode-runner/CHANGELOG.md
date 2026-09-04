# 更新记录

## v1.0.0 — 2026-09-04

码境 CodeScope 首个正式版本。

### 核心能力

- 支持代码片段、Markdown、LaTeX 工程与绘图文件的统一管理和编辑。
- 提供代码大纲、符号定位、引用检索、调用关系图和树形关系浏览。
- 支持多文件 C/C++ 等代码的运行、检查、格式化及交互式终端。
- 提供 Markdown 实时预览、思维导图及 PNG/SVG 导出。
- 提供 LaTeX 工程目录、资源管理、实时编译和 PDF 预览。
- 集成环境检测、一键部署、CPU/内存/磁盘状态监测。
- 集成 SSH 交互终端与 VNC 远程桌面，支持输入法、窗口适配和网络延迟显示。

### 平台与兼容

- 支持 macOS、Linux/WSL 和 Windows 启动与环境配置。
- 新增 `CODESCOPE_HOST`、`CODESCOPE_PORT`、`CODESCOPE_VAULT` 配置。
- 继续兼容既有 `MASSCODE_*` 环境变量及 massCode Markdown Vault。
