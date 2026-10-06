/* SPDX-License-Identifier: GPL-3.0-or-later */
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const metadata = `// ==UserScript==
// @name         ChatGPT Queue · Accent
// @namespace    local.chatgpt-queue-accent
// @version      1.5.4
// @description  ChatGPT 消息队列与会话全宽：逐条发送、编辑排序、暂停恢复，跟随当前 Accent color。
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @noframes
// @updateURL    none
// @downloadURL  none
// @sandbox      JavaScript
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @license      GPL-3.0-or-later
// ==/UserScript==
// UI inspired by kgruiz/chatgpt-queue (GPL-3.0).
// No external dependencies or private ChatGPT API requests.
`;
const core = fs.readFileSync(path.join(root, 'src/core.cjs'), 'utf8').replace(/module\.exports = .*;\s*$/, '');
const app = fs.readFileSync(path.join(root, 'src/browser.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/queue.css'), 'utf8');
fs.writeFileSync(path.join(root, 'chatgpt-queue.user.js'), `${metadata}\n(() => {\n'use strict';\n${core}\nconst QUEUE_CSS = ${JSON.stringify(css)};\n${app}\n})();\n`);
console.log('Built chatgpt-queue.user.js');
