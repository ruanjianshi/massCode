'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');

const SERVERS = {
  c: { command: 'clangd', args: ['--background-index=false', '--clang-tidy=false', '--header-insertion=never', '--log=error'] },
  c_cpp: { command: 'clangd', args: ['--background-index=false', '--clang-tidy=false', '--header-insertion=never', '--log=error'] },
  python: { command: 'pyright-langserver', args: ['--stdio'] },
  javascript: { command: 'typescript-language-server', args: ['--stdio'] },
  typescript: { command: 'typescript-language-server', args: ['--stdio'] },
  go: { command: 'gopls', args: ['serve'] },
};

function executablePath(command) {
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    return execFileSync(finder, [command], { encoding: 'utf8', timeout: 2500 }).split(/\r?\n/)[0].trim();
  } catch (_) { return ''; }
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function safeFilename(value, fallback) {
  const clean = String(value || '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
  return clean && !clean.startsWith('.') ? clean : fallback;
}

function languageId(language, filename) {
  if (language === 'c_cpp') return /\.(?:h|hh|hpp|hxx)$/i.test(filename) ? 'cpp' : 'cpp';
  return ({ c: 'c', python: 'python', javascript: 'javascript', typescript: 'typescript', go: 'go' })[language] || language;
}

function hoverText(contents) {
  if (!contents) return '';
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(hoverText).filter(Boolean).join('\n\n');
  if (typeof contents.value === 'string') return contents.value;
  if (typeof contents.language === 'string' && typeof contents.value === 'string') return '```' + contents.language + '\n' + contents.value + '\n```';
  return '';
}

class LspSession {
  constructor(config, root) {
    this.config = config;
    this.root = root;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
    this.openDocs = new Map();
    this.diagnostics = new Map();
    this.lastUsed = Date.now();
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const executable = executablePath(this.config.command);
      if (!executable) return reject(new Error('未安装 ' + this.config.command));
      const child = spawn(executable, this.config.args, { cwd: this.root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      child.stdout.on('data', (chunk) => this.onData(chunk));
      child.stderr.on('data', () => {});
      child.once('error', reject);
      child.once('exit', () => this.failAll(new Error(this.config.command + ' 已退出')));
      this.request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: 'CodeScope' }],
        capabilities: {
          textDocument: {
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: { workspaceFolders: true },
        },
        clientInfo: { name: 'CodeScope', version: '1.2.0' },
      }, 12000).then(() => {
        this.notify('initialized', {});
        resolve(this);
      }, reject);
    });
    return this.ready;
  }

  send(message) {
    if (!this.child || !this.child.stdin.writable) throw new Error('语言服务器未运行');
    const json = JSON.stringify(message);
    this.child.stdin.write('Content-Length: ' + Buffer.byteLength(json) + '\r\n\r\n' + json);
  }

  request(method, params, timeout = 8000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(method + ' 请求超时')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ jsonrpc: '2.0', id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: '2.0', method, params });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      const split = this.buffer.indexOf('\r\n\r\n');
      if (split < 0) return;
      const header = this.buffer.subarray(0, split).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { this.buffer = this.buffer.subarray(split + 4); continue; }
      const length = Number(match[1]), start = split + 4;
      if (this.buffer.length < start + length) return;
      const raw = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      let message; try { message = JSON.parse(raw); } catch (_) { continue; }
      if (message.id != null && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'LSP 请求失败'));
        else pending.resolve(message.result);
      } else if (message.method === 'textDocument/publishDiagnostics' && message.params) {
        this.diagnostics.set(message.params.uri, message.params.diagnostics || []);
      }
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.child = null; this.ready = null; this.openDocs.clear();
  }

  sync(uri, language, text) {
    const previous = this.openDocs.get(uri);
    if (!previous) {
      this.openDocs.set(uri, { version: 1, text });
      this.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: 1, text } });
    } else if (previous.text !== text) {
      const version = previous.version + 1; this.openDocs.set(uri, { version, text });
      this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
    }
    this.lastUsed = Date.now();
  }

  close() {
    try { this.notify('exit', null); } catch (_) {}
    try { if (this.child) this.child.kill(); } catch (_) {}
    this.failAll(new Error('语言服务器会话已关闭'));
  }
}

