/* SPDX-License-Identifier: GPL-3.0-or-later */
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const metadata = `// ==UserScript==
// @name         ChatGPT Queue · Accent
// @namespace    local.chatgpt-queue-accent
// @version      1.8.0
// @description  ChatGPT 消息队列、会话全宽与 Obsidian 问答归档，跟随当前 Accent color。
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
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @grant        unsafeWindow
// @license      GPL-3.0-or-later
// ==/UserScript==
// UI inspired by kgruiz/chatgpt-queue (GPL-3.0).
// No external dependencies or private ChatGPT API requests.
`;
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const core = read('src/core.cjs').replace(/module\.exports = .*;\s*$/, '');
const app = read('src/browser.js');
const css = read('src/queue.css');
const notice = read('src/notice-card.js');
const archive = read('src/archive-core.cjs').replace(/if \(typeof module !== 'undefined'\) module\.exports = .*;\s*$/, '');
const archiveDom = read('src/archive-dom.js').replace(/if \(typeof module !== 'undefined'\) Object\.assign\(module\.exports, .*\);\s*$/, '');
const archiveBrowser = read('src/archive-browser.js').replace(/if \(typeof module !== 'undefined'\) Object\.assign\(module\.exports, .*\);\s*$/, '');
fs.writeFileSync(path.join(root, 'chatgpt-queue.user.js'), `${metadata}\n(() => {\n'use strict';\n${core}\nconst QUEUE_CSS = ${JSON.stringify(css)};\n${notice}\n${archive}\n${archiveDom}\n${archiveBrowser}\n${app}\n})();\n`);
console.log('Built chatgpt-queue.user.js');
