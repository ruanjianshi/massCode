#!/usr/bin/env node
/**
 * masscode-runner —— massCode 伴生工具
 * 读取 massCode 的 Markdown Vault，为代码片段提供 运行 / 语法检查 / 格式化。
 * 纯 Node 实现，无第三方依赖（格式化按需调用 npx prettier）。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile, execFileSync } = require('child_process');

const PORT = Number(process.env.MASSCODE_RUNNER_PORT || 4877);
const HOST = '127.0.0.1';

/* ---------------------------------- 路径发现 ---------------------------------- */

function defaultVaultPath() {
  // 0) 最通用：工具目录上一级的 markdown-vault（整个 massCode 文件夹一起放在云盘/本地时一定成立，跨系统通用）
  const relVault = path.join(__dirname, '..', 'markdown-vault');
  if (fs.existsSync(relVault)) return relVault;
  // 1) 从 massCode 偏好设置读取（各系统路径不同）
  const prefCands = [];
  if (process.platform === 'darwin') {
    prefCands.push(
      path.join(os.homedir(), 'Library/Application Support/massCode/v2/preferences.json'),
      path.join(os.homedir(), 'Library/Application Support/masscode/v2/preferences.json'));
  } else if (process.platform === 'win32') {
    const ap = process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming');
    prefCands.push(
      path.join(ap, 'massCode/v2/preferences.json'),
      path.join(ap, 'masscode/v2/preferences.json'));
  } else { // linux 等
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    prefCands.push(
      path.join(xdg, 'massCode/v2/preferences.json'),
      path.join(xdg, 'masscode/v2/preferences.json'));
  }
  for (const p of prefCands) {
    try {
      const pref = JSON.parse(fs.readFileSync(p, 'utf8'));
      const root = pref && pref.storage && pref.storage.rootPath;
      if (root) return path.join(root, 'markdown-vault');
    } catch (_) { /* ignore */ }
  }
  // 2) 常见默认位置兜底
  const defaults = [
    path.join(os.homedir(), 'Library/Mobile Documents/com~apple~CloudDocs/massCode/markdown-vault'),
    path.join(os.homedir(), 'massCode/markdown-vault'),
    path.join(os.homedir(), 'Documents/massCode/markdown-vault'),
  ];
  for (const p of defaults) if (fs.existsSync(p)) return p;
  return defaults[0];
}

function vaultPath() {
  const v = process.env.MASSCODE_VAULT;
  if (v) {
    if (!fs.existsSync(v)) throw new Error('MASSCODE_VAULT 指向的目录不存在: ' + v);
    return v;
  }
  return defaultVaultPath();
}

/* --------------------------------- 环境检测 ---------------------------------- */

// Windows 上通常没有 python3，只有 python / py；跨平台解析可用的 Python 命令
let _pyCmd = null;
function pythonCmd() {
  if (_pyCmd) return _pyCmd;
  const cands = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  for (const c of cands) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 5000 }); return _pyCmd = c; } catch (_) {}
  }
  return _pyCmd = cands[0];
}

const TOOLS = [
  { key: 'node',       probe: ['node', '--version'],            label: 'Node.js',              for: 'JS / TS 运行' },
  { key: 'python3',    probe: () => [pythonCmd(), '--version'], label: 'Python 3',             for: 'Python 运行/检查' },
  { key: 'bash',       probe: ['bash', '--version'],            label: 'Bash',                 for: 'Bash 运行/检查' },
  { key: 'gcc',        probe: ['gcc', '--version'],             label: 'GCC（C 编译）',         for: 'C 运行/检查' },
  { key: 'gpp',        probe: ['g++', '--version'],             label: 'G++（C++ 编译）',       for: 'C++ 运行/检查' },
  { key: 'java',       probe: ['java', '--version'],            label: 'Java',                 for: 'Java 运行/检查' },
  { key: 'ruby',       probe: ['ruby', '--version'],            label: 'Ruby',                 for: 'Ruby 运行/检查' },
  { key: 'swift',      probe: ['swift', '--version'],           label: 'Swift',                for: 'Swift 运行/检查' },
  { key: 'go',         probe: ['go', 'version'],                label: 'Go',                   for: 'Go 运行/检查' },
  { key: 'clangformat', probe: ['clang-format', '--version'],   label: 'clang-format',         for: 'C/C++ 格式化' },
  { key: 'gofmt',      probe: ['gofmt', '-h'],                  label: 'gofmt',                for: 'Go 格式化' },
  { key: 'black',      probe: () => [pythonCmd(), '-m', 'black', '--version'], label: 'black', for: 'Python 格式化' },
  { key: 'npx',        probe: ['npx', '--version'],             label: 'npx（Prettier）',       for: 'JS/TS/JSON/HTML 等格式化' },
];

let envCache = null;
async function detectEnv() {
  const results = await Promise.all(TOOLS.map((t) => new Promise((resolve) => {
    const cmd = typeof t.probe === 'function' ? t.probe() : t.probe;
    execFile(cmd[0], cmd.slice(1), { timeout: 15000 }, (err, stdout) => {
      resolve({
        key: t.key, label: t.label, for: t.for,
        available: !err,
        version: !err ? String(stdout || '').split('\n')[0].trim().slice(0, 60) : '',
      });
    });
  })));
  const map = {};
  for (const r of results) map[r.key] = r;
  return map;
}
async function getEnv(force) {
  if (force || !envCache) envCache = await detectEnv();
  return envCache;
}

// 给某工具缺失时的安装提示（按平台给不同命令）
function installHint(key) {
  const win = process.platform === 'win32';
  const lin = process.platform === 'linux';
  const mac = !win && !lin;
  const H = {
    node: mac ? 'brew install node' : win ? 'winget install OpenJS.NodeJS.LTS（或 nodejs.org 下载）' : 'apt install nodejs（或装 nvm）',
    python3: mac ? 'brew install python' : win ? 'winget install Python.Python.3.12（自带 python 命令）' : 'apt install python3',
    bash: mac ? '系统自带' : win ? '安装 Git Bash 或启用 WSL（Windows 默认无 bash）' : '系统自带',
    gcc: mac ? 'xcode-select --install' : win ? '安装 MinGW-w64 或 Visual Studio 的 C/C++ 工具' : 'apt install gcc',
    gpp: mac ? 'xcode-select --install' : win ? '安装 MinGW-w64 或 Visual Studio 的 C/C++ 工具' : 'apt install g++',
    java: mac ? 'brew install --cask temurin' : win ? 'winget install EclipseAdoptium.Temurin.21.JDK' : 'apt install default-jdk',
    ruby: mac ? 'brew install ruby' : win ? '安装 RubyInstaller（rubyinstaller.org）' : 'apt install ruby',
    swift: mac ? 'xcode-select --install' : win ? 'Swift 官方 Windows 工具链（实验性）' : 'swift.org 工具链',
    go: mac ? 'brew install go' : win ? 'winget install GoLang.Go' : 'apt install golang',
    clangformat: mac ? 'xcode-select --install 或 brew install clang-format' : win ? '安装 LLVM（releases.llvm.org）' : 'apt install clang-format',
    gofmt: mac ? 'brew install go（自带 gofmt）' : win ? '安装 Go（自带 gofmt）' : 'apt install golang（自带 gofmt）',
    black: mac ? 'pip3 install --user black' : win ? (pythonCmd() === 'py' ? 'py -m pip install black' : 'python -m pip install black') : 'pip3 install black',
    npx: mac ? 'brew install node（自带 npx）' : win ? '安装 Node.js（自带 npx）' : 'apt install nodejs（自带 npx）',
  };
  return H[key] || '请安装对应工具';
}

function missingReason(key) {
  const t = TOOLS.find((x) => x.key === key);
  return '本机缺少 ' + (t ? t.label : key) + '（用于 ' + (t ? t.for : '') + '）。安装: ' + installHint(key);
}

/* --------------------------------- frontmatter 解析 -------------------------------- */

function parseFrontmatter(text) {
  // 解析 massCode 片段 .md 的 frontmatter（YAML 子集），返回 { meta, body }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const yaml = m[1];
  const body = text.slice(m[0].length);
  const meta = {};
  const contents = [];
  let cur = null;      // 当前 contents 列表项
  let listKey = null;  // 正在收集的列表：'contents' | 'tags'
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const listItem = /^(\s*)-\s+(.+)$/.exec(line);
    if (listItem && listItem[1].length === 2) {
      if (listKey === 'tags') {
        const n = parseInt(listItem[2], 10);
        if (Number.isFinite(n)) meta.tags.push(n);
        continue;
      }
      cur = {};
      contents.push(cur);
      const kv = splitKV(listItem[2]);
      if (kv) cur[kv[0]] = kv[1];
      continue;
    }
    const itemField = /^\s{4,}(.+)$/.exec(line);
    if (itemField && cur) {
      const kv = splitKV(itemField[1]);
      if (kv) cur[kv[0]] = kv[1];
      continue;
    }
    const kv = splitKV(line);
    if (kv) {
      if (kv[0] === 'contents') { listKey = 'contents'; continue; }
      if (kv[0] === 'tags') { listKey = 'tags'; meta.tags = meta.tags || []; continue; }
      listKey = null;
      meta[kv[0]] = kv[1];
    }
  }
  if (contents.length) meta.contents = contents;
  if (!meta.tags) meta.tags = [];
  return { meta, body };
}

function splitKV(s) {
  const idx = s.indexOf(':');
  if (idx < 0) return null;
  const key = s.slice(0, idx).trim();
  let val = s.slice(idx + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return [key, val];
}

/* --------------------------------- 片段解析 ---------------------------------- */

// 每个片段推一个"文件名"：标签长得像文件名（如 main.cpp / calc.hpp）就直接用，
// 否则按语言给默认名（单文件 main.xxx，多文件 fileN.xxx）。
const EXT_FOR_LANG = {
  javascript: 'js', typescript: 'ts', python: 'py', bash: 'sh', shell: 'sh',
  c_cpp: 'cpp', c: 'c', java: 'java', ruby: 'rb', swift: 'swift', go: 'go',
  json: 'json', html: 'html', css: 'css', markdown: 'md', plain_text: 'txt',
  draw: 'draw', drawing: 'draw',
};
const KNOWN_EXT = /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|py|js|mjs|cjs|ts|sh|go|java|rb|swift|json|html|css|yml|yaml|md|txt|draw)$/i;
function computeFilename(label, language, index, total) {
  const lbl = (label || '').trim();
  if (lbl && KNOWN_EXT.test(lbl)) return lbl;
  const ext = EXT_FOR_LANG[(language || '').toLowerCase()] || 'txt';
  return total === 1 ? 'main.' + ext : 'file' + (index + 1) + '.' + ext;
}