function createLspService(options = {}) {
  const base = options.tempRoot || path.join(os.tmpdir(), 'CodeScope', 'lsp');
  const sessions = new Map();

  function status() {
    const byCommand = {};
    for (const [language, config] of Object.entries(SERVERS)) {
      if (!byCommand[config.command]) byCommand[config.command] = { command: config.command, path: executablePath(config.command), languages: [] };
      byCommand[config.command].languages.push(language);
    }
    return { ok: true, servers: Object.values(byCommand).map((item) => ({ ...item, available: !!item.path })) };
  }

  function materialize(snippet, selectedIndex, selectedCode) {
    const key = shortHash(snippet.file || snippet.name || 'snippet');
    const root = path.join(base, key); fs.mkdirSync(root, { recursive: true });
    const files = [];
    (snippet.fragments || []).forEach((fragment, index) => {
      const fallback = 'file' + (index + 1) + '.' + ({ c: 'c', c_cpp: 'cpp', python: 'py', javascript: 'js', typescript: 'ts', go: 'go' }[fragment.language] || 'txt');
      const filename = safeFilename(fragment.filename || fragment.label, fallback);
      const full = path.resolve(root, filename);
      if (!full.startsWith(root + path.sep)) return;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const code = index === selectedIndex && typeof selectedCode === 'string' ? selectedCode : String(fragment.code || '');
      fs.writeFileSync(full, code, 'utf8');
      files.push({ index, filename, full, uri: pathToFileURL(full).href, code, language: fragment.language });
    });
    fs.writeFileSync(path.join(root, 'compile_flags.txt'), '-I.\n', 'utf8');
    return { key, root, files, selected: files.find((file) => file.index === selectedIndex) };
  }

  function mapLocation(location, workspace) {
    if (!location) return null;
    const uri = location.uri || location.targetUri;
    const range = location.range || location.targetSelectionRange || location.targetRange;
    if (!uri || !range) return null;
    let full = ''; try { full = fileURLToPath(uri); } catch (_) { return null; }
    const canonical = (value) => { try { return fs.realpathSync(value); } catch (_) { return path.resolve(value); } };
    const wanted = canonical(full), found = workspace.files.find((file) => canonical(file.full) === wanted);
    return { uri, file: found ? found.filename : path.basename(full), fragment: found ? found.index : -1, line: range.start.line + 1, column: range.start.character + 1 };
  }

  async function query(input) {
    const language = String(input.language || '').toLowerCase(), config = SERVERS[language];
    if (!config) return { ok: false, available: false, error: '当前语言尚未配置 LSP' };
    const commandPath = executablePath(config.command);
    if (!commandPath) return { ok: false, available: false, server: config.command, error: '未安装 ' + config.command };
    const workspace = materialize(input.snippet, Number(input.fragment) || 0, input.code);
    if (!workspace.selected) return { ok: false, available: true, error: '片段文件不存在' };
    const sessionKey = config.command + '|' + workspace.root;
    let session = sessions.get(sessionKey);
    if (!session) { session = new LspSession(config, workspace.root); sessions.set(sessionKey, session); }
    try {
      await session.start();
      for (const file of workspace.files) session.sync(file.uri, languageId(file.language, file.filename), file.code);
      const position = { line: Math.max(0, Number(input.line) - 1 || 0), character: Math.max(0, Number(input.column) - 1 || 0) };
      const params = { textDocument: { uri: workspace.selected.uri }, position };
      const action = String(input.action || 'hover');
      if (action === 'hover') {
        const result = await session.request('textDocument/hover', params);
        return { ok: true, available: true, server: config.command, hover: result ? { markdown: hoverText(result.contents), range: result.range || null } : null };
      }
      if (action === 'definition' || action === 'references') {
        const method = action === 'definition' ? 'textDocument/definition' : 'textDocument/references';
        const result = await session.request(method, action === 'references' ? { ...params, context: { includeDeclaration: true } } : params);
        const rows = (Array.isArray(result) ? result : result ? [result] : []).map((item) => mapLocation(item, workspace)).filter(Boolean);
        return { ok: true, available: true, server: config.command, locations: rows };
      }
      if (action === 'diagnostics') {
        await new Promise((resolve) => setTimeout(resolve, 220));
        return { ok: true, available: true, server: config.command, diagnostics: session.diagnostics.get(workspace.selected.uri) || [] };
      }
      return { ok: false, available: true, error: '不支持的 LSP 操作' };
    } catch (error) {
      sessions.delete(sessionKey); session.close();
      return { ok: false, available: true, server: config.command, error: String(error.message || error).slice(0, 500) };
    }
  }

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) if (now - session.lastUsed > 10 * 60 * 1000) { session.close(); sessions.delete(key); }
  }, 60000);
  cleanup.unref();

  return { status, query, close: () => { clearInterval(cleanup); for (const session of sessions.values()) session.close(); sessions.clear(); } };
}

module.exports = { createLspService };
