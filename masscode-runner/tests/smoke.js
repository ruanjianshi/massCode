#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-test-'));
const vault = path.join(tempRoot, 'vault');
let child;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(baseUrl, output) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(baseUrl + '/api/rev');
      if (response.ok) return;
    } catch (_) {}
    if (child.exitCode !== null) throw new Error('服务提前退出：\n' + output.join(''));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('等待服务启动超时：\n' + output.join(''));
}

async function requestJson(baseUrl, pathname, expectedStatus = 200) {
  const response = await fetch(baseUrl + pathname);
  assert(response.status === expectedStatus, `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`);
  return response.json();
}

async function postJson(baseUrl, pathname, body, expectedStatus = 200) {
  const response = await fetch(baseUrl + pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.status === expectedStatus, `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`);
  return response.json();
}

async function main() {
  fs.mkdirSync(path.join(vault, 'code'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'drawings'), { recursive: true });
  const snippetFile = path.join(vault, 'code', 'timeline-demo.md');
  fs.writeFileSync(snippetFile, `---
contents:
  - id: 1
    label: demo.c
    language: c
createdAt: 1
description: timeline test
folderId: null
id: 1
isDeleted: 0
isFavorites: 0
name: Timeline Demo
tags:
updatedAt: 1
---

## Fragment: demo.c
\`\`\`c
int main(void) { return 0; }
\`\`\`
`);
  fs.mkdirSync(path.join(tempRoot, 'sample'), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, 'sample', 'package.json'), JSON.stringify({ scripts: { check: 'node -e "process.stdout.write(\'task-ok\')"' } }));
  fs.writeFileSync(path.join(tempRoot, 'compile_commands.json'), JSON.stringify([{
    directory: tempRoot, file: path.join(tempRoot, 'sample.c'), arguments: ['cc', '-I', 'include', '-DDEMO_FEATURE=1', '-c', 'sample.c'],
  }]));
  fs.writeFileSync(path.join(tempRoot, 'sample.c'), '#include "sample.h"\n// TODO: cover\nint sample(void) { return DEMO_FEATURE; }\n');
  fs.writeFileSync(path.join(tempRoot, 'sample.h'), 'int sample(void);\n');
  execFileSync('git', ['init', '-q', tempRoot]);
  execFileSync('git', ['-C', tempRoot, 'config', 'user.email', 'codescope-test@example.invalid']);
  execFileSync('git', ['-C', tempRoot, 'config', 'user.name', 'CodeScope Test']);
  execFileSync('git', ['-C', tempRoot, 'add', '.']);
  execFileSync('git', ['-C', tempRoot, 'commit', '-qm', 'test fixture']);
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault, CODESCOPE_DATA_HOME: path.join(tempRoot, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  await waitForServer(baseUrl, output);

  const version = await requestJson(baseUrl, '/api/version');
  assert(version.ok && version.name === '码境 CodeScope' && version.version === '1.1.0' && version.apiRevision >= 2 && version.features.includes('project-health') && version.features.includes('live-web-search') && version.features.includes('editor-groups'), '版本接口返回异常');

  const page = await fetch(baseUrl + '/');
  const html = await page.text();
  assert(page.ok && html.includes('码境 CodeScope · 工程代码工作台'), '主页品牌标题不正确');
  assert(html.includes('href="https://github.com/ruanjianshi/massCode"'), 'GitHub 远程仓库入口缺失');
  assert(html.includes('id="theme-switcher"') && html.includes('data-app-theme="light"') && html.includes('codescope-theme'), '界面主题切换功能缺失');
  assert(html.includes('id="editor-find"') && html.includes('replaceEditorFindAll') && html.includes("e.key==='F3'"), '编辑器快捷键查找替换功能缺失');
  assert(html.includes('id="sym-ai-submit"') && html.includes('submitAiSearch') && html.includes('data-search-mode="symbol"'), 'AI 搜索或原项目符号检索入口缺失');
  assert(html.includes('id="ai-search-provider"') && html.includes('id="ai-search-key"') && html.includes('/api/ai/web-search'), '实时联网搜索配置缺失');
  assert(html.includes('id="editor-drop-overlay"') && html.includes('split-editor-group') && html.includes('initEditorGroups') && html.includes('application/x-codescope-editor'), '2 至 4 栏拖拽编辑功能缺失');
  assert(html.includes('html[data-theme] .split-editor-input') && html.includes("classList.toggle('plain',!exact)"), '多栏编辑器高亮层遮挡修复或纯文本降级缺失');
  assert(html.includes('withActiveSplitContext') && html.includes('activateSplitReading') && html.includes('activateOpenSplitLocation'), '右侧阅读面板未跟随多栏编辑器焦点');
  assert(html.includes('if(multi)applySplitRatios()') && /applyMdView\(\);\s*if\(multi\)applySplitRatios/.test(html), '多栏退出后 Markdown/LaTeX 预览恢复逻辑缺失');
  assert(html.includes('rel-link-halo') && html.includes('node-icon') && html.includes('rel-map-summary') && html.includes('no-upstream') && html.includes('wireSide'), '关系图自适应拓扑、视觉层级或主干连线优化缺失');
  assert(html.includes('id="remote-resizer-y"') && html.includes('id="remote-folder-upload"') && html.includes('id="remote-folder-download"'), '远程窗口高度拖拽或文件夹传输入口缺失');

  const icon = await fetch(baseUrl + '/assets/codescope.svg');
  assert(icon.ok && (icon.headers.get('content-type') || '').includes('image/svg+xml'), '品牌图标无法加载');

  const snippets = await requestJson(baseUrl, '/api/snippets');
  assert(snippets.vault === vault && snippets.snippets.length === 1, '片段接口返回异常');

  const changedCode = 'int main(void) { return 1; }';
  const saved = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedCode });
  assert(saved.ok, '自动保存接口失败');
  const timeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(timeline.ok && timeline.entries.length === 1, '本地时间线未记录覆盖前版本');
  const timelineItem = await requestJson(baseUrl, '/api/timeline/item?file=' + encodeURIComponent(snippetFile) + '&fragment=0&id=' + encodeURIComponent(timeline.entries[0].id));
  assert(timelineItem.ok && timelineItem.diff.includes('return 0') && timelineItem.diff.includes('return 1'), '时间线差异内容不正确');
  const unchanged = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedCode });
  assert(unchanged.ok && unchanged.unchanged, '相同内容保存不应重复写入时间线');

  const git = await requestJson(baseUrl, '/api/git');
  const changedPath = path.relative(tempRoot, snippetFile).split(path.sep).join('/');
  assert(git.ok && git.changes.some((item) => item.path === changedPath), 'Git 状态未识别保存后的文件变化');
  const diff = await requestJson(baseUrl, '/api/git/diff?path=' + encodeURIComponent(changedPath));
  assert(diff.ok && diff.additions === 1 && diff.deletions === 1 && diff.diff.includes('return 1'), 'Git Diff 内容不正确');

  const restored = await postJson(baseUrl, '/api/timeline/restore', { file: snippetFile, fragment: 0, id: timeline.entries[0].id });
  assert(restored.ok && restored.code.includes('return 0'), '时间线恢复失败');
  const protectedTimeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(protectedTimeline.entries.length === 2, '恢复前未创建保护检查点');
  const invalidDiff = await requestJson(baseUrl, '/api/git/diff?path=' + encodeURIComponent('../escape.txt'), 400);
  assert(invalidDiff.ok === false, 'Git Diff 未拒绝越界路径');

  const status = await requestJson(baseUrl, '/api/system/status');
  assert(status.ok && status.cpu && status.memory && status.disk, '系统状态接口返回异常');

  const remote = await requestJson(baseUrl, '/api/remote/status');
  assert(remote.ok && remote.ssh && remote.ssh.files && remote.vnc && remote.terminal, '远程开发状态接口返回异常');

  const tasks = await requestJson(baseUrl, '/api/project/tasks');
  const checkTask = tasks.tasks.find((item) => item.name.startsWith('npm · check'));
  assert(tasks.ok && checkTask && checkTask.cwd === 'sample', '未发现子目录 npm 构建任务');
  const taskResult = await postJson(baseUrl, '/api/project/tasks/run', { id: checkTask.id });
  assert(taskResult.ok && taskResult.stdout.includes('task-ok'), '构建任务执行失败');
  const customTask = await postJson(baseUrl, '/api/project/tasks/run', { command: 'node -e "process.stdout.write(\'custom-ok\')"', cwd: 'sample' });
  assert(customTask.ok && customTask.stdout === 'custom-ok', '自定义任务执行失败');
  const escapedTask = await postJson(baseUrl, '/api/project/tasks/run', { command: 'pwd', cwd: '../escape' });
  assert(!escapedTask.ok, '构建任务未拒绝越界工作目录');

  const compileDb = await requestJson(baseUrl, '/api/project/compile-db');
  assert(compileDb.ok && compileDb.found && compileDb.entries === 1 && compileDb.defines.includes('DEMO_FEATURE=1'), '编译数据库解析失败');
  const health = await requestJson(baseUrl, '/api/project/health');
  assert(health.ok && health.summary.files >= 4 && health.summary.todos === 1 && health.languages.C === 1 && health.languages['C/C++'] === 1, '工程健康报告统计异常');

  const invalidRemoteFiles = await postJson(baseUrl, '/api/remote/files/list', { host:'bad host', port:22, user:'robot', path:'.' });
  assert(!invalidRemoteFiles.ok && /主机/.test(invalidRemoteFiles.error), '远程文件接口未拒绝非法主机');
  const invalidTransferMeta = Buffer.from(JSON.stringify({ host:'127.0.0.1', port:22, user:'robot', path:'.', relativePath:'../escape.txt' })).toString('base64');
  const invalidUploadResponse = await fetch(baseUrl + '/api/remote/files/upload-stream', { method:'POST', headers:{ 'X-CodeScope-Remote':invalidTransferMeta }, body:'test' });
  const invalidUpload = await invalidUploadResponse.json();
  assert(!invalidUpload.ok && /相对路径/.test(invalidUpload.error), '流式远程上传接口未拒绝越界路径');

  const invalidLatency = await requestJson(baseUrl, '/api/remote/latency?host=bad%20host&port=5900', 400);
  assert(invalidLatency.ok === false, '延迟接口未拒绝非法主机');

  const invalidWebSearch = await postJson(baseUrl, '/api/ai/web-search', { provider:'tavily', key:'', query:'test' }, 400);
  assert(invalidWebSearch.ok === false && /Key/.test(invalidWebSearch.error), '联网搜索接口未拒绝缺失的 API Key');

  console.log('CodeScope smoke tests: 39 passed');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(() => {
  if (child && child.exitCode === null) child.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