function extractFragments(meta, body) {
  // 按 "## Fragment: xxx" 标题 + 后面的围栏代码块切分
  const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
  const fragments = [];
  const heads = [];
  let m;
  while ((m = headingRe.exec(body))) heads.push({ label: m[1].trim(), index: m.index });
  if (!heads.length) {
    // 没有 Fragment 标题：整段按 frontmatter 的 contents[0] 处理
    const first = (meta.contents || [])[0];
    const code = extractFirstFence(body);
    if (first || code) {
      const label = first && first.label ? first.label : '片段';
      const language = first && first.language ? first.language : 'plain_text';
      fragments.push({
        id: first ? String(first.id) : '0',
        label,
        language,
        filename: computeFilename(label, language, 0, 1),
        code: code || '',
      });
    }
    return fragments;
  }
  const total = heads.length;
  for (let i = 0; i < heads.length; i++) {
    const segStart = heads[i].index + body.slice(heads[i].index).indexOf('\n') + 1;
    const segEnd = i + 1 < heads.length ? heads[i + 1].index : body.length;
    const seg = body.slice(segStart, segEnd);
    const info = (meta.contents && meta.contents[i]) || {};
    const label = heads[i].label || (info.label || '片段 ' + (i + 1));
    const language = info.language || guessLanguage(heads[i].label) || 'plain_text';
    fragments.push({
      index: i,
      id: String(info.id != null ? info.id : i),
      label,
      language,
      filename: computeFilename(label, language, i, total),
      code: extractFirstFence(seg) || '',
    });
  }
  return fragments;
}

function extractFirstFence(seg) {
  // 片段 = 段内【第一个】``` 围栏（开）到【最后一个】``` 围栏（关）；
  // 必须取首↔末，不能用非贪婪匹配——markdown 片段内容自带围栏代码块时，非贪婪会在内层 ``` 处错误截断
  const lines = String(seg).split('\n');
  let first = -1, last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) { if (first < 0) first = i; last = i; }
  }
  if (first < 0 || last <= first) return '';
  return lines.slice(first + 1, last).join('\n').replace(/\n$/, '');
}

function guessLanguage(label) {
  const map = {
    'js': 'javascript', 'javascript': 'javascript', 'ts': 'typescript',
    'python': 'python', 'py': 'python', 'bash': 'bash', 'sh': 'bash',
    'c': 'c_cpp', 'cpp': 'c_cpp', 'c++': 'c_cpp', 'json': 'json',
    'html': 'html', 'css': 'css',
  };
  const k = label.toLowerCase();
  return map[k] || null;
}

/* 读取 massCode 标签注册表（id -> name），片段 frontmatter 里 tags 存的是 id */
function readTagRegistry() {
  try {
    const p = path.join(vaultPath(), 'code/.masscode/state.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = Array.isArray(d.tags) ? d.tags.map((t) => ({ id: t.id, name: t.name })) : [];
    const map = {};
    for (const t of list) map[String(t.id)] = t.name;
    return { map, list };
  } catch (_) { return { map: {}, list: [] }; }
}

/* 把 parseFrontmatter 的 {meta, body} 序列化回 massCode 格式 frontmatter + body */
function stringifyFrontmatter(fm) {
  const m = fm.meta || {};
  const lines = ['---'];
  if (Array.isArray(m.contents) && m.contents.length) {
    lines.push('contents:');
    for (const c of m.contents) {
      lines.push('  - id: ' + (c.id !== undefined ? c.id : ''));
      if (c.label !== undefined) lines.push('    label: ' + c.label);
      if (c.language !== undefined) lines.push('    language: ' + c.language);
    }
  }
  for (const k of ['createdAt', 'description', 'folderId', 'id', 'isDeleted', 'isFavorites', 'name', 'updatedAt']) {
    if (m[k] === undefined) continue;
    if (k === 'description') lines.push('description: ' + (m[k] ? JSON.stringify(m[k]) : '""'));
    else lines.push(k + ': ' + m[k]);
  }
  lines.push('tags:');
  for (const t of (Array.isArray(m.tags) ? m.tags : [])) lines.push('  - ' + t);
  return lines.join('\n') + '\n---\n' + (fm.body || '');
}

function walkSnippets() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const out = [];
  if (!fs.existsSync(codeRoot)) return out;
  const tagReg = readTagRegistry();
  const walk = (dir, folder) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.masscode') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, path.join(folder, e.name));
      else if (e.name.endsWith('.md')) {
        try {
          const text = fs.readFileSync(full, 'utf8');
          const { meta, body } = parseFrontmatter(text);
          if (meta.isDeleted === '1') continue;
          const tagIds = Array.isArray(meta.tags) ? meta.tags.map(Number).filter(Number.isFinite) : [];
          out.push({
            file: full,
            name: meta.name || path.basename(e.name, '.md'),
            description: (meta.description && meta.description !== 'null') ? meta.description : '',
            isFavorites: meta.isFavorites === '1',
            folder: folder.replace(/^\/+/, ''),
            updatedAt: Number(meta.updatedAt) || 0,
            tagIds,
            tags: tagIds.map((id) => tagReg.map[String(id)]).filter(Boolean),
            fragments: extractFragments(meta, body),
          });
        } catch (_) { /* skip unreadable */ }
      }
    }
  };
  walk(codeRoot, '');
  out.sort((a, b) => a.folder.localeCompare(b.folder) || b.updatedAt - a.updatedAt);
  return out;
}

// 完整文件夹结构（含空文件夹），用于前端目录树按真实结构渲染
function walkFolders() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const out = [];
  if (!fs.existsSync(codeRoot)) return out;
  const readMeta = (full) => {
    let name = path.basename(full), id = null, orderIndex = null;
    try {
      const m = fs.readFileSync(path.join(full, '.meta.yaml'), 'utf8');
      let mm = /^name:\s*(.+)$/m.exec(m); if (mm && mm[1].trim() !== '') name = mm[1].trim();
      mm = /^id:\s*(.+)$/m.exec(m); if (mm) id = String(mm[1]).trim();
      mm = /^orderIndex:\s*(.+)$/m.exec(m); if (mm) orderIndex = Number(mm[1]) || 0;
    } catch (_) {}
    return { name, id, orderIndex };
  };
  const walk = (dir, parentPath) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue; // 跳过 .masscode 等隐藏元数据目录
      const full = path.join(dir, e.name);
      const rel = parentPath ? parentPath + '/' + e.name : e.name;
      const meta = readMeta(full);
      out.push({ path: rel, name: meta.name, id: meta.id, orderIndex: meta.orderIndex, parent: parentPath || '' });
      walk(full, rel);
    }
  };
  walk(codeRoot, '');
  out.sort((a, b) => (a.parent === b.parent ? (a.orderIndex ?? 0) - (b.orderIndex ?? 0) || a.name.localeCompare(b.name, 'zh') : a.parent.localeCompare(b.parent)));
  return out;
}

/* massCode 元数据库 .masscode/state.json：新建/移动片段与文件夹时需要登记，保证 massCode 识别 */
function readState() {
  try {
    return JSON.parse(fs.readFileSync(path.join(vaultPath(), 'code', '.masscode', 'state.json'), 'utf8'));
  } catch (_) {
    return { version: 3, counters: { contentId: 1, folderId: 1, snippetId: 1, tagId: 1 }, folderIdByPath: {}, folderUi: {}, snippets: [], tags: [] };
  }
}
function writeState(st) {
  const p = path.join(vaultPath(), 'code', '.masscode', 'state.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(st, null, 2), 'utf8');
}

/* 按标签名解析为 id，不存在的自动新建（massCode 标签注册表） */
function syncTags(st, names) {
  const ids = [];
  const byName = new Map();
  for (const t of st.tags) byName.set(t.name, t.id);
  for (const raw of names || []) {
    const name = String(raw || '').trim();
    if (!name) continue;
    let id = byName.get(name);
    if (id === undefined) {
      id = ++st.counters.tagId;
      const now = Date.now();
      st.tags.push({ createdAt: now, id, name, updatedAt: now });
      byName.set(name, id);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/* 版本指纹：所有片段文件的 路径+mtime+大小 的哈希，用于前端实时同步检测。
   也纳入 state.json（标签/计数）与 .meta.yaml（文件夹元数据），保证新增/改名标签也能触发同步 */
function computeRev() {
  const vault = vaultPath();
  const codeRoot = path.join(vault, 'code');
  const parts = [];
  const addFile = (p) => {
    try {
      const st = fs.statSync(p);
      parts.push(p + ':' + st.mtimeMs + ':' + st.size);
    } catch (_) {}
  };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.masscode') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) addFile(full);
      else if (e.name === '.meta.yaml') addFile(full);
    }
  };
  walk(codeRoot);
  addFile(path.join(codeRoot, '.masscode/state.json'));
  const s = parts.sort().join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/* --------------------------------- 执行引擎 ---------------------------------- */

function run(interp, args, opts = {}) {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs || 10000;
    const cwd = opts.cwd;
    const child = spawn(interp, args, {
      cwd,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      // 超时终止：POSIX 用进程组(负 pid)，Windows 无进程组概念，退回 child.kill()
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, timedOut: true, stdout, stderr, code: null });
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    // 写入 stdin（无输入时也立即关闭，避免 `while(cin>>x)` 挂起）
    try {
      if (opts.input) child.stdin.write(opts.input);
    } catch (_) {}
    try { child.stdin.end(); } catch (_) {}
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err.message || err), stdout, stderr, code: null });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, stdout, stderr });
    });
  });
}

function writeTemp(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, content);
  return { dir, file: f };
}

// 把多个片段（含文件名）写入同一个临时目录，支持跨文件引用 / 一起编译
function writeFragments(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mscr-'));
  for (const f of files || []) {
    if (!f.filename) continue;
    fs.writeFileSync(path.join(dir, f.filename), f.code || '');
  }
  return dir;
}

