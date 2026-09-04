# ⚡ massCode Runner（伴生工具）

给 [massCode](https://masscode.io/) 的代码片段增加 **运行 / 语法检查 / 格式化 / 编辑 / 代码大纲** 能力，**不改动 massCode 本体**。
它直接读取 massCode 的 Markdown Vault（你的片段库），选一个片段就能跑、能改、能跳转。

> **📦 已整体迁移到 iCloud Drive，自动云同步**（见下文「云同步」）。
> 所在位置：`~/Library/Mobile Documents/com~apple~CloudDocs/massCode`（Finder 里就是 **iCloud Drive / massCode**）。

## 目录结构

```
iCloud Drive/massCode/
├── markdown-vault/            ← massCode 的片段库（code/ notes/ 等，随 iCloud 同步）
├── masscode-runner/           ← 伴生工具本体（纯 Node，零依赖）
│   ├── server.js              ← HTTP 服务（127.0.0.1:4877）
│   ├── index.html             ← 界面
│   ├── assets/                ← 高亮库等静态资源（离线可用）
│   └── README.md
└── 启动伴生工具.command        ← macOS 一键启动（前台运行，Ctrl+C 停止）
└── 启动伴生工具.bat            ← Windows 一键启动（前台运行，Ctrl+C 停止）
└── 启动伴生工具.sh             ← Linux / WSL 一键启动
```

## 快速开始

**macOS**：在 Finder 打开 `iCloud Drive / massCode`，**双击「启动伴生工具.command」**
- 终端窗口保持前台运行服务，浏览器自动打开 http://127.0.0.1:4877
- 用完直接 **`Ctrl+C`**（或关掉终端窗口）即停止
- 已运行时再次双击 → 只打开页面，不重复启动

**Windows**：打开 `iCloud Drive/massCode`（或同步下来的 `massCode` 文件夹），**双击「启动伴生工具.bat」**
- 黑窗口前台运行服务并自动打开浏览器；用完 `Ctrl+C` 或关窗口即停止
- 首次使用需先装 [Node.js](https://nodejs.org)（脚本会自动检查并提示）

**Linux / WSL**：在终端进入项目目录后执行：
```bash
chmod +x 启动伴生工具.sh
./启动伴生工具.sh
```
- 自动定位同级 `markdown-vault`，支持 `MASSCODE_VAULT` 和 `MASSCODE_RUNNER_PORT` 覆盖。
- 桌面 Linux 使用 `xdg-open` / `gio` 打开浏览器，WSL 安装了 `wslview` 时自动打开 Windows 浏览器。
- Debian、Ubuntu、Fedora、RHEL、Arch、openSUSE、Alpine 均可识别对应包管理器。
- Node.js 需要 18 或更高版本；启动脚本和环境面板都会区分“未安装”与“版本过低”。

**命令行（任意系统）**：
```bash
cd ~/Library/Mobile\ Documents/com~apple~CloudDocs/massCode/masscode-runner   # macOS
cd masscode-runner                                                             # Windows / Linux
node server.js
```

## 功能

| 按钮 | 说明 |
|------|------|
| ▶ 运行 | 用对应解释器执行当前片段，显示 stdout/stderr/退出码/耗时，超时(10s)自动终止；支持传入 stdin 输入 |
| ✓ 语法检查 | 不执行，只做语法校验 |
| ✨ 格式化 | 按语言自动选工具（见下表），格式化后写回 vault（massCode 实时同步），格式偏好跟随 massCode 编辑器设置 |
| ⌨ 输入 | 不再展开独立输入窗口；检测到 `cin`、`scanf`、`input()` 等读取操作时，在输出区显示内嵌输入卡片，也可手动点击该按钮填写 stdin 后运行 |
| 👁 预览 | 仅 HTML 片段：在沙箱 iframe 中渲染 |
| 📄 Markdown | markdown 片段默认**渲染成文档**（标题/表格/代码块/列表/引用），按钮可切换「📄 源码」查看原文；右侧大纲变成**标题目录**，点标题跳转到文档对应位置；点运行会提示"暂不支持"（文档无运行意义） |
| 📕 LaTeX | 点左侧 `+ TeX` 创建完整工程：自动生成 `main.tex` 及 `data / figures / fonts` 资源目录；编辑区左侧编写源码，右侧由 XeLaTeX/pdfLaTeX 防抖实时编译并显示 PDF，分割条宽度可记忆；大纲按章节生成，编译错误直接显示在预览区 |
| 🧭 大纲 | 右侧结构导航器：按类型/函数/宏/文件级变量分组，支持普通 `typedef`、不透明类型别名和匿名结构体全局变量，显示签名、行号及函数声明/定义状态；可即时筛选、折叠分组，并在多文件片段中切换“当前文件/全部文件”。代码滚动时自动标出当前函数，点击条目跨文件跳转；编辑模式实时刷新 |
| 🔎 符号 | **Source Insight 式阅读**（右侧面板「🧭 大纲 / 🔍 符号」切换）：
  - **符号窗口**：按当前文件列出 函数 ƒ / 类型 ▣ / 宏 # / 变量 =，并明确区分函数**声明/定义**；
  - **上下文窗口**：点击代码中任意标识符 → 自动解析到最佳定义，右侧显示精确函数体、定义来源与**整个 vault 的代码引用**，点击可跨片段/文件跳转；注释、字符串和 Markdown 示例不会混入引用；
  - **调用关系**：基于真实函数定义统计整个 vault 的调用者(callers) / 被调(callees)，不会再把头文件声明后的代码误当成函数体；
  - **全局检索**：🔎 符号 或 Ctrl/⌘+Shift+F 打开跨库符号搜索，可按函数/类型/宏/变量过滤；支持前缀、连续子串与字符序列模糊匹配，↑/↓ 选择、Enter 打开 |
| 🌳 关系 | Source Insight 式关系图：默认用三栏箭头图直观呈现“调用者 → 当前函数 → 被调用”或“包含当前文件 → 当前文件 → 当前文件包含”，蓝线表示流入、绿线表示流出，函数指针目标标为“动态候选”；可切换传统树形、向下/向上/双向。文件关系可解析跨片段本地头文件与系统头文件；图形节点点击即可跳转并成为新的关系中心，树形节点支持逐层展开 |
| 窗口与标签 | 大纲、符号、关系、AI 都可作为独立窗口：从横向标签栏向下拖出后，像左侧面板一样纵向排列并可上下拉伸；把窗口标题拖回标签栏后，重新变成点一个显示一个的标签 |
| ▶ / ✓ / ✨ / ⌨（位置） | 运行/检查/格式化/输入按钮**固定在大纲面板顶部**，与大纲排在一起；点「🧭 大纲」收起大纲列表后，仍保留一列操作按钮，随时可用 |
| ✏ 编辑 / 💾 保存 | 只读 ↔ 可编辑切换：**Markdown / LaTeX** 编辑时左侧源码 / 右侧实时渲染并排（分割条可拖、宽度自动记忆）；**代码**编辑全宽直接改源码、**实时语法高亮**（透明编辑层叠加高亮，边打字边着色，中文输入法合成期临时显示明文）；Cmd/Ctrl+S 或点保存写回 vault（massCode 实时同步），编辑中自动同步不覆盖你的修改，原生撤销 Ctrl/⌘+Z 可用；运行/检查/格式化可直接作用于编辑框内容（未保存也生效） |
| 🔍 环境 | 按 vault 实际语言区分“当前项目需要/可选”工具，显示版本、可执行路径、Linux 发行版和包管理器；顶部状态点持续显示是否就绪，每 60 秒自动复检，可一键在内置终端配置缺失项并在完成后自动验证 |
| 顶部电脑状态 | 每 2 秒刷新 CPU、内存、硬盘使用率，以进度条和黄/红状态提示资源压力；点击任一指标可查看处理器、系统负载、可用内存、磁盘余量、系统与运行时间。macOS 使用可回收内存、Linux 使用 `MemAvailable`，避免把文件缓存误判为内存占满 |

**布局与侧栏**：
- 📐 **拖拽调整**：左侧列表宽度、右侧大纲宽度、底部输出窗口高度均可直接拖拽，自动记忆（左侧向右拉变宽；右侧**向左**拉变宽；输出向上拉变高）
- 🧩 **右侧窗口/标签组**：横向标签栏内一次只显示一个面板；把某个标签向下拖到内容区，它会脱离标签组成为独立窗口。多个独立窗口按纵向排列，拖标题可上下换位，拖底部分隔条可调整高度；点击标题栏的 `↩` 或把标题拖回标签栏，可重新合并为横向标签
- 🏷 **标签栏**：位于左侧**底部**、**两栏**排列；点「🏷 标签」整行可折叠成一行（标签多时不挤占空间），折叠后标题仍显示总数与已选标签；状态记忆
- 🔍 搜索 + 文件夹树（按 `.meta.yaml` 还原真实层级，空文件夹也显示，可折叠）

> - 代码区带内置语法高亮（离线可用，无需联网）。
> - **阅读快捷键**：单击代码中的符号 → 右侧预览定义；双击 → 跳转到最佳定义（跨片段自动切换文件）；Ctrl/⌘+Shift+F → 全局符号检索。
> - **实时同步**：每 2.5s 自动检测 vault 变更（新增/修改/删除片段都会立刻反映），无需手动刷新；编辑模式不会被同步覆盖。
> - **环境检测**：启动时检测 16 项工具（含 LaTeX、Biber、CTeX），此后每 60 秒自动复检，并根据 vault 中实际使用的语言计算项目所需环境；顶部「🔍 环境」绿点表示就绪、红点表示缺失。
>   缺某个工具时，运行/检查/格式化会给出明确的「缺少 xx，安装: xxx」提示，而不是晦涩报错。
> - **一键配置**：只安装当前项目实际需要且尚未安装的工具。macOS、Linux、Windows 都会切换到底部交互终端执行，涉及系统权限时可直接输入密码；命令结束后自动复检并给出成功或缺失结果。

## LaTeX 工程资源

新建 LaTeX 工程会自动生成以下结构：

```text
工程名/
├── main.tex
├── data/
│   └── references.bib
├── figures/
└── fonts/
```

- `data`：存放并在线编辑 `.bib`、`.csv`、`.json`、`.yaml`、`.tex` 等文本资源；模板已接入 `data/references.bib`，环境有 Biber 时自动生成参考文献。
- `figures`：上传并预览 PNG、JPEG、PDF 等图片或图表，支持在预览页直接重命名，源码可通过 `\includegraphics{文件名}` 引用。
- `fonts`：上传并预览 OTF、TTF、TTC、WOFF 字体；XeLaTeX 可通过 `\setmainfont{字体文件名}[Path=fonts/]` 使用本地字体。
- 左侧资源文件可直接打开；文本可编辑保存，图片、PDF、字体可预览，也可通过目录行的 `＋` 上传或替换。项目文件夹可拖到其他普通文件夹或根目录，资源也可拖到另一工程的同类型资源目录。LaTeX 左侧源码在编辑过程中持续语法高亮，右侧同步编译 PDF。编译时资源会按原目录复制到隔离的临时环境中。

## 多文件片段（.cpp + .hpp 一起编译）

massCode 一个片段里可以有多个 fragment。**把 fragment 标签写成文件名**，运行时就会把所有 fragment
写到同一临时目录并**一起编译/运行**：

- **C/C++**：标签命名如 `main.cpp`、`calc.hpp` → 运行 = `g++ main.cpp ... -I<dir>` 一起编译（头文件用
  `#include "calc.hpp"` 即可找到），再执行二进制。
- **Python/JS/TS/Bash/Ruby/Swift/Go**：同样按文件名写进同一目录，跨文件 `import` / `require` 生效。
- 标签不是文件名时自动兜底：单文件 `main.<ext>`，多文件 `file1.<ext>`、`file2.<ext>`…
- 界面上多文件片段会显示「📦 N 个文件」徽章；大纲/编辑按当前选中的 fragment 生效。

## 支持的语言

| 语言 | 运行 | 检查 | 格式化 |
|------|:--:|:--:|:--:|
| JavaScript | node | node --check | Prettier |
| TypeScript | node（原生剥离类型） | node --check | Prettier |
| Python | python3 | py_compile | black |
| Bash | bash | bash -n | Prettier |
| C | gcc 编译+运行 | gcc -fsyntax-only | clang-format |
| C/C++ | g++ 编译+运行 | g++ -fsyntax-only | clang-format |
| Java | java（单文件源码运行） | javac | — |
| Ruby | ruby | ruby -c | — |
| Swift | swift | swiftc -typecheck | — |
| Go | go run | go vet | gofmt |
| JSON | —（校验结构） | JSON.parse | Prettier |
| HTML | 预览渲染 | — | Prettier |
| LaTeX | 实时编译 PDF（XeLaTeX，回退 pdfLaTeX） | 编译即检查 | — |
| 其他 | 提示不支持 | — | 提示不支持 |

> 格式化工具：C/C++ → clang-format，Go → gofmt，Python → black，其余 → Prettier。
> Prettier 首次调用需联网（`npx -y prettier@3` 按需下载）；clang-format / gofmt / black 完全离线。

## 配置

- 端口：`MASSCODE_RUNNER_PORT`（默认 `4877`），仅绑定 `127.0.0.1`
- 监听地址：默认 `MASSCODE_RUNNER_HOST=127.0.0.1`（仅本机）；局域网访问时设置为 `0.0.0.0`，再通过本机局域网 IP 访问，例如 `http://10.16.0.205:4877`
- 手动指定 vault：`MASSCODE_VAULT=/path/to/markdown-vault node server.js`
- 自动从 massCode 偏好设置（`~/Library/Application Support/massCode/v2/preferences.json` 的 `storage.rootPath`）
  读取 vault 路径（vault = rootPath 下的 `markdown-vault`）；读不到时按 `~/massCode/markdown-vault` 兜底
- 日志：`/tmp/masscode-runner.log`（不写进工具目录，避免云同步到日志）

## 云同步（iCloud Drive）

**当前状态：整个 `massCode` 目录已放进 iCloud Drive，片段与工具自动同步到你的所有设备。**

- **同步内容**：`markdown-vault/`（片段库）、`masscode-runner/`（工具本体）、`启动伴生工具.command`。
  用任一台 Mac 修改片段，其他设备稍后自动同步（iCloud 后台上传/下载）。
- **为什么能同步**：massCode 没有内置云同步，但它的片段就是普通 `.md` 文件；放进 iCloud Drive 后，
  由 iCloud 负责跨设备同步文件。本工具和 massCode 的 vault 路径都指向 iCloud 里的同一份 `markdown-vault`，
  所以两端读写的是同一份数据。
- **修改文件后**：在 massCode 里能看到（它在监听 vault）；反之 massCode 里改的，本工具 2.5s 内自动刷新。

### 换一台 Mac 的步骤

1. 确保新 Mac 登录了**同一个 Apple ID 且开启 iCloud Drive**，等待 `iCloud Drive/massCode` 同步完成。
2. 安装依赖（工具本体随 iCloud 走，无需拷贝）：
   ```bash
   brew install node                 # 必须：跑工具 + JS/TS
   xcode-select --install            # 强烈建议：gcc/g++/clang-format/swift 全有了
   brew install go                   # Go 运行 + gofmt（可选）
   # 想跑哪种语言就装哪种运行时（Java/Ruby/Python-black 等，见「🔍 环境」面板提示）
   ```
3. 让 massCode 指向 iCloud 里的 vault：
   - 方法一（推荐）：打开新 Mac 的 `~/Library/Application Support/massCode/v2/preferences.json`，
     把 `storage.rootPath` 改成 iCloud 里的 `massCode` 路径，再启动 massCode；
   - 方法二：给工具设环境变量 `MASSCODE_VAULT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault"`。
4. 双击 `iCloud Drive/massCode/启动伴生工具.command` → 打开 http://127.0.0.1:4877 → 点「🔍 环境」检查缺什么。

> **注意**：iCloud 为省空间可能把个别文件标记为「仅云端」（文件名带 ☁ 图标）。工具运行前会按需下载，
> 一般无感；若某片段缺失，等它下载完即可。避免在**多台电脑同时编辑同一个片段**，以免 iCloud 版本冲突。

### 常见场景
- **只想片段同步**：只需把 `markdown-vault/` 放进 iCloud/云盘即可。
- **不用 iCloud 也行**：换用 Dropbox / Google Drive / Syncthing / Git 仓库做同步目录，原理一样。
- **Windows/Linux**：工具是纯 Node + 跨平台，同样可用；把 Homebrew 换成对应包管理器即可。

## 跨系统（Windows / Linux）

工具是**纯 Node + 浏览器**，逻辑上跨系统通用；已针对各平台做了适配与验证：

| 项 | 适配情况 |
|----|---------|
| **vault 自动定位** | ① 优先找工具目录上级的 `markdown-vault`（整个文件夹一起放云盘/本地时一定成立，**跨系统最稳**）；② 再读 massCode 各平台偏好设置（macOS/Win/Linux 路径均已内置）；③ 最后常用路径兜底。Windows 上无需手动配置也能找到 vault |
| **Python** | Windows 通常没有 `python3`，已自动回退用 `python` / `py`（运行、检查、black 均生效） |
| **超时终止** | Windows 没有 POSIX 进程组，已改用在任何系统都能杀掉超时子进程的方式 |
| **安装提示** | 「🔍 环境」面板按当前系统给出安装命令：macOS→brew，Windows→winget，Linux→自动识别 apt/dnf/yum/pacman/zypper/apk |
| **一键部署** | 扫描 vault 语言后只安装缺失依赖；部署过程进入交互终端，不隐藏权限申请和错误输出 |
| **一键启动** | macOS `.command` / Windows `.bat` / Linux、WSL `.sh`（前台运行、Ctrl+C 停止） |

### 各平台开箱即用 / 需安装

| 语言 | macOS | Windows | Linux |
|------|:--:|:--:|:--:|
| JS / TS | ✅ node | 装 Node.js 后 ✅ | 装 nodejs 后 ✅ |
| Python | ✅ python3 | `python`/`py` 自动识别 ✅ | ✅ python3 |
| Bash | ✅ 自带 | ⚠️ 默认无 bash，需 Git Bash 或 WSL | ✅ 自带 |
| C / C++ | ✅ xcode 工具链 | ⚠️ 需 MinGW-w64 或 VS C++ 工具 | ⚠️ 需 `apt install gcc g++` |
| Java / Ruby / Go | 装对应运行时 | 装对应运行时 | 装对应运行时 |
| Swift | ✅ xcode 工具链 | ⚠️ 仅实验性工具链 | ⚠️ swift.org 工具链 |

> 浏览器端（界面/大纲/高亮/标签/拖拽/编辑保存）无系统差异，Windows 上体验与 macOS 一致。
> 唯一小坑：在 Windows 里**用 CRLF 换行创建的 bash 片段**可能报 `$'\r'` 错误——用 LF 即可（工具解析、写回都兼容 CRLF）。

## 安全提示

本工具会在本机以你的权限执行片段代码。片段库通常是你自己的代码，风险可控；
但请勿在**共享/不信任的 vault** 上点击运行任意片段。

## 局限

- massCode 本身没有插件系统，所以这是「伴生工具」而非 app 内按钮；如需真正嵌进 app，需 fork 源码自行打包。
- 不拦截系统调用：`rm -rf` 之类会真实执行（这就是"运行"的意义，使用时请留意）。
- 本机没有的运行时（如 rustc/php/dotnet/perl）会提示不支持；装好后刷新环境面板即可。
