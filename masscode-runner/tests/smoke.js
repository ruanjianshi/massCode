#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-test-'));
const vault = path.join(tempRoot, 'vault');
let child;
let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
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

function postChunkedJson(baseUrl, pathname, chunks) {
  const target = new URL(pathname, baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(target, { method:'POST', headers:{'Content-Type':'application/json'} }, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        try { resolve({ status:res.statusCode, data:JSON.parse(Buffer.concat(parts).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

async function postJson(baseUrl, pathname, body, expectedStatus = 200) {
  const response = await fetch(baseUrl + pathname, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  assert(response.status === expectedStatus, `${pathname} 状态码应为 ${expectedStatus}，实际为 ${response.status}`);
  return response.json();
}

function samplePdf(text) {
  const escaped = String(text).replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index++) pdf += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
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
  assert(version.ok && version.name === '码境 CodeScope' && version.version === '1.2.0' && version.apiRevision >= 2 && version.features.includes('project-health') && version.features.includes('live-web-search') && version.features.includes('search-history') && version.features.includes('editor-groups') && version.features.includes('drawio') && version.features.includes('drawio-xml') && version.features.includes('ai-drawio') && version.features.includes('full-text-search') && version.features.includes('quick-open') && version.features.includes('navigation-history') && version.features.includes('definition-peek') && version.features.includes('header-source-switch') && version.features.includes('lsp') && version.features.includes('pdf-library') && version.features.includes('pdf-translation') && version.features.includes('reading-fragments') && version.features.includes('reading-split-view') && version.features.includes('reading-projects') && version.features.includes('reading-code-notes'), '版本接口返回异常');

  const page = await fetch(baseUrl + '/');
  const html = await page.text();
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const launchers = ['start.command', '../启动码境.command', '../启动码境.sh', '../启动码境.bat']
    .map((file) => fs.readFileSync(path.resolve(projectRoot, file), 'utf8')).join('\n');
  assert(page.ok && html.includes('码境 CodeScope · 工程代码工作台'), '主页品牌标题不正确');
  assert(html.includes('href="https://github.com/ruanjianshi/massCode"'), 'GitHub 远程仓库入口缺失');
  assert(html.includes('id="theme-switcher"') && html.includes('data-app-theme="light"') && html.includes('codescope-theme'), '界面主题切换功能缺失');
  assert(html.includes('id="editor-find"') && html.includes('replaceEditorFindAll') && html.includes("e.key==='F3'"), '编辑器快捷键查找替换功能缺失');
  assert(html.includes("e.code === 'Space'") && html.includes('普通输入不主动弹补全'), '代码补全未限制为手动触发');
  assert(html.includes('id="sym-ai-submit"') && html.includes('submitAiSearch') && html.includes('data-search-mode="symbol"'), 'AI 搜索或原项目符号检索入口缺失');
  assert(html.includes('id="ai-search-provider"') && html.includes('id="ai-search-key"') && html.includes('/api/ai/web-search'), '实时联网搜索配置缺失');
  assert(html.includes('data-search-mode="history"') && html.includes('AI_SEARCH_HISTORY_KEY') && html.includes('renderAiSearchHistory') && html.includes('清空记录'), 'AI 搜索记录功能缺失');
  assert(html.includes('id="draw-nd-type"') && html.includes('id="drawio-root"') && html.includes('DRAWIO_ORIGIN') && html.includes('onDrawioMessage'), 'Draw.io 新建入口或嵌入编辑器缺失');
  assert(html.includes("typeBadge.className = 'draw-type draw-type--' + kind") && html.includes("? 'Draw.io' : 'Excalidraw'"), '绘图列表缺少明确且隔离样式的类型标识');
  assert(html.includes('id="draw-ai-btn"') && html.includes('id="draw-xml-source"') && html.includes('generateDrawioWithAi') && html.includes('validateDrawioXmlLocal'), 'Draw.io AI 绘图或 XML 编辑器缺失');
  assert(html.includes('timeoutMs:300000') && html.includes('复杂图可能需要 1–5 分钟') && serverSource.includes('Math.min(600000') && serverSource.includes("e.name === 'TimeoutError'"), 'Draw.io AI 绘图长耗时请求或超时提示缺失');
  assert(html.includes('networkError:true') && html.includes('后端返回了无法解析的响应') && serverSource.includes("require('saxes')"), '全局 API 错误处理或服务端 XML 解析器缺失');
  assert((launchers.match(/node_modules[\\/]saxes/g) || []).length === 4, '启动脚本未完整检测新增运行依赖');
  assert((launchers.match(/node_modules[\\/]pdfjs-dist/g) || []).length === 4, '启动脚本未完整检测 PDF 文本解析依赖');
  assert(html.includes('id="editor-drop-overlay"') && html.includes('split-editor-group') && html.includes('initEditorGroups') && html.includes('application/x-codescope-editor'), '2 至 4 栏拖拽编辑功能缺失');
  assert(html.includes('data-search-mode="text"') && html.includes('renderTextResults') && html.includes('id="text-regex"'), '全文搜索或正则检索功能缺失');
  assert(html.includes('data-search-mode="file"') && html.includes('renderFileResults') && html.includes("key==='p'"), '快速打开文件功能缺失');
  assert(html.includes('id="btn-nav-back"') && html.includes('navigateHistory') && html.includes('NAV_BACK_STACK'), '代码位置导航历史功能缺失');
  assert(html.includes('id="definition-peek"') && html.includes('openDefinitionPeek') && html.includes('if(e.altKey)openDefinitionPeek'), '定义预览功能缺失');
  assert(html.includes('definitionModifier') && html.includes('goToFocusedDefinition') && html.includes('updateDefinitionHover') && html.includes('未找到 “'), 'VS Code 式跳转定义交互缺失');
  assert(html.includes('DEFINITION_HOVER_TIMER') && html.includes('editorTokenAtPoint') && html.includes('definition-hover-signature') && html.includes('},550)'), '函数与类型的延迟悬停定义卡片缺失');
  assert(html.includes('DEFINITION_HOVER_INTERACTING') && html.includes('scheduleDefinitionHoverHide') && html.includes('overscroll-behavior:contain') && html.includes('from+120'), '悬停定义卡片缺少鼠标移入、滚动或长定义查看能力');
  assert(html.includes('/api/lsp/query') && html.includes('enrichDefinitionHover') && serverSource.includes("require('./lib/lsp-service')"), '通用 LSP 服务或悬停信息接入缺失');
  assert(html.includes('id="btn-pair-switch"') && html.includes('pairedCodeFile') && html.includes("key==='o'"), '头文件与源文件快速切换功能缺失');
  assert(html.includes('#pane-git, #pane-tags, #pane-draw, #pane-reading { flex:0 1 auto; min-height:37px; }') && html.includes('#pane-tree { min-height:96px; }') && html.includes('#pane-draw, #pane-reading { min-height:108px; }'), '左侧多面板在低高度窗口中缺少自适应收缩');
  assert(html.includes('id="pane-reading"') && html.includes('id="reading-workspace"') && html.includes('application/x-codescope-reading') && html.includes('拖到阅读区右侧新建一栏'), 'PDF 阅读项目或拖拽片段组合入口缺失');
  assert(html.includes('translateReadingSelection') && html.includes('translateReadingPage') && html.includes('translateReadingAll') && html.includes('renderReadingFragments'), 'PDF AI 翻译或片段管理功能缺失');
  assert(html.includes('openReadingProject') && html.includes('addReadingProjectFragment') && html.includes('/api/readings/text-fragment') && html.includes('已匹配中文 PDF'), '阅读项目、多类型片段或中文版 PDF 自动配对功能缺失');
  assert(html.includes('<option value="source">可选文本</option>') && html.includes('requireSelectableReadingText') && html.includes('已切换到“可选文本”'), 'PDF 选段翻译或摘录缺少可读取文本模式');
  assert(html.includes('readingPdfVersions') && html.includes("versions.translation?'中文 PDF':'AI 中文译文'") && html.includes("versions.bilingual?'双语 PDF':'双语对照'") && html.includes('translatedDoc.pages'), 'PDF 视图切换未优先使用项目内已有中文或双语版本');
  assert(html.includes('id="reading-fragments-resizer"') && html.includes('mc-reading-fragments-width') && html.includes('finishFragmentResize'), '阅读片段面板缺少横向拖拽调整宽度能力');
  assert(html.includes('id="reading-project-tabs"') && html.includes('reading-project-tab') && html.includes('renderReadingProjectTabs') && html.includes('＋ 片段'), '阅读项目缺少代码式片段标签、新建入口或拖拽组合能力');
  assert(html.includes('id="reading-new-library-folder"') && html.includes('createReadingFolder') && html.includes('editReadingProjectMeta') && html.includes('reading-project-tag'), '阅读项目缺少文件夹、说明或标签管理能力');
  assert(!html.includes('id="reading-one"') && !html.includes('id="reading-two"') && html.includes('id="reading-new-column-drop"') && html.includes('updateReadingColumnLayout') && html.includes('closeReadingColumn'), '阅读工作区仍依赖固定单/双栏按钮或缺少拖拽自动分栏');
  assert(html.includes('id="reading-new-dialog"') && html.includes('submitReadingNewFragment') && html.includes('<option value="latex">LaTeX') && html.includes('<option value="python">Python'), '阅读项目缺少统一的 PDF、文档与代码片段新建窗口');
  assert(serverSource.includes("'/api/readings/node/move'") && html.includes('application/x-codescope-reading-node'), '阅读文件夹或项目缺少拖拽调整层级能力');
  assert(html.includes('html[data-theme] .split-editor-input') && html.includes("classList.toggle('plain',!exact)"), '多栏编辑器高亮层遮挡修复或纯文本降级缺失');
  assert(html.includes('withActiveSplitContext') && html.includes('activateSplitReading') && html.includes('activateOpenSplitLocation'), '右侧阅读面板未跟随多栏编辑器焦点');
  assert(html.includes('if(multi)applySplitRatios()') && /applyMdView\(\);\s*if\(multi\)applySplitRatios/.test(html), '多栏退出后 Markdown/LaTeX 预览恢复逻辑缺失');
  assert(html.includes('rel-link-halo') && html.includes('node-icon') && html.includes('rel-map-summary') && html.includes('no-upstream') && html.includes('wireSide') && html.includes('markerUnits="userSpaceOnUse"') && html.includes('M.65,.55 L4.6,2.5 L.65,4.45 Z') && html.includes('fill="var(--ok)"') && html.includes(" C'+"), '关系图自适应拓扑、视觉层级或小型实心箭头优化缺失');
  assert(html.includes('id="remote-resizer-y"') && html.includes('id="remote-folder-upload"') && html.includes('id="remote-folder-download"'), '远程窗口高度拖拽或文件夹传输入口缺失');

  const icon = await fetch(baseUrl + '/assets/codescope.svg');
  assert(icon.ok && (icon.headers.get('content-type') || '').includes('image/svg+xml'), '品牌图标无法加载');

  const snippets = await requestJson(baseUrl, '/api/snippets');
  assert(snippets.vault === vault && snippets.snippets.length === 1, '片段接口返回异常');

  const readingFolder = await postJson(baseUrl, '/api/readings/folder', { name:'Research', parent:'' });
  assert(readingFolder.ok && readingFolder.path === 'Research', '阅读文库文件夹创建失败');
  const readingProject = await postJson(baseUrl, '/api/readings/project/new', { name:'Papers', parent:'Research', description:'机器人论文资料', tags:'机器人，强化学习' });
  assert(readingProject.ok && readingProject.path === 'Research/Papers' && readingProject.meta.tags.length === 2, '嵌套阅读项目、说明或标签创建失败');
  const updatedProjectMeta = await postJson(baseUrl, '/api/readings/project/meta', { project:'Research/Papers', description:'机器人与控制论文', tags:['机器人','控制'] });
  assert(updatedProjectMeta.ok && updatedProjectMeta.meta.description === '机器人与控制论文' && updatedProjectMeta.meta.tags.includes('控制'), '阅读项目说明或标签更新失败');
  const archiveFolder = await postJson(baseUrl, '/api/readings/folder', { name:'Archive', parent:'' });
  const movedProject = await postJson(baseUrl, '/api/readings/node/move', { type:'project', path:'Research/Papers', toFolder:'Archive' });
  const restoredProject = await postJson(baseUrl, '/api/readings/node/move', { type:'project', path:'Archive/Papers', toFolder:'Research' });
  const deletedArchive = await postJson(baseUrl, '/api/readings/folder/delete', { folder:'Archive' });
  assert(archiveFolder.ok && movedProject.ok && movedProject.path === 'Archive/Papers' && restoredProject.ok && restoredProject.path === 'Research/Papers' && deletedArchive.ok, '阅读项目拖拽调整文件夹层级失败');
  const nestedReadingFolder = await postJson(baseUrl, '/api/readings/folder', { name:'归档', parent:'Research' });
  const renamedReadingFolder = await postJson(baseUrl, '/api/readings/folder/rename', { folder:nestedReadingFolder.path, name:'已读' });
  const deletedReadingFolder = await postJson(baseUrl, '/api/readings/folder/delete', { folder:renamedReadingFolder.path });
  assert(nestedReadingFolder.ok && renamedReadingFolder.ok && renamedReadingFolder.path === 'Research/已读' && deletedReadingFolder.ok, '嵌套阅读文件夹创建、重命名或删除失败');
  const readingInfo = Buffer.from(JSON.stringify({ name:'paper.pdf', folder:'Research/Papers' })).toString('base64');
  const readingUploadResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/pdf','X-CodeScope-Reading':readingInfo}, body:samplePdf('Hello research paper') });
  const readingUpload = await readingUploadResponse.json();
  assert(readingUploadResponse.ok && readingUpload.ok && readingUpload.path === 'Research/Papers/paper.pdf', 'PDF 流式导入失败');
  const chineseInfo = Buffer.from(JSON.stringify({ name:'paper_中文.pdf', folder:'Research/Papers' })).toString('base64');
  const chineseResponse = await fetch(baseUrl + '/api/readings/upload-stream', { method:'POST', headers:{'Content-Type':'application/pdf','X-CodeScope-Reading':chineseInfo}, body:samplePdf('Chinese paper') });
  const chineseUpload = await chineseResponse.json();
  assert(chineseResponse.ok && chineseUpload.ok, '中文版 PDF 导入失败');
  const note = await postJson(baseUrl, '/api/readings/text/new', { project:'Research/Papers', name:'阅读笔记.md' });
  assert(note.ok && note.kind === 'markdown', '阅读项目 Markdown 片段创建失败');
  const savedNote = await postJson(baseUrl, '/api/readings/text-fragment', { path:note.path, content:'# 结论\n\n测试笔记' });
  const openedNote = await requestJson(baseUrl, '/api/readings/text-fragment?path=' + encodeURIComponent(note.path));
  assert(savedNote.ok && openedNote.ok && /测试笔记/.test(openedNote.content), '阅读项目文本片段读写失败');
  const readingTree = await requestJson(baseUrl, '/api/readings/tree');
  const researchFolder = readingTree.root.children.find((item) => item.path === 'Research');
  const paperProject = researchFolder && researchFolder.children.find((item) => item.path === 'Research/Papers');
  assert(readingTree.ok && readingTree.total === 3 && researchFolder && researchFolder.type === 'folder' && paperProject && paperProject.count === 3 && paperProject.description === '机器人与控制论文' && paperProject.tags.includes('控制') && paperProject.children.every((item) => item.project === 'Research/Papers') && paperProject.children.some((item) => item.role === 'original') && paperProject.children.some((item) => item.role === 'translation') && paperProject.children.some((item) => item.kind === 'markdown'), '阅读文件夹、项目元数据或多类型片段聚合异常');
  const readingText = await requestJson(baseUrl, '/api/readings/text?path=' + encodeURIComponent(readingUpload.path));
  assert(readingText.ok && readingText.pageCount === 1 && /Hello research paper/.test(readingText.pages[0]), 'PDF 页级文本提取失败');
  const readingMeta = await postJson(baseUrl, '/api/readings/meta', { path:readingUpload.path, meta:{ page:1, view:'bilingual', translations:{1:'你好，研究论文'}, fragments:[{id:'f1',page:1,source:'research paper',translation:'研究论文',note:'术语'}] } });
  assert(readingMeta.ok && readingMeta.meta.view === 'bilingual' && readingMeta.meta.fragments.length === 1, 'PDF 译文或片段记录保存失败');
  const readingRange = await fetch(baseUrl + '/api/readings/file?path=' + encodeURIComponent(readingUpload.path), { headers:{Range:'bytes=0-4'} });
  assert(readingRange.status === 206 && await readingRange.text() === '%PDF-', 'PDF Range 分段读取失败');
  const readingRename = await postJson(baseUrl, '/api/readings/rename', { path:readingUpload.path, name:'renamed.pdf' });
  assert(readingRename.ok && readingRename.path === 'Research/Papers/renamed.pdf', 'PDF 重命名失败');
  const readingMetaAfterRename = await requestJson(baseUrl, '/api/readings/meta?path=' + encodeURIComponent(readingRename.path));
  assert(readingMetaAfterRename.ok && readingMetaAfterRename.meta.translations['1'] === '你好，研究论文', 'PDF 重命名后译文记录丢失');

  const newDrawio = await postJson(baseUrl, '/api/drawings/new', { name: 'Smoke Drawio', dir: '', kind: 'drawio' });
  assert(newDrawio.ok && newDrawio.kind === 'drawio' && newDrawio.name.endsWith('.drawio') && newDrawio.xml.includes('<mxfile'), 'Draw.io 文件创建失败');
  const openedDrawio = await requestJson(baseUrl, '/api/drawings/get?name=' + encodeURIComponent(newDrawio.name));
  assert(openedDrawio.ok && openedDrawio.kind === 'drawio' && openedDrawio.xml.includes('<mxGraphModel'), 'Draw.io 文件读取失败');
  const changedDrawioXml = '<mxfile host="CodeScope"><diagram id="smoke" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="smoke" vertex="1" parent="1"/></root></mxGraphModel></diagram></mxfile>';
  const validatedDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml: changedDrawioXml });
  assert(validatedDrawio.ok && validatedDrawio.format === 'uncompressed' && validatedDrawio.cells === 3, 'Draw.io XML 结构校验失败');
  const invalidReferenceDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml:'<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" edge="1" parent="1" source="missing"/></root></mxGraphModel>' });
  assert(!invalidReferenceDrawio.ok && /不存在/.test(invalidReferenceDrawio.error), 'Draw.io XML 校验未识别失效引用');
  const savedDrawio = await postJson(baseUrl, '/api/drawings/save', { name: newDrawio.name, data: { xml: changedDrawioXml } });
  assert(savedDrawio.ok && savedDrawio.bytes === changedDrawioXml.length, 'Draw.io XML 保存失败');
  const reopenedDrawio = await requestJson(baseUrl, '/api/drawings/get?name=' + encodeURIComponent(newDrawio.name));
  assert(reopenedDrawio.ok && reopenedDrawio.xml === changedDrawioXml, 'Draw.io XML 保存后读取不一致');
  const drawingTree = await requestJson(baseUrl, '/api/drawings/tree');
  assert(drawingTree.ok && drawingTree.total === 1 && drawingTree.root.children.some((item) => item.path === newDrawio.name), '绘图树未包含 Draw.io 文件');
  const badDrawio = await postJson(baseUrl, '/api/drawings/save', { name: newDrawio.name, data: { xml: '<invalid/>' } });
  assert(!badDrawio.ok, 'Draw.io 保存接口未拒绝无效 XML');
  const malformedDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml:'<mxfile><diagram><mxGraphModel></diagram></mxfile>' });
  assert(!malformedDrawio.ok && /语法错误/.test(malformedDrawio.error), 'Draw.io XML 校验未拒绝标签结构损坏的文档');
  const nestedRootDrawio = await postJson(baseUrl, '/api/drawings/validate', { xml:'<wrapper><mxfile><diagram/></mxfile></wrapper>' });
  assert(!nestedRootDrawio.ok && /根节点/.test(nestedRootDrawio.error), 'Draw.io XML 校验未拒绝错误根节点');
  const deletedDrawio = await postJson(baseUrl, '/api/drawings/delete', { name: newDrawio.name });
  assert(deletedDrawio.ok, 'Draw.io 文件删除失败');

  const changedCode = 'int main(void) { return 1; }';
  const saved = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedCode });
  assert(saved.ok, '自动保存接口失败');
  const timeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(timeline.ok && timeline.entries.length === 1, '本地时间线未记录覆盖前版本');
  const timelineItem = await requestJson(baseUrl, '/api/timeline/item?file=' + encodeURIComponent(snippetFile) + '&fragment=0&id=' + encodeURIComponent(timeline.entries[0].id));
  assert(timelineItem.ok && timelineItem.diff.includes('return 0') && timelineItem.diff.includes('return 1'), '时间线差异内容不正确');
  const unchanged = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedCode });
  assert(unchanged.ok && unchanged.unchanged, '相同内容保存不应重复写入时间线');
  const changedAgain = 'int main(void) { /* one edit session */ return 2; }';
  const savedAgain = await postJson(baseUrl, '/api/save', { file: snippetFile, fragment: 0, code: changedAgain });
  assert(savedAgain.ok, '连续自动保存失败');
  const compactTimeline = await requestJson(baseUrl, '/api/timeline?file=' + encodeURIComponent(snippetFile) + '&fragment=0');
  assert(compactTimeline.entries.length === 1 && compactTimeline.entries[0].id === timeline.entries[0].id, '一次连续编辑被错误拆成多个时间线版本');
  const compactItem = await requestJson(baseUrl, '/api/timeline/item?file=' + encodeURIComponent(snippetFile) + '&fragment=0&id=' + encodeURIComponent(compactTimeline.entries[0].id));
  assert(compactItem.diff.includes('return 0') && compactItem.diff.includes('return 2'), '合并后的时间线没有保留编辑会话起点');

  const git = await requestJson(baseUrl, '/api/git');
  const changedPath = path.relative(tempRoot, snippetFile).split(path.sep).join('/');
  assert(git.ok && git.changes.some((item) => item.path === changedPath), 'Git 状态未识别保存后的文件变化');
  const diff = await requestJson(baseUrl, '/api/git/diff?path=' + encodeURIComponent(changedPath));
  assert(diff.ok && diff.additions === 1 && diff.deletions === 1 && diff.diff.includes('return 2'), 'Git Diff 内容不正确');

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
  const lspStatus = await requestJson(baseUrl, '/api/lsp/status');
  assert(lspStatus.ok && lspStatus.servers.some((item) => item.command === 'clangd' && item.languages.includes('c_cpp')), 'LSP 环境状态接口异常');
  if (lspStatus.servers.some((item) => item.command === 'clangd' && item.available)) {
    const lspHover = await postJson(baseUrl, '/api/lsp/query', { file:snippetFile, fragment:0, code:'int main(void) { return 0; }', action:'hover', line:1, column:5 });
    assert(lspHover.ok && lspHover.server === 'clangd' && lspHover.hover && /main/.test(lspHover.hover.markdown), 'clangd 悬停信息查询失败');
  }

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
  const malformedJsonResponse = await fetch(baseUrl + '/api/ai/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{' });
  const malformedJson = await malformedJsonResponse.json();
  assert(malformedJsonResponse.status === 400 && !malformedJson.ok && /JSON/.test(malformedJson.error), '服务端未明确拒绝损坏的 JSON 请求');
  const unicodeBody = Buffer.from(JSON.stringify({ provider:'tavily', key:'', query:'中文检索' }));
  const unicodeAt = unicodeBody.indexOf(Buffer.from('中'));
  const chunkedJson = await postChunkedJson(baseUrl, '/api/ai/web-search', [unicodeBody.subarray(0, unicodeAt + 1), unicodeBody.subarray(unicodeAt + 1)]);
  assert(chunkedJson.status === 400 && /Key/.test(chunkedJson.data.error), '服务端无法正确解析跨网络分片的 UTF-8 JSON');

  console.log(`CodeScope smoke tests: ${passed} passed`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
}).finally(() => {
  if (child && child.exitCode === null) child.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