/* 语言 -> 运行器 */
const LANGUAGE_MAP = {
  javascript: { ext: '.js', label: 'JavaScript' },
  typescript: { ext: '.ts', label: 'TypeScript' },
  python:     { ext: '.py', label: 'Python' },
  bash:       { ext: '.sh', label: 'Bash' },
  shell:      { ext: '.sh', label: 'Bash' },
  c_cpp:      { ext: '.cpp', label: 'C/C++' },
  c:          { ext: '.c', label: 'C' },
  java:       { ext: '.java', label: 'Java' },
  ruby:       { ext: '.rb', label: 'Ruby' },
  swift:      { ext: '.swift', label: 'Swift' },
  go:         { ext: '.go', label: 'Go' },
  json:       { ext: '.json', label: 'JSON' },
  html:       { ext: '.html', label: 'HTML' },
  markdown:   { ext: '.md', label: 'Markdown' },
};

// 环境守卫：缺工具时返回明确提示，而不是晦涩的 spawn 报错
async function guard(key, fn) {
  const env = await getEnv();
  if (!env[key] || !env[key].available) return { ok: false, unsupported: true, reason: missingReason(key) };
  return fn();
}

function runnerFor(language) {
  const key = (language || '').toLowerCase();
  switch (key) {
    case 'javascript':
      return {
        supported: true,
        check: (code) => guard('node', () => run('node', ['--check', writeTemp('check.js', code).file])),
        run: (code, opts) => guard('node', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.mjs', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('node', [entry], { cwd: dir, timeoutMs: 10000, input: opts.input });
        }),
      };
    case 'typescript':
      return {
        supported: true,
        check: (code) => guard('node', () => run('node', ['--check', writeTemp('check.ts', code).file])),
        run: (code, opts) => guard('node', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.ts', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('node', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'python':
      return {
        supported: true,
        check: (code) => guard('python3', () => run(pythonCmd(), ['-m', 'py_compile', writeTemp('check.py', code).file])),
        run: (code, opts) => guard('python3', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.py', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run(pythonCmd(), [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'bash':
    case 'shell':
      return {
        supported: true,
        check: (code) => guard('bash', () => run('bash', ['-n', writeTemp('check.sh', code).file])),
        run: (code, opts) => guard('bash', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.sh', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('bash', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'c_cpp':
      return {
        supported: true,
        // 按文件扩展名决定 C/C++：.c → gcc(C17)，其余 → g++(C++17)，避免 clang++ 的 "treating 'c' input as 'c++'" 告警
        check: (code, opts) => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'check.cpp', code }];
          const dir = writeFragments(files);
          const sel = files[(opts.selIndex || 0)] || files[0];
          const entry = path.join(dir, sel.filename);
          const isC = /\.c$/i.test(sel.filename);
          return guard(isC ? 'gcc' : 'gpp', () => run(isC ? 'gcc' : 'g++', [isC ? '-std=c17' : '-std=c++17', '-I', dir, '-fsyntax-only', entry], { timeoutMs: 30000 }));
        },
        run: (code, opts) => guard('gpp', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.cpp', code }];
          const dir = writeFragments(files);
          const srcs = files.filter((f) => /\.(c|cc|cpp|cxx)$/i.test(f.filename)).map((f) => f.filename);
          if (!srcs.length) return { ok: false, code: 1, stdout: '', stderr: '没有可编译的 C/C++ 源文件' };
          const bin = path.join(dir, 'a.out');
          // 逐个 .c 用 gcc(C)、.cpp 用 g++(C++) 编译成 .o，再统一链接
          const steps = srcs.map((fn) => {
            const isC = /\.c$/i.test(fn);
            const tool = isC ? 'gcc' : 'g++';
            const std = isC ? '-std=c17' : '-std=c++17';
            return guard(isC ? 'gcc' : 'gpp', () => run(tool, [std, '-I', dir, '-c', path.join(dir, fn), '-o', path.join(dir, fn + '.o')], { timeoutMs: 40000 }));
          });
          return Promise.all(steps).then((results) => {
            const bad = results.find((r) => !r.ok);
            if (bad) return bad;
            const objs = srcs.map((fn) => path.join(dir, fn + '.o'));
            return run('g++', ['-I', dir, ...objs, '-o', bin], { timeoutMs: 40000 })
              .then((r) => r.ok ? run(bin, [], { cwd: dir, timeoutMs: 15000, input: opts.input }) : r);
          });
        }),
      };
    case 'c':
      return {
        supported: true,
        check: (code, opts) => guard('gcc', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'check.c', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('gcc', ['-std=c17', '-I', dir, '-fsyntax-only', entry], { timeoutMs: 30000 });
        }),
        run: (code, opts) => guard('gcc', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.c', code }];
          const dir = writeFragments(files);
          const srcs = files.filter((f) => /\.c$/i.test(f.filename)).map((f) => path.join(dir, f.filename));
          const bin = path.join(dir, 'a.out');
          const gargs = ['-std=c17', '-I', dir, ...srcs, '-o', bin];
          return run('gcc', gargs, { timeoutMs: 40000 })
            .then((r) => r.ok ? run(bin, [], { cwd: dir, timeoutMs: 15000, input: opts.input }) : r);
        }),
      };
    case 'java': {
      const javaFile = (code, name) => {
        const m = /(?:public\s+)?(?:final\s+)?class\s+(\w+)/.exec(code);
        return writeTemp((m ? m[1] : name) + '.java', code);
      };
      return {
        supported: true,
        check: (code) => guard('java', () => {
          const { dir, file } = javaFile(code, 'Check');
          return run('javac', ['-d', dir, file], { timeoutMs: 30000 });
        }),
        run: (code, input) => guard('java', () => {
          const { file } = javaFile(code, 'Main');
          return run('java', [file], { timeoutMs: 20000, input }); // Java 11+ 单文件源码运行
        }),
      };
    }
    case 'ruby':
      return {
        supported: true,
        check: (code) => guard('ruby', () => run('ruby', ['-c', writeTemp('check.rb', code).file])),
        run: (code, opts) => guard('ruby', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.rb', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('ruby', [entry], { cwd: dir, timeoutMs: 15000, input: opts.input });
        }),
      };
    case 'swift':
      return {
        supported: true,
        check: (code) => guard('swift', () => run('swiftc', ['-typecheck', writeTemp('check.swift', code).file], { timeoutMs: 40000 })),
        run: (code, opts) => guard('swift', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.swift', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('swift', [entry], { cwd: dir, timeoutMs: 30000, input: opts.input });
        }),
      };
    case 'go':
      return {
        supported: true,
        check: (code) => guard('go', () => {
          const { dir, file } = writeTemp('main.go', code);
          return run('go', ['vet', file], { timeoutMs: 30000 }).then((r) => ({ ...r, ok: r.code === 0 }));
        }),
        run: (code, opts) => guard('go', () => {
          const files = (opts.files && opts.files.length) ? opts.files : [{ filename: 'main.go', code }];
          const dir = writeFragments(files);
          const entry = path.join(dir, files[(opts.selIndex || 0)].filename);
          return run('go', ['run', entry], { cwd: dir, timeoutMs: 30000, input: opts.input });
        }),
      };
    case 'json': {
      return {
        supported: true,
        check: (code) => {
          try { JSON.parse(code); return Promise.resolve({ ok: true, stdout: 'JSON 有效', stderr: '', code: 0 }); }
          catch (e) { return Promise.resolve({ ok: false, stdout: '', stderr: 'JSON 解析错误: ' + e.message, code: 1 }); }
        },
        run: (code) => Promise.resolve({ ok: true, stdout: 'JSON 无需运行（可用右侧“格式化/校验”查看结构）', stderr: '', code: 0 }),
      };
    }
    case 'html': {
      return {
        supported: true,
        check: (code) => Promise.resolve({ ok: true, stdout: 'HTML 使用“预览”在浏览器中渲染', stderr: '', code: 0 }),
        run: (code) => Promise.resolve({ ok: true, stdout: 'HTML 已生成预览，请点击下方“预览”按钮。', stderr: '', code: 0 }),
      };
    }
    default:
      return { supported: false, reason: '暂不支持运行 "' + (language || '未知') + '"（可运行: JavaScript / TypeScript / Python / Bash / C / C++ / Java / Ruby / Swift / Go / JSON / HTML）' };
  }
}

/* --------------------------------- 格式化 ---------------------------------- */

/* 各语言对应的格式化工具：
   - Prettier：通过 npx 按需下载（JS/TS/JSON/HTML/CSS/YAML/Markdown/Bash）
   - clang-format：C/C++（本机自带，无需下载）
   - gofmt：Go（本机自带） */
const FORMATTERS = {
  javascript:  { name: 'Prettier', key: 'npx', prettier: 'babel' },
  typescript:  { name: 'Prettier', key: 'npx', prettier: 'typescript' },
  json:        { name: 'Prettier', key: 'npx', prettier: 'json' },
  json5:       { name: 'Prettier', key: 'npx', prettier: 'json5' },
  html:        { name: 'Prettier', key: 'npx', prettier: 'html' },
  css:         { name: 'Prettier', key: 'npx', prettier: 'css' },
  scss:        { name: 'Prettier', key: 'npx', prettier: 'scss' },
  less:        { name: 'Prettier', key: 'npx', prettier: 'less' },
  yaml:        { name: 'Prettier', key: 'npx', prettier: 'yaml' },
  markdown:    { name: 'Prettier', key: 'npx', prettier: 'markdown' },
  bash:        { name: 'Prettier', key: 'npx', prettier: 'bash' },
  shell:       { name: 'Prettier', key: 'npx', prettier: 'bash' },
  c_cpp:       { name: 'clang-format', key: 'clangformat', format: formatWithClangFormat },
  c:           { name: 'clang-format', key: 'clangformat', format: formatWithClangFormat },
  go:          { name: 'gofmt', key: 'gofmt', format: formatWithGofmt },
  python:      { name: 'black', key: 'black', format: formatWithBlack },
};

function formatWithClangFormat(code) {
  // 空样式 + 缩进 2，避免依赖用户机器上可能不存在的 .clang-format
  const { dir, file } = writeTemp('format.cpp', code);
  return new Promise((resolve) => {
    const args = ['-style={BasedOnStyle: LLVM, IndentWidth: 2, TabWidth: 2, UseTab: Never, ColumnLimit: 100}', file];
    execFile('clang-format', args, { timeout: 20000 }, (err, stdout, stderr) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err) resolve({ ok: false, reason: 'clang-format 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted: stdout });
    });
  });
}

