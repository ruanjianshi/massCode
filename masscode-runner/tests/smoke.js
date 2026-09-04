#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

async function main() {
  fs.mkdirSync(path.join(vault, 'code'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'drawings'), { recursive: true });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const output = [];
  child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, CODESCOPE_HOST: '127.0.0.1', CODESCOPE_PORT: String(port), CODESCOPE_VAULT: vault },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  await waitForServer(baseUrl, output);

  const version = await requestJson(baseUrl, '/api/version');
  assert(version.ok && version.name === '码境 CodeScope' && version.version === '1.0.0', '版本接口返回异常');

  const page = await fetch(baseUrl + '/');
  const html = await page.text();
  assert(page.ok && html.includes('码境 CodeScope · 工程代码工作台'), '主页品牌标题不正确');
  assert(html.includes('href="https://github.com/ruanjianshi/massCode"'), 'GitHub 远程仓库入口缺失');

  const icon = await fetch(baseUrl + '/assets/codescope.svg');
  assert(icon.ok && (icon.headers.get('content-type') || '').includes('image/svg+xml'), '品牌图标无法加载');

  const snippets = await requestJson(baseUrl, '/api/snippets');
  assert(snippets.vault === vault && Array.isArray(snippets.snippets), '片段接口返回异常');

  const status = await requestJson(baseUrl, '/api/system/status');
  assert(status.ok && status.cpu && status.memory && status.disk, '系统状态接口返回异常');

  const remote = await requestJson(baseUrl, '/api/remote/status');
  assert(remote.ok && remote.ssh && remote.vnc && remote.terminal, '远程开发状态接口返回异常');

  const invalidLatency = await requestJson(baseUrl, '/api/remote/latency?host=bad%20host&port=5900', 400);
  assert(invalidLatency.ok === false, '延迟接口未拒绝非法主机');

  console.log('CodeScope smoke tests: 9 passed');
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(() => {
  if (child && child.exitCode === null) child.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
