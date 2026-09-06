#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const projectRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codescope-browser-'));
const vault = path.join(tempRoot, 'vault');
let server, browser;

function browserExecutable() {
  if (process.env.CODESCOPE_BROWSER && fs.existsSync(process.env.CODESCOPE_BROWSER)) return process.env.CODESCOPE_BROWSER;
  const fixed = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? [path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')]
      : [];
  for (const candidate of fixed) if (fs.existsSync(candidate)) return candidate;
  if (process.platform !== 'win32') for (const command of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try { return execFileSync('which', [command], { encoding:'utf8', timeout:1500 }).trim(); } catch (_) {}
  }
  return '';
}

function freePort() {
  return new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(error=>error?reject(error):resolve(port));});});
}

async function waitForServer(url) {
  for(let i=0;i<60;i++){try{if((await fetch(url+'/api/version')).ok)return;}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}
  throw new Error('浏览器测试服务启动超时');
}

async function main() {
  const executablePath=browserExecutable();
  if(!executablePath){console.log('CodeScope browser smoke: skipped（未找到 Chrome/Chromium，可用 CODESCOPE_BROWSER 指定）');return;}
  fs.mkdirSync(path.join(vault,'code'),{recursive:true});
  fs.writeFileSync(path.join(vault,'code','reading.md'),`---
contents:
  - id: 1
    label: led.h
    language: c_cpp
  - id: 2
    label: led.c
    language: c_cpp
name: Reading Demo
description: browser regression
isDeleted: 0
tags:
---

## Fragment: led.h
\`\`\`c_cpp
typedef struct led led_t;
led_t *led_create(int pin);
\`\`\`

## Fragment: led.c
\`\`\`c_cpp
#include "led.h"
struct led { int pin; };
led_t *led_create(int pin) {
  static led_t value;
  value.pin = pin;
  return &value;
}
\`\`\`
`);
  const port=await freePort(),baseUrl='http://127.0.0.1:'+port;
  server=spawn(process.execPath,['server.js'],{cwd:projectRoot,env:{...process.env,CODESCOPE_HOST:'127.0.0.1',CODESCOPE_PORT:String(port),CODESCOPE_VAULT:vault,CODESCOPE_DATA_HOME:path.join(tempRoot,'data')},stdio:'ignore'});
  await waitForServer(baseUrl);
  browser=await chromium.launch({headless:true,executablePath,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(String(error.message||error)));
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.locator('.item').filter({hasText:'Reading Demo'}).click();
  await page.locator('#code-context-bar').waitFor({state:'visible'});
  if(!(await page.locator('#code-context-bar').innerText()).includes('led.h'))throw new Error('代码面包屑未显示当前文件');
  await page.locator('#outline-body .ol-item').filter({hasText:'led_create'}).first().click();
  if(!(await page.locator('#code-context-bar').innerText()).includes('ƒ led_create'))throw new Error('Sticky Scope 未跟随当前函数');
  if(await page.locator('#code-edit').isVisible())await page.locator('#btn-edit').click();
  const token=page.locator('#code span').filter({hasText:/^led_create$/}).first();
  await token.scrollIntoViewIfNeeded();await token.hover();await page.waitForTimeout(800);
  const card=page.locator('#definition-hover');await card.waitFor({state:'visible'});
  await card.hover();await page.waitForTimeout(350);
  if(!await card.isVisible())throw new Error('鼠标移入定义卡片后卡片消失');
  const pre=card.locator('pre');const before=await pre.evaluate(element=>element.scrollTop);await pre.hover();await page.mouse.wheel(0,120);const after=await pre.evaluate(element=>element.scrollTop);
  if((await pre.evaluate(element=>element.scrollHeight>element.clientHeight))&&after<=before)throw new Error('定义卡片无法使用滚轮滚动');
  const lspStatus=await page.locator('#lsp-diagnostics').innerText();
  if(executablePath&&fs.existsSync('/usr/bin/clangd')&&!/clangd|错误|警告/.test(lspStatus))throw new Error('clangd 状态未显示');
  if(await page.evaluate(()=>!!window.MarkmapLib))throw new Error('思维导图库不应在启动时加载');
  if(errors.length)throw new Error('浏览器运行错误：'+errors.join('；'));
  console.log('CodeScope browser smoke: passed');
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close().catch(()=>{});
  if(server&&server.exitCode===null)server.kill();
  fs.rmSync(tempRoot,{recursive:true,force:true});
});