function formatWithGofmt(code) {
  const { dir, file } = writeTemp('format.go', code);
  return new Promise((resolve) => {
    execFile('gofmt', [file], { timeout: 20000 }, (err, stdout, stderr) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err) resolve({ ok: false, reason: 'gofmt 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted: stdout });
    });
  });
}

function formatWithBlack(code) {
  // black 就地改写文件；--line-length 100 减少意外换行
  const { dir, file } = writeTemp('format.py', code);
  return new Promise((resolve) => {
    execFile('python3', ['-m', 'black', '--quiet', '--line-length', '100', file], { timeout: 30000 }, (err, stdout, stderr) => {
      let formatted;
      if (!err) { try { formatted = fs.readFileSync(file, 'utf8'); } catch (_) { formatted = null; } }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      if (err || formatted == null) resolve({ ok: false, reason: 'black 失败: ' + (stderr || err.message).slice(0, 500) });
      else resolve({ ok: true, formatted });
    });
  });
}

function prettierArgs(parser, tmpFile) {
  // 与 massCode 编辑器偏好保持一致
  let tabWidth = 2, semi = false, singleQuote = false, trailing = 'all';
  try {
    const pref = JSON.parse(fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/massCode/v2/preferences.json'), 'utf8'));
    const e = pref.editor && pref.editor.code;
    if (e) { tabWidth = e.tabSize ?? 2; semi = e.semi ?? false; singleQuote = e.singleQuote ?? false; trailing = e.trailingComma ?? 'all'; }
  } catch (_) {}
  return ['--write', '--parser', parser, '--tab-width', String(tabWidth),
    semi ? '--semi' : '--no-semi', singleQuote ? '--single-quote' : '--no-single-quote',
    '--trailing-comma', trailing, tmpFile];
}

function formatWithPrettier(parser, code) {
  const ext = { babel: '.js', typescript: '.ts', json: '.json', json5: '.json5', html: '.html', css: '.css', scss: '.scss', less: '.less', yaml: '.yaml', markdown: '.md', bash: '.sh' }[parser] || '.txt';
  const { dir, file } = writeTemp('format' + ext, code);
  return new Promise((resolve) => {
    execFile('npx', ['-y', 'prettier@3', ...prettierArgs(parser, file)], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, reason: 'Prettier 执行失败（需要网络首次下载）: ' + (stderr || err.message).slice(0, 500) });
        return;
      }
      try { resolve({ ok: true, formatted: fs.readFileSync(file, 'utf8') }); }
      catch (e) { resolve({ ok: false, reason: String(e.message) }); }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    });
  });
}

/* 把格式化结果写回 vault 文件中对应片段 */
function writeBackFragment(file, fragment, newCode) {
  const text = fs.readFileSync(file, 'utf8');
  const { body } = parseFrontmatter(text);
  const bodyOffset = text.length - body.length; // body 在 text 中的绝对起点
  // 定位该片段对应的 fence
  const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
  const heads = [];
  let m;
  while ((m = headingRe.exec(body))) heads.push({ label: m[1].trim(), start: m.index });
  const target = heads[fragment.index];
  if (!target) return false;
  const segStart = target.start + body.slice(target.start).indexOf('\n') + 1;
  const segEnd = heads[fragment.index + 1] ? heads[fragment.index + 1].start : body.length;
  const seg = body.slice(segStart, segEnd);
  // 定位片段自己的围栏：段内【第一个】```（开）到【最后一个】```（关）。
  // 不能用非贪婪匹配：markdown 片段内容自带围栏代码块时会在内层 ``` 处截断，把片段后半截全删掉
  const segLines = seg.split('\n');
  let firstIdx = -1, lastIdx = -1;
  for (let i = 0; i < segLines.length; i++) {
    if (/^```/.test(segLines[i])) { if (firstIdx < 0) firstIdx = i; lastIdx = i; }
  }
  if (firstIdx < 0 || lastIdx <= firstIdx) return false;
  let pos = 0;
  const lineOffsets = [];
  for (const ln of segLines) { lineOffsets.push(pos); pos += ln.length + 1; } // +1 换行
  const openLine = segLines[firstIdx];
  const absStart = bodyOffset + segStart + lineOffsets[firstIdx];
  const absEnd = bodyOffset + segStart + lineOffsets[lastIdx] + segLines[lastIdx].length;
  const replacement = openLine + '\n' + newCode + '\n' + segLines[lastIdx];
  fs.writeFileSync(file, text.slice(0, absStart) + replacement + text.slice(absEnd), 'utf8');
  return true;
}

/* 重排片段顺序：同时重排 frontmatter 的 contents 列表与 body 的 ## Fragment 段。
   order = 新顺序（原索引的排列，如 [2,0,1] 表示原第 2/0/1 段依次放到最前）。
   按原始文本切片重排，不改任何片段内容与格式。 */
function reorderFragments(file, order) {
  const text = fs.readFileSync(file, 'utf8');
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m = fmRe.exec(text);
  if (!m) return { ok: false, error: '文件缺少 frontmatter' };
  const yamlRaw = m[1];
  const body = text.slice(m[0].length);
  const nl = yamlRaw.includes('\r\n') ? '\r\n' : '\n';
  const yamlLines = yamlRaw.split(/\r?\n/);

  // 1) 定位 contents 列表项的原始行块（2空格 "- " 项 + 4空格字段）
  const ci = yamlLines.findIndex((l) => /^contents:\s*$/.test(l));
  if (ci < 0) return { ok: false, error: 'frontmatter 缺少 contents' };
  const items = [];
  let cur = null;
  for (let i = ci + 1; i < yamlLines.length; i++) {
    const l = yamlLines[i];
    if (/^ {2}- /.test(l)) {
      if (cur) cur.end = i - 1;
      cur = { start: i, end: i };
      items.push(cur);
    } else if (/^ {4}/.test(l) && cur) {
      cur.end = i;
    } else if (cur && /^\s*$/.test(l)) {
      continue;
    } else if (cur && !/^\s/.test(l)) {
      break;
    } else if (cur) {
      cur.end = i;
    }
  }
  if (items.length === 0) return { ok: false, error: 'contents 为空，无法重排' };

  // 2) 定位 body 的 Fragment 段
  const heads = [];
  const hre = /^##\s*Fragment:\s*(.*)$/gm;
  let mm;
  while ((mm = hre.exec(body))) heads.push({ label: mm[1].trim(), start: mm.index });
  if (heads.length !== items.length) return { ok: false, error: 'contents 与 ## Fragment 段数量不一致，已取消重排' };

  // 3) 校验 order 是 0..n-1 的排列
  const n = items.length;
  if (!Array.isArray(order) || order.length !== n) return { ok: false, error: 'order 长度不符' };
  const seen = new Set();
  for (const o of order) {
    if (!Number.isInteger(o) || o < 0 || o >= n || seen.has(o)) return { ok: false, error: 'order 非法' };
    seen.add(o);
  }
  if (n === 1) return { ok: true };

  // 4) 重排 body 段（原始切片，完整保留）
  const segs = heads.map((h, i) => {
    const segStart = h.start + body.slice(h.start).indexOf('\n') + 1;
    const segEnd = i + 1 < heads.length ? heads[i + 1].start : body.length;
    return body.slice(segStart, segEnd);
  });
  const bodyHead = body.slice(0, heads[0].start);
  const newBody = bodyHead + order.map((oi) => '## Fragment: ' + heads[oi].label + '\n' + segs[oi]).join('');

  // 5) 重排 contents 原始行块
  const itemBlocks = items.map((it) => yamlLines.slice(it.start, it.end + 1));
  const before = yamlLines.slice(0, items[0].start);
  const after = yamlLines.slice(items[items.length - 1].end + 1);
  const newYaml = [].concat(before, order.map((oi) => itemBlocks[oi]).flat(), after).join(nl);

  // 6) 组装写回
  const out = '---' + nl + newYaml + nl + '---' + nl + newBody;
  fs.writeFileSync(file, out, 'utf8');
  return { ok: true };
}

/* --------------------------------- Git 面板 ---------------------------------- */

/* ------------------------------- 底部终端（PTY）------------------------------- */

let TERM = null;   // 当前终端会话 { child, res }
function termSpawn() {
  try {
    const shell = process.env.SHELL || '/bin/bash';
    // ptybridge.py 用 python3 pty.fork 分配真实伪终端，双向转发 stdin/stdout
    const bridge = path.join(__dirname, 'ptybridge.py');
    const child = spawn('python3', ['-u', bridge], { env: { ...process.env, SHELL: shell } });
    TERM = { child, res: null };
    child.stdout.on('data', (d) => { if (TERM && TERM.res) { try { TERM.res.write(d); } catch (_) {} } });
    child.stderr.on('data', (d) => { if (TERM && TERM.res) { try { TERM.res.write(d); } catch (_) {} } });
    child.on('error', () => { TERM = null; });
    child.on('exit', () => {
      const r = TERM && TERM.res;
      TERM = null;
      if (r) { try { r.end(); } catch (_) {} }
    });
    return true;
  } catch (e) {
    TERM = null;
    return false;
  }
}

/* --------------------------------- Git 面板 ---------------------------------- */

let GIT_ROOT = null;   // 缓存仓库根（vault 所在 git 仓库，通常在其上级目录）
function gitRoot() {
  if (GIT_ROOT) return GIT_ROOT;
  try {
    const out = execFileSync('git', ['-C', vaultPath(), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 10000 }).trim();
    return (GIT_ROOT = out) || null;
  } catch (_) { return null; }
}
function gitRun(args, timeout) {
  const root = gitRoot();
  if (!root) return Promise.resolve({ ok: false, error: '未找到 Git 仓库（vault 上级无 .git）' });
  return new Promise((resolve) => {
    execFile('git', args, { cwd: root, timeout: timeout || 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(stderr || err.message).trim().slice(0, 600) : '' });
    });
  });
}
function gitStatus() {
  const root = gitRoot();
  if (!root) return { ok: false, error: '未找到 Git 仓库（vault 上级无 .git）' };
  try {
    // -z + core.quotepath=false：路径按 UTF-8 原样输出、NUL 分隔，避免中文被转义
    const out = execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-b', '-z'], { cwd: root, encoding: 'utf8', timeout: 15000 });
    const recs = out.split('\0').filter(Boolean);
    const changes = [];
    let branch = '', ahead = 0, behind = 0;
    for (const r of recs) {
      if (r.startsWith('## ')) {
        const m = /^##\s+([^\s]+)(?:\s+\[(.*)\])?/.exec(r);
        branch = m ? m[1].split('...')[0] : '';
        const br = (m && m[2]) || '';
        const am = /ahead (\d+)/.exec(br); if (am) ahead = +am[1];
        const bm = /behind (\d+)/.exec(br); if (bm) behind = +bm[1];
        continue;
      }
      if (r.length < 3) continue;
      const xy = r.slice(0, 2);
      const path = r.slice(3);
      let kind = 'modified';
      if (xy === '??') kind = 'untracked';
      else if (xy[0] === 'A') kind = 'added';
      else if (xy[1] === 'D' || xy[0] === 'D') kind = 'deleted';
      else if (xy[0] === 'R') kind = 'renamed';
      changes.push({ status: xy.trim() || '?', idx: xy[0], wt: xy[1], path, kind });
    }
    let lastCommit = null;
    let commits = [];
    try {
      const lg = execFileSync('git', ['log', '-1', '--format=%h%x09%s'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
      const sp = lg.indexOf('\t');
      lastCommit = sp >= 0 ? { hash: lg.slice(0, sp), subject: lg.slice(sp + 1) } : { hash: lg };
    } catch (_) {}
    try {
      // 最近 10 条提交记录：短hash|主题|时间戳
      const lout = execFileSync('git', ['log', '--pretty=format:%h|%s|%at', '-n', '10'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim();
      if (lout) commits = lout.split('\n').map(line => {
        const p = line.split('|');
        return { short: p[0] || '', subject: p[1] || '', ts: +(p[2] || 0) };
      });
    } catch (_) {}
    return { ok: true, root, branch, ahead, behind, changes, lastCommit, commits };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/* --------------------------------- HTTP 服务 ---------------------------------- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };

function send(res, code, obj) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': typeof obj === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + HOST + ':' + PORT);
  try {
    if (req.method === 'GET' && u.pathname === '/') {
      const f = path.join(__dirname, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fs.readFileSync(f));
      return;
    }
    if (req.method === 'GET' && u.pathname.startsWith('/assets/')) {
      const assetsRoot = path.join(__dirname, 'assets');
      const rel = u.pathname.slice('/assets/'.length);
      const p = path.resolve(assetsRoot, rel);
      if (!p.startsWith(assetsRoot + path.sep) && p !== assetsRoot) return send(res, 403, { ok: false, error: 'forbidden' });
      try {
        const data = fs.readFileSync(p);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch (_) { send(res, 404, { ok: false, error: 'not found' }); }
      return;
    }
    if (req.method === 'GET' && u.pathname.startsWith('/vendor/')) {
      const assetsRoot = path.join(__dirname, 'vendor');
      const rel = u.pathname.slice('/vendor/'.length);
      const p = path.resolve(assetsRoot, rel);
      if (!p.startsWith(assetsRoot + path.sep) && p !== assetsRoot) return send(res, 403, { ok: false, error: 'forbidden' });
      try {
        const data = fs.readFileSync(p);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
      } catch (_) { send(res, 404, { ok: false, error: 'not found' }); }
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/snippets') {
      send(res, 200, { vault: vaultPath(), rev: computeRev(), tags: readTagRegistry().list, folders: walkFolders(), snippets: walkSnippets() });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/rev') {
      send(res, 200, { rev: computeRev() });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/env') {
      const force = u.searchParams.get('refresh') === '1';
      const env = await getEnv(force);
      const missing = Object.values(env).filter((e) => !e.available).length;
      const total = Object.keys(env).length;
      for (const e of Object.values(env)) e.hint = installHint(e.key); // 按当前平台给安装提示
      send(res, 200, {
        env,
        summary: { total, missing, ready: total - missing, ok: missing === 0 },
        vault: (() => { try { return vaultPath(); } catch (e) { return String(e.message); } })(),
        platform: process.platform + ' ' + process.arch,
      });
      return;
    }
    if (req.method === 'POST' && u.pathname === '/api/run') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      const runner = runnerFor(frag.language);
      if (!runner.supported) return send(res, 200, { ok: false, unsupported: true, reason: runner.reason });
      // 编辑模式：用前端传来的 code 覆盖磁盘内容（无需先保存）
      const code = b.code != null ? b.code : frag.code;
      const files = snip.fragments.map((f, i) => ({ filename: f.filename, code: (i === b.fragment && b.code != null) ? b.code : f.code }));
      const r = await runner.run(code, {
        input: b.input || '',
        selIndex: b.fragment,
        files,
      });
      return send(res, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && u.pathname === '/api/check') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
      const frag = snip.fragments[b.fragment];
      const runner = runnerFor(frag.language);
      if (!runner.supported) return send(res, 200, { ok: false, unsupported: true, reason: runner.reason });
      const code = b.code != null ? b.code : frag.code;
      const files = snip.fragments.map((f, i) => ({ filename: f.filename, code: (i === b.fragment && b.code != null) ? b.code : f.code }));
      const r = await runner.check(code, {
        selIndex: b.fragment,
        files,
      });
      return send(res, 200, { ok: true, ...r });
    }
    if (req.method === 'POST' && u.pathname === '/api/format') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在' });
      const frag = snip.fragments[b.fragment];
      const fspec = FORMATTERS[(frag.language || '').toLowerCase()];
      if (!fspec) {
        const supported = Object.keys(FORMATTERS).join(' / ');
        return send(res, 200, { ok: false, reason: '该语言暂不支持格式化：' + frag.language + '（支持: ' + supported + '）' });
      }
      const env = await getEnv();
      if (!env[fspec.key] || !env[fspec.key].available) {
        return send(res, 200, { ok: false, formatter: fspec.name, reason: missingReason(fspec.key) });
      }
      const code = b.code != null ? b.code : frag.code;
      const fr = fspec.format ? await fspec.format(code) : await formatWithPrettier(fspec.prettier, code);
      if (!fr.ok) return send(res, 200, { ok: false, formatter: fspec.name, reason: fr.reason });
      // 编辑模式（writeBack:false）：只返回格式化结果，由前端更新编辑框，不写盘
      if (b.writeBack === false) {
        return send(res, 200, { ok: true, formatter: fspec.name, formatted: fr.formatted, written: false, message: '已格式化（编辑模式，自动保存会立即写回 vault）' });
      }
      const written = writeBackFragment(b.file, frag, fr.formatted.replace(/\n+$/, ''));
      return send(res, 200, {
        ok: true, formatter: fspec.name, formatted: fr.formatted, written,
        message: written
          ? '已用 ' + fspec.name + ' 格式化并写回 vault（massCode 会实时同步）'
          : fspec.name + ' 格式化完成（未能自动写回，请手动复制）',
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/save') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const frag = snip.fragments[b.fragment];
      if (!frag) return send(res, 400, { ok: false, error: '片段索引无效' });
      if (typeof b.code !== 'string') return send(res, 400, { ok: false, error: '缺少 code' });
      const written = writeBackFragment(b.file, frag, b.code.replace(/\n+$/, ''));
      return send(res, 200, { ok: written, written, message: written ? '已保存到 vault（massCode 会实时同步）' : '保存失败：未能定位片段代码块' });
    }
    if (req.method === 'POST' && u.pathname === '/api/reorder') {
      const b = await readBody(req);
      const snips = walkSnippets();
      const snip = snips.find((s) => s.file === b.file);
      if (!snip) return send(res, 404, { ok: false, error: '片段不存在（vault 可能已变动）' });
      const r = reorderFragments(b.file, b.order);
      return send(res, 200, { ok: r.ok, error: r.error, message: r.ok ? '片段顺序已调整（massCode 会实时同步）' : undefined });
    }
    /* ------------------------------ 文件系统：新建/移动 ------------------------------ */
    if (req.method === 'POST' && u.pathname === '/api/fs/mkdir') {
      const b = await readBody(req);
      const rel = String(b.path || '').replace(/^\/+|\/+$/g, '');
      if (!rel || rel.split('/').some((seg) => !seg || seg === '.' || seg === '..')) return send(res, 200, { ok: false, error: '文件夹路径不合法' });
      const defaultLanguage = String(b.defaultLanguage || 'plain_text').trim() || 'plain_text';
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = path.join(codeRoot, rel);
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      if (fs.existsSync(dir)) return send(res, 200, { ok: false, error: '文件夹已存在' });
      fs.mkdirSync(dir, { recursive: true });
      const st = readState();
      const now = Date.now();
      // 每层新建目录都写 .meta.yaml 并注册（父层级联创建时也必须有元数据，否则 id 为 null）
      const segs = rel.split('/');
      for (let i = 0; i < segs.length; i++) {
        const subRel = segs.slice(0, i + 1).join('/');
        const metaPath = path.join(codeRoot, subRel, '.meta.yaml');
        if (fs.existsSync(metaPath)) continue;   // 已有元数据的层跳过（保留原 orderIndex 等）
        let fid = st.folderIdByPath[subRel];
        if (!fid) {
          fid = ++st.counters.folderId;
          st.folderIdByPath[subRel] = fid;
          st.folderUi[fid] = { isOpen: 1 };
        }
        fs.writeFileSync(metaPath,
          `id: ${fid}\ncreatedAt: ${now}\ndefaultLanguage: ${i === segs.length - 1 ? defaultLanguage : 'plain_text'}\nicon: null\nname: ${segs[i]}\norderIndex: 0\nupdatedAt: ${now}\n`, 'utf8');
      }
      writeState(st);
      return send(res, 200, { ok: true, folder: rel, id: st.folderIdByPath[rel] });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/newfile') {
      const b = await readBody(req);
      const folder = String(b.folder || '').replace(/^\/+|\/+$/g, '');
      const name = String(b.name || '').trim().replace(/\.md$/i, '').replace(/[:]/g, '：');   // 冒号会破坏 frontmatter
      if (!name || name.includes('/') || name.includes('\\')) return send(res, 200, { ok: false, error: '文件名不合法' });
      const language = String(b.language || 'plain_text').trim() || 'plain_text';
      const description = (b.description === undefined || b.description === null) ? '' : String(b.description).trim();
      const tagNames = Array.isArray(b.tags) ? b.tags.map(String) : [];
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = folder ? path.join(codeRoot, folder) : codeRoot;
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      fs.mkdirSync(dir, { recursive: true });
      const full = path.join(dir, name + '.md');
      if (fs.existsSync(full)) return send(res, 200, { ok: false, error: '文件已存在' });
      const st = readState();
      let fid = st.folderIdByPath[folder] || 0;
      if (folder && !fid) {
        fid = ++st.counters.folderId;
        st.folderIdByPath[folder] = fid;
        st.folderUi[fid] = { isOpen: 1 };
      }
      const tagIds = syncTags(st, tagNames);
      const sid = ++st.counters.snippetId;
      const cid = ++st.counters.contentId;
      const now = Date.now();
      const filePath = folder ? folder + '/' + name + '.md' : name + '.md';
      const md = '---\n' +
        'contents:\n' +
        '  - id: ' + cid + '\n' +
        '    label: ' + name + '\n' +
        '    language: ' + language + '\n' +
        'createdAt: ' + now + '\n' +
        'description: ' + (description ? JSON.stringify(description) : '""') + '\n' +
        'folderId: ' + (fid || 0) + '\n' +
        'id: ' + sid + '\n' +
        'isDeleted: 0\n' +
        'isFavorites: 0\n' +
        'name: ' + name + '\n' +
        (tagIds.length ? 'tags:\n' + tagIds.map((t) => '  - ' + t).join('\n') + '\n' : 'tags:\n') +
        'updatedAt: ' + now + '\n' +
        '---\n' +
        '\n## Fragment: ' + name + '\n' +
        '```' + language + '\n' +
        '\n```\n';
      fs.writeFileSync(full, md, 'utf8');
      st.snippets.push({
        filePath, id: sid,
        meta: {
          contents: [{ id: cid, label: name, language }],
          createdAt: now, description: description || null, folderId: fid || 0, isDeleted: 0, isFavorites: 0,
          mtimeMs: now, name, size: Buffer.byteLength(md), tags: tagIds, updatedAt: now,
        },
      });
      writeState(st);
      return send(res, 200, { ok: true, file: full, snippetId: sid, folder, tags: tagIds, language });
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/move') {
      const b = await readBody(req);
      const file = String(b.file || '');
      const toFolder = String(b.toFolder || '').replace(/^\/+|\/+$/g, '');
      if (!file || toFolder.split('/').some((seg) => seg === '.' || seg === '..')) return send(res, 200, { ok: false, error: '参数不合法' });
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(file));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      const destDir = toFolder ? path.join(codeRoot, toFolder) : codeRoot;
      if (destDir !== codeRoot && !destDir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const fname = path.basename(snip.filePath);
      const destFull = path.join(destDir, fname);
      if (path.resolve(file) === path.resolve(destFull)) return send(res, 200, { ok: true, file, folder: toFolder }); // 没动
      if (fs.existsSync(destFull)) return send(res, 200, { ok: false, error: '目标位置已存在同名文件' });
      fs.mkdirSync(destDir, { recursive: true });
      try { fs.renameSync(file, destFull); } catch (e) { return send(res, 200, { ok: false, error: '移动失败: ' + e.message }); }
      let fid = st.folderIdByPath[toFolder] || 0;
      if (toFolder && !fid) {
        fid = ++st.counters.folderId;
        st.folderIdByPath[toFolder] = fid;
        st.folderUi[fid] = { isOpen: 1 };
      }
      snip.filePath = toFolder ? toFolder + '/' + fname : fname;
      snip.meta.folderId = fid || 0;
      writeState(st);
      // 同步 .md frontmatter 的 folderId
      try {
        const text = fs.readFileSync(destFull, 'utf8');
        const updated = text.replace(/^folderId:\s*.*$/m, 'folderId: ' + (fid || 0));
        if (updated !== text) fs.writeFileSync(destFull, updated, 'utf8');
      } catch (_) {}
      return send(res, 200, { ok: true, file: destFull, folder: toFolder });
    }
    // 编辑片段信息：名称/类型(语言)/标签/说明（fragmentId 指定要改语言的分片，默认第一个）
    if (req.method === 'POST' && u.pathname === '/api/fs/update') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(String(b.file || '')));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      let full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      let text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents) || !fm.meta.contents.length) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const fragId = Number(b.fragmentId);
      const tgt = (fm.meta.contents.find((c) => String(c.id) === String(fragId)) || fm.meta.contents[0]);
      const folderPath = path.dirname(snip.filePath) === '.' ? '' : path.dirname(snip.filePath).split(path.sep).join('/');
      const now = Date.now();
      // 名称（重命名）
      if (b.name !== undefined) {
        const newName = String(b.name).trim().replace(/\.md$/i, '').replace(/[:]/g, '：');
        if (!newName) return send(res, 200, { ok: false, error: '文件名不能为空' });
        const oldName = fm.meta.name || path.basename(full, '.md');
        if (newName !== oldName) {
          if (newName.includes('/') || newName.includes('\\')) return send(res, 200, { ok: false, error: '文件名不合法' });
          const newFull = path.join(path.dirname(full), newName + '.md');
          if (newFull !== full && fs.existsSync(newFull)) return send(res, 200, { ok: false, error: '目标文件已存在' });
          if (newFull !== full) {
            try { fs.renameSync(full, newFull); } catch (e) { return send(res, 200, { ok: false, error: '重命名失败: ' + e.message }); }
          }
          full = newFull;
          snip.filePath = (folderPath ? folderPath + '/' : '') + newName + '.md';
          fm.meta.name = newName;
          tgt.label = newName;
        }
      }
      // 类型（语言）
      if (b.language !== undefined) {
        const lang = String(b.language).trim() || 'plain_text';
        tgt.language = lang;
      }
      // 说明
      if (b.description !== undefined) fm.meta.description = b.description === null ? '' : String(b.description).trim();
      // 标签（按名称，自动建新）
      if (Array.isArray(b.tags)) fm.meta.tags = syncTags(st, b.tags.map(String));
      // 同步正文：目标片段标题 label 与围栏语言（massCode 片段结构一致性）
      const tgtIdx = fm.meta.contents.indexOf(tgt);
      if (tgtIdx >= 0) {
        const headingRe = /^##\s*Fragment:\s*(.*)$/gm;
        const headsPos = [];
        let hm;
        while ((hm = headingRe.exec(fm.body))) headsPos.push({ label: hm[1].trim(), start: hm.index, len: hm[0].length });
        if (headsPos[tgtIdx]) {
          const h = headsPos[tgtIdx];
          const changedHead = b.name !== undefined && tgt.label !== h.label;
          let delta = 0;
          if (changedHead) {
            const newHead = '## Fragment: ' + tgt.label;
            fm.body = fm.body.slice(0, h.start) + newHead + fm.body.slice(h.start + h.len);
            delta = newHead.length - h.len;
          }
          if (b.language !== undefined) {
            const segStart0 = h.start + h.len + fm.body.slice(h.start + h.len).indexOf('\n') + 1;
            const segStart = segStart0 + delta;
            const segEnd = headsPos[tgtIdx + 1] ? headsPos[tgtIdx + 1].start + delta : fm.body.length;
            const seg = fm.body.slice(segStart, segEnd);
            const fence = /^```[^\n]*/m.exec(seg);
            if (fence) {
              const abs = segStart + fence.index;
              fm.body = fm.body.slice(0, abs) + '```' + tgt.language + fm.body.slice(abs + fence[0].length);
            }
          }
        }
      }
      // 写回 .md
      const newMd = stringifyFrontmatter(fm);
      fs.writeFileSync(full, newMd, 'utf8');
      // 同步 state.json
      const sm = snip.meta;
      if (b.name !== undefined && fm.meta.name) sm.name = fm.meta.name;
      if (b.language !== undefined) { sm.language = tgt.language; }
      const sic = sm.contents.find((c) => String(c.id) === String(fragId)) || sm.contents[0];
      if (b.language !== undefined) sic.language = tgt.language;
      if (b.name !== undefined && tgt.label) sic.label = tgt.label;
      if (b.description !== undefined) sm.description = fm.meta.description ? fm.meta.description : null;
      if (Array.isArray(b.tags)) sm.tags = fm.meta.tags;
      sm.mtimeMs = now; sm.updatedAt = now; sm.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, name: fm.meta.name, language: tgt.language, tags: fm.meta.tags, description: fm.meta.description });
    }
    // 新增片段：在当前文件末尾追加一个 Fragment（正文 + frontmatter contents + state.json 同步）
    if (req.method === 'POST' && u.pathname === '/api/fs/addfragment') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === path.resolve(String(b.file || '')));
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      const full = path.resolve(codeRoot, snip.filePath);
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      const language = String(b.language || 'plain_text').trim() || 'plain_text';
      const label = String(b.label || '').trim() || ('片段 ' + ((snip.meta.contents || []).length + 1));
      const text = fs.readFileSync(full, 'utf8');
      const fm = parseFrontmatter(text);
      if (!fm.meta || !Array.isArray(fm.meta.contents)) return send(res, 200, { ok: false, error: 'frontmatter 解析失败' });
      const cid = ++st.counters.contentId;
      const now = Date.now();
      const newItem = { id: cid, label, language };
      fm.meta.contents.push(newItem);
      const bodyEnd = fm.body.replace(/\s+$/, '');
      fm.body = bodyEnd + '\n\n## Fragment: ' + label + '\n```' + language + '\n\n```\n';
      const newMd = stringifyFrontmatter(fm);
      fs.writeFileSync(full, newMd, 'utf8');
      snip.meta.contents.push(newItem);
      snip.meta.mtimeMs = now; snip.meta.updatedAt = now; snip.meta.size = Buffer.byteLength(newMd);
      writeState(st);
      return send(res, 200, { ok: true, file: full, fragment: newItem, index: fm.meta.contents.length - 1 });
    }
    if (req.method === 'GET' && u.pathname === '/api/git') {
      return send(res, 200, gitStatus());
    }
    if (req.method === 'POST' && u.pathname === '/api/fs/delete') {
      const b = await readBody(req);
      const codeRoot = path.join(vaultPath(), 'code');
      const st = readState();
      const full = path.resolve(codeRoot, String(b.file || ''));
      const snip = st.snippets.find((s) => path.resolve(codeRoot, s.filePath) === full);
      if (!snip) return send(res, 200, { ok: false, error: '片段不在状态库中（可能尚未同步）' });
      if (full !== codeRoot && !full.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      // 从状态库移除
      st.snippets = st.snippets.filter((s) => s !== snip);
      // 清理不再被引用的标签
      const used = new Set();
      st.snippets.forEach((s) => (s.meta.tags || []).forEach((t) => used.add(t)));
      if (Array.isArray(st.tags)) st.tags = st.tags.filter((t) => used.has(t.id));
      writeState(st);
      // 删除磁盘上的 .md
      try { fs.unlinkSync(full); } catch (_) {}
      // 若所在叶子目录已空，清理该目录的 .meta.yaml 与空目录（保留根与上层）
      const dir = path.dirname(full);
      if (dir !== codeRoot && fs.existsSync(dir)) {
        const rest = fs.readdirSync(dir).filter((n) => n !== '.meta.yaml');
        if (rest.length === 0) {
          try { fs.unlinkSync(path.join(dir, '.meta.yaml')); } catch (_) {}
          try { fs.rmdirSync(dir); } catch (_) {}
          const st2 = readState();
          const rel = path.relative(codeRoot, dir).split(path.sep).join('/');
          const fid = st2.folderIdByPath[rel];
          if (fid !== undefined) {
            delete st2.folderIdByPath[rel];
            delete st2.folderUi[fid];
          }
          writeState(st2);
        }
      }
      return send(res, 200, { ok: true, file: full });
    }
    // 删除文件夹（含其下所有片段与子文件夹，双清：状态库 + 磁盘）
    if (req.method === 'POST' && u.pathname === '/api/fs/delete-folder') {
      const b = await readBody(req);
      const rel = String(b.folder || '').replace(/^\/+|\/+$/g, '');
      const segs = rel.split('/');
      if (!rel || segs.some((s) => !s || s === '.' || s === '..')) return send(res, 200, { ok: false, error: '文件夹路径不合法' });
      const codeRoot = path.join(vaultPath(), 'code');
      const dir = path.join(codeRoot, rel);
      if (dir !== codeRoot && !dir.startsWith(codeRoot + path.sep)) return send(res, 200, { ok: false, error: '路径越界' });
      if (!fs.existsSync(dir)) return send(res, 200, { ok: false, error: '文件夹不存在' });
      const prefix = rel + '/';
      const st = readState();
      const removed = st.snippets.filter((s) => s.filePath === rel || s.filePath.startsWith(prefix));
      st.snippets = st.snippets.filter((s) => !(s.filePath === rel || s.filePath.startsWith(prefix)));
      const delKeys = Object.keys(st.folderIdByPath || {}).filter((k) => k === rel || k.startsWith(prefix));
      for (const k of delKeys) {
        const fid = st.folderIdByPath[k];
        delete st.folderIdByPath[k];
        if (fid !== undefined && st.folderUi) delete st.folderUi[fid];
      }
      const used = new Set();
      st.snippets.forEach((s) => (s.meta.tags || []).forEach((t) => used.add(t)));
      if (Array.isArray(st.tags)) st.tags = st.tags.filter((t) => used.has(t.id));
      writeState(st);
      let disk = false;
      try { fs.rmSync(dir, { recursive: true, force: true }); disk = true; } catch (_) {}
      return send(res, 200, { ok: true, folder: rel, deletedSnippets: removed.length, removedFolders: delKeys.length, disk });
    }
    /* ------------------------------ 绘图（Excalidraw, .excalidraw 文件） ------------------------------ */
    function drawingsDir() { return path.join(vaultPath(), 'drawings'); }
    function drawingName(n) {
      if (typeof n !== 'string') return null;
      const base = n.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).join('/');
      if (!base) return null;
      if (base.indexOf('\\') >= 0) return null;
      if (/(^|\/)\.{1,2}(\/|$)|^\/|\/\/|^[A-Za-z]:/.test(base)) return null;   // 防穿越：拒绝 ..、前导 /、//、盘符
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff /]+$/.test(base)) return null;          // 每段仅合法字符（保留中文/空格，分隔符允许 /）
      if (!/\.excalidraw$/i.test(base)) return null;
      return base;
    }
    function drawingDir2(n) {   // 目录路径校验：允许 ''（根）或 'a/b'（防穿越）
      if (typeof n !== 'string') return '';
      const base = n.split(/[\\/]/).map((s) => s.trim()).filter(Boolean).join('/');
      if (!base) return '';
      if (base.indexOf('\\') >= 0) return null;
      if (/(^|\/)\.{1,2}(\/|$)|^\/|\/\/|^[A-Za-z]:/.test(base)) return null;
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff /]+$/.test(base)) return null;
      return base;
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/list') {
      const dir = drawingsDir();
      let out = [];
      try {
        if (fs.existsSync(dir)) {
          out = fs.readdirSync(dir)
            .filter((n) => n.toLowerCase().endsWith('.excalidraw'))
            .map((n) => {
              try {
                const st = fs.statSync(path.join(dir, n));
                return { name: n, size: st.size, updated: st.mtimeMs };
              } catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.updated - a.updated);
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, drawings: out });
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/tree') {
      const dir = drawingsDir();
      const root = { type: 'folder', name: '', path: '', children: [], count: 0 };
      const walk = (node, abs) => {
        let entries = [];
        try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (_) {}
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        let n = 0;
        for (const ent of entries) {
          if (ent.isDirectory()) {
            const rel = node.path ? node.path + '/' + ent.name : ent.name;
            const fnode = { type: 'folder', name: ent.name, path: rel, children: [], count: 0 };
            node.children.push(fnode);
            fnode.count = walk(fnode, path.join(abs, ent.name));
            n += fnode.count;
          } else if (drawingName(ent.name)) {
            const rel = node.path ? node.path + '/' + ent.name : ent.name;
            let size = 0, updated = 0;
            try { const st = fs.statSync(path.join(abs, ent.name)); size = st.size; updated = st.mtimeMs; } catch (_) {}
            node.children.push({ type: 'drawing', name: ent.name, path: rel, size, updated });
            n += 1;
          }
        }
        node.count = n;
        return n;
      };
      walk(root, dir);
      return send(res, 200, { ok: true, dir, root, total: root.count });
    }
    if (req.method === 'GET' && u.pathname === '/api/drawings/get') {
      const name = drawingName(u.searchParams.get('name'));
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        const scene = JSON.parse(fs.readFileSync(path.join(drawingsDir(), name), 'utf8'));
        return send(res, 200, { ok: true, name, ...scene });
      } catch (_) { return send(res, 200, { ok: false, error: '读取失败（文件不存在或不是合法 Excalidraw JSON）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/save') {
      const b = await readBody(req);
      const name = drawingName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const data = b.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) return send(res, 200, { ok: false, error: '缺少 Excalidraw 场景数据' });
      const dir = drawingsDir();
      const target = path.join(dir, name);          // name 可含 '/' 子路径，防穿越已校验
      try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch (_) {}
      const body = JSON.stringify({ type: 'excalidraw', version: 2, source: 'file://', elements: data.elements, appState: data.appState || {}, files: data.files || {} });
      try { fs.writeFileSync(target, body); return send(res, 200, { ok: true, name, bytes: body.length }); }
      catch (e) { return send(res, 200, { ok: false, error: '写入失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/new') {
      const b = await readBody(req);
      const sub = drawingDir2(b && b.dir);          // 目标目录（'' = 根）
      if (sub === null) return send(res, 200, { ok: false, error: '目录不合法' });
      const baseRaw = String((b && b.name) || '').replace(/\.excalidraw$/i, '').trim();
      const base = baseRaw || 'Untitled';
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+$/.test(base) || base === '.' || base === '..') return send(res, 200, { ok: false, error: '名称不合法' });
      const dirAbs = path.join(drawingsDir(), sub || '.');
      try { fs.mkdirSync(dirAbs, { recursive: true }); } catch (_) {}
      let name = base + '.excalidraw', i = 2;
      while (true) {
        if (!fs.existsSync(path.join(dirAbs, name))) break;
        name = base + '-' + i + '.excalidraw'; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      const full = sub ? sub + '/' + name : name;
      const scene = { type: 'excalidraw', version: 2, source: 'file://', elements: [], appState: {}, files: {} };
      try {
        fs.writeFileSync(path.join(dirAbs, name), JSON.stringify(scene));
        return send(res, 200, { ok: true, name: full, dir: sub, ...scene });
      } catch (e) { return send(res, 200, { ok: false, error: '创建失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/new-folder') {
      const b = await readBody(req);
      const parent = drawingDir2(b && b.dir);       // 父目录（'' = 根）
      if (parent === null) return send(res, 200, { ok: false, error: '目录不合法' });
      const sub = drawingDir2(b && b.name);         // 新建目录名（可含 / 嵌套）
      if (!sub || sub === '.') return send(res, 200, { ok: false, error: '文件夹名称不合法' });
      const full = parent ? parent + '/' + sub : sub;
      try {
        fs.mkdirSync(path.join(drawingsDir(), full), { recursive: true });
        return send(res, 200, { ok: true, path: full });
      } catch (e) { return send(res, 200, { ok: false, error: '创建失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/delete') {
      const b = await readBody(req);
      const name = drawingName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        fs.unlinkSync(path.join(drawingsDir(), name));
        return send(res, 200, { ok: true, name });
      } catch (_) { return send(res, 200, { ok: false, error: '删除失败（文件不存在或已被占用）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/rename') {
      const b = await readBody(req);
      const name = drawingName(b && b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const baseRaw = String((b && b.newName) || '').replace(/\.excalidraw$/i, '').trim();
      if (!baseRaw) return send(res, 200, { ok: false, error: '名称不合法' });
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+$/.test(baseRaw) || baseRaw === '.' || baseRaw === '..' || /[\\/]/.test(baseRaw)) return send(res, 200, { ok: false, error: '名称不合法（仅当前文件夹内命名）' });
      const parts = name.split('/');
      const dir = parts.slice(0, -1).join('/');
      const dirAbs = dir ? path.join(drawingsDir(), dir) : drawingsDir();
      const oldFile = parts[parts.length - 1];
      const oldAbs = path.join(dirAbs, oldFile);
      let target = baseRaw + '.excalidraw', i = 2;
      while (fs.existsSync(path.join(dirAbs, target)) && path.basename(target).toLowerCase() !== oldFile.toLowerCase()) {
        target = baseRaw + '-' + i + '.excalidraw'; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      try {
        if (target === oldFile) return send(res, 200, { ok: true, name, unchanged: true });
        const newAbs = path.join(dirAbs, target);
        if (target.toLowerCase() === oldFile.toLowerCase()) {
          // 仅大小写不同（macOS 不区分大小写）：先经临时名绕行，再改回目标大小写
          const tmp = path.join(dirAbs, '.' + Date.now() + '.tmp.excalidraw');
          fs.renameSync(oldAbs, tmp);
          fs.renameSync(tmp, newAbs);
        } else {
          fs.renameSync(oldAbs, newAbs);
        }
        const full = dir ? dir + '/' + target : target;
        return send(res, 200, { ok: true, name: full });
      } catch (_) { return send(res, 200, { ok: false, error: '重命名失败（文件不存在或已被占用）' }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/drawings/move') {
      const b = await readBody(req);
      const name = drawingName(b && b.name);
      const toDir = drawingDir2(b && b.toDir);
      if (!name || toDir === null) return send(res, 200, { ok: false, error: '路径不合法' });
      const fromFile = name.split('/').pop();
      const full = toDir ? toDir + '/' + fromFile : fromFile;
      if (full === name) return send(res, 200, { ok: true, name, unchanged: true });
      const dirAbs = path.join(drawingsDir(), toDir || '.');
      try { fs.mkdirSync(dirAbs, { recursive: true }); } catch (_) {}
      // 目标文件夹已有同名文件 → 自动 -2、-3 避冲突（移动不改文件名）
      let target = fromFile, i = 2;
      while (fs.existsSync(path.join(dirAbs, target)) && (toDir ? toDir + '/' + target : target) !== name) {
        target = fromFile.replace(/\.excalidraw$/i, '') + '-' + i + '.excalidraw'; i += 1;
        if (i > 100000) return send(res, 200, { ok: false, error: '无法分配文件名' });
      }
      try {
        fs.renameSync(path.join(drawingsDir(), name), path.join(dirAbs, target));
        return send(res, 200, { ok: true, name: (toDir ? toDir + '/' : '') + target });
      } catch (_) { return send(res, 200, { ok: false, error: '移动失败（文件不存在或已被占用）' }); }
    }
    // ---- Libraries（Excalidraw 库：vault/libraries/*.excalidrawLibrary，文件夹管理 + 自动加载） ----
    function libsDir() { return path.join(vaultPath(), 'libraries'); }
    function libName(n) {
      if (typeof n !== 'string') return null;
      const base = n.split(/[\\/]/).pop();
      if (!/^[A-Za-z0-9._\-\u00a0-\uffff ]+\.excalidraw(library|lib)$/i.test(base)) return null;
      return base;
    }
    function readLibItems(file) {
      try {
        const p = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (p && Array.isArray(p.libraryItems)) return p.libraryItems;
      } catch (_) {}
      return null;
    }
    function mergeLibItems(lists) {
      const out = [], seen = new Set();
      for (const items of lists) {
        if (!Array.isArray(items)) continue;
        for (const it of items) {
          if (it && typeof it === 'object' && it.id && !seen.has(it.id) && Array.isArray(it.elements)) { seen.add(it.id); out.push(it); }
        }
      }
      return out;
    }
    if (req.method === 'GET' && u.pathname === '/api/libraries/list') {
      const dir = libsDir();
      let out = [];
      try {
        if (fs.existsSync(dir)) {
          out = fs.readdirSync(dir)
            .filter((n) => libName(n))
            .map((n) => {
              try { const st = fs.statSync(path.join(dir, n)); return { name: n, size: st.size, updated: st.mtimeMs }; }
              catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.updated - a.updated);
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, libraries: out });
    }
    if (req.method === 'GET' && u.pathname === '/api/libraries/all') {
      const dir = libsDir();
      const lists = [], files = [];
      try {
        if (fs.existsSync(dir)) {
          for (const n of fs.readdirSync(dir).filter((fn) => libName(fn))) {
            const items = readLibItems(path.join(dir, n));
            if (items !== null) { lists.push(items); files.push(n); }
          }
        }
      } catch (_) {}
      return send(res, 200, { ok: true, dir, files, items: mergeLibItems(lists) });
    }
    if (req.method === 'POST' && u.pathname === '/api/libraries/save') {
      const b = await readBody(req);
      const name = libName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      const data = b.data;
      if (!data || typeof data !== 'object' || !Array.isArray(data.libraryItems)) return send(res, 200, { ok: false, error: '缺少库数据（libraryItems 数组）' });
      const dir = libsDir();
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      const body = JSON.stringify({ type: 'excalidrawLibrary', version: 2, source: 'file://', libraryItems: data.libraryItems });
      try { fs.writeFileSync(path.join(dir, name), body); return send(res, 200, { ok: true, name, bytes: body.length }); }
      catch (e) { return send(res, 200, { ok: false, error: '写入失败: ' + String((e && e.message) || e) }); }
    }
    if (req.method === 'POST' && u.pathname === '/api/libraries/delete') {
      const b = await readBody(req);
      const name = libName(b.name);
      if (!name) return send(res, 200, { ok: false, error: '文件名不合法' });
      try {
        fs.unlinkSync(path.join(libsDir(), name));
        return send(res, 200, { ok: true, name });
      } catch (_) { return send(res, 200, { ok: false, error: '删除失败（文件不存在或已被占用）' }); }
    }
    // ---- AI 助手（OpenAI 兼容代理：URL/Key/模型由前端配置，服务器只做转发） ----
    if (req.method === 'POST' && u.pathname === '/api/ai/chat') {
      const b = await readBody(req);
      const url = String((b && b.url) || '').trim();
      const key = String((b && b.key) || '').trim();
      const model = String((b && b.model) || '').trim();
      const messages = b && Array.isArray(b.messages) ? b.messages : null;
      if (!/^https?:\/\//i.test(url)) return send(res, 200, { ok: false, error: 'API URL 不合法（需 http/https 开头）' });
      if (!model) return send(res, 200, { ok: false, error: '请填写模型名称' });
      if (!messages || !messages.length) return send(res, 200, { ok: false, error: '缺少消息内容' });
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
          body: JSON.stringify({ model, messages, stream: false, temperature: 0.3 }),
          signal: AbortSignal.timeout(120000),
        });
        const text = await resp.text();
        if (!resp.ok) return send(res, 200, { ok: false, error: 'API 错误 ' + resp.status + ': ' + text.slice(0, 400) });
        let data;
        try { data = JSON.parse(text); } catch (_) { return send(res, 200, { ok: false, error: 'API 返回非 JSON 内容' }); }
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (typeof content !== 'string') return send(res, 200, { ok: false, error: '无法解析响应（缺少 choices[0].message.content）' });
        return send(res, 200, { ok: true, content, model, usage: (data && data.usage) || null });
      } catch (e) {
        return send(res, 200, { ok: false, error: '请求失败: ' + String((e && e.message) || e).slice(0, 300) });
      }
    }
    if (req.method === 'POST' && u.pathname === '/api/git/commit') {
      const b = await readBody(req);
      const msg = String(b.message || '').trim();
      if (!msg) return send(res, 200, { ok: false, error: '提交信息不能为空' });
      const add = await gitRun(['add', '-A']);
      if (!add.ok) return send(res, 200, { ok: false, error: 'git add 失败: ' + add.error });
      const cm = await gitRun(['commit', '-m', msg]);
      if (!cm.ok) return send(res, 200, { ok: false, error: 'git commit 失败: ' + cm.error, output: (cm.stdout + cm.stderr).trim() });
      return send(res, 200, { ok: true, message: '已提交', output: (cm.stdout + cm.stderr).trim(), status: gitStatus() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/push') {
      const r = await gitRun(['push'], 120000);
      return send(res, 200, r.ok
        ? { ok: true, message: '推送成功', output: (r.stdout + r.stderr).trim(), status: gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/pull') {
      const r = await gitRun(['pull'], 120000);
      return send(res, 200, r.ok
        ? { ok: true, message: '拉取成功', output: (r.stdout + r.stderr).trim(), status: gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    if (req.method === 'POST' && u.pathname === '/api/git/reset') {
      const b = await readBody(req);
      const hash = String(b.hash || '').trim();
      if (!/^[0-9a-f]{4,40}$/i.test(hash)) return send(res, 200, { ok: false, error: '提交标识不合法' });
      const r = await gitRun(['reset', '--hard', hash], 60000);
      return send(res, 200, r.ok
        ? { ok: true, message: '已回退到 ' + hash, output: (r.stdout + r.stderr).trim(), status: gitStatus() }
        : { ok: false, error: r.error, output: (r.stdout + r.stderr).trim() });
    }
    // ===== 底部终端（PTY shell，script 命令分配伪终端）=====
    if (req.method === 'GET' && u.pathname === '/api/term/stream') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      if (TERM && TERM.res) { try { TERM.res.end(); } catch (_) {} }   // 同一时刻只保留一个消费方
      if (!TERM || !TERM.child) termSpawn();
      if (!TERM) { res.end('终端启动失败'); return; }
      TERM.res = res;
      req.on('close', () => {
        if (TERM && TERM.res === res) {   // 页面关闭/刷新 → 结束会话，避免孤儿进程
          TERM.res = null;
          try { TERM.child.kill(); } catch (_) {}
          TERM = null;
        }
      });
      return;   // 保持连接，输出由 termSpawn 的 stdout/stderr 回调实时推送
    }
    if (req.method === 'POST' && u.pathname === '/api/term/input') {
      const b = await readBody(req);
      const data = String((b && b.data) || '');
      if (TERM && TERM.child) { try { TERM.child.stdin.write(data); } catch (_) {} }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/term/stop') {
      if (TERM && TERM.child) { try { TERM.child.kill(); } catch (_) {} }
      TERM = null;
      return send(res, 200, { ok: true });
    }
    send(res, 404, { ok: false, error: 'Not Found: ' + u.pathname });
  } catch (e) {
    send(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log('masscode-runner 已启动: http://' + HOST + ':' + PORT);
  try { console.log('Vault: ' + vaultPath()); } catch (e) { console.log('Vault: ' + e.message); }
  console.log('正在检测本机环境…');
  getEnv(true).then((env) => {
    const missing = Object.values(env).filter((e) => !e.available);
    console.log('环境检测完成：' + (Object.keys(env).length - missing.length) + '/' + Object.keys(env).length + ' 项就绪');
    if (missing.length) {
      console.log('缺失项：');
      for (const m of missing) console.log('  - ' + m.label + '（' + m.for + '）→ ' + installHint(m.key));
    } else {
      console.log('全部就绪 ✅');
    }
  });
  console.log('按 Ctrl+C 停止');
});
