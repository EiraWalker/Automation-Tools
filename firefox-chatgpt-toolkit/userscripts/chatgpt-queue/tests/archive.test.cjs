/* SPDX-License-Identifier: GPL-3.0-or-later */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const archive = require('../src/archive-core.cjs');
const core = require('../src/core.cjs');
const config = { ...archive.ARCHIVE_DEFAULTS, obsidianKey: 'fixture-obsidian', aiKey: 'fixture-ai' };
const snapshot = { mode: 'chat', conversation: 'fixture', answerId: 'answer-1', key: 'chat:fixture:answer-1', url: 'https://chatgpt.com/c/fixture', question: '原始问题', answer: '原始回答\n\n```js\nconst a = 1;\n```' };
function service({ failedDelete = false, mismatch = false } = {}) {
  const files = new Map(), mappings = new Map(), calls = [];
  const api = new archive.ArchiveService({ config, readMapping: key => mappings.get(key), writeMapping: (key, value) => mappings.set(key, structuredClone(value)), request: async options => {
    calls.push(options); const url = new URL(options.url), file = decodeURIComponent(url.pathname.replace(/^\/vault\//, ''));
    if (options.method === 'PUT') { files.set(file, options.data); return { status: 204, text: '' }; }
    if (options.method === 'DELETE') { if (failedDelete) return { status: 500, text: '' }; files.delete(file); return { status: 204, text: '' }; }
    return { status: files.has(file) ? 200 : 404, text: mismatch ? 'wrong' : files.get(file) || '' };
  } });
  return { api, files, mappings, calls, recover: () => { failedDelete = false; } };
}
function dom(markup, url = 'https://chatgpt.com/c/fixture') {
  const w = new JSDOM(markup, { url, runScripts: 'outside-only' }).window;
  w.module = { exports: {} }; w.process = {}; w.normalize = core.normalize; w.emptyState = core.emptyState; w.QUEUE_CSS = fs.readFileSync(path.join(__dirname, '../src/queue.css'), 'utf8');
  Object.assign(w, archive); w.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.eval(['notice-card.js', 'browser.js', 'archive-dom.js', 'archive-browser.js'].map(file => fs.readFileSync(path.join(__dirname, '../src/' + file), 'utf8')).join('\n'));
  return { w, ...w.module.exports, close: () => w.close() };
}
const markup = '<main><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="u0">问题一</div></article><article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="a0"><div class="markdown"><p>回答一</p></div></div><div class="actions"><button data-testid="copy-turn-action-button">Copy</button></div></article><article data-testid="conversation-turn-2"><div data-message-author-role="user" data-message-id="u1">问题二</div></article><article data-testid="conversation-turn-3"><div data-message-author-role="assistant" data-message-id="a1"><div class="markdown"><p>回答二</p></div></div><div class="actions"><button data-testid="copy-turn-action-button">Copy</button></div></article><form><textarea id="prompt-textarea"></textarea><button data-testid="stop-button">Stop</button></form></main>';

test('repeated save overwrites one record and title/folder changes move it', async () => {
  const f = service(); const first = await f.api.save(snapshot, { title: '标题一', folder: '目录', tags: ['标签'] });
  await f.api.save(snapshot, { title: '标题一', folder: '目录', tags: ['更新'] });
  assert.equal(f.files.size, 1); assert.match(f.files.get(first.path), /tags: \["更新"\]/);
  const moved = await f.api.save(snapshot, { title: '新标题', folder: '新目录', tags: [] });
  assert.equal(f.files.has(first.path), false); assert.equal(f.files.size, 1); assert.equal(f.files.has(moved.path), true);
});
test('new answer identity with the same title and text creates an independent note', async () => {
  const f = service(); await f.api.save(snapshot, { title: '相同', folder: '', tags: [] });
  await f.api.save({ ...snapshot, answerId: 'answer-2', key: 'chat:fixture:answer-2' }, { title: '相同', folder: '', tags: [] });
  assert.equal(f.files.size, 2);
});
test('verification mismatch never deletes the prior note or commits mapping', async () => {
  const f = service({ mismatch: true });
  await assert.rejects(f.api.save(snapshot, { title: 'test', tags: [] }), { code: 'A_SAVE_VERIFY' });
  assert.equal(f.mappings.size, 0); assert.equal(f.calls.some(call => call.method === 'DELETE'), false);
});
test('failed migration preserves cleanup state and a retry finishes without another note', async () => {
  const f = service({ failedDelete: true }); await f.api.save(snapshot, { title: 'old', tags: [] });
  await assert.rejects(f.api.save(snapshot, { title: 'new', tags: [] }), { code: 'A_OBSIDIAN_HTTP' });
  assert.equal(f.files.size, 2); assert.equal([...f.mappings.values()][0].pending.length, 1);
  f.recover(); await f.api.save(snapshot, { title: 'new', tags: [] }); assert.equal(f.files.size, 1); assert.deepEqual([...f.mappings.values()][0].pending, []);
});
test('a changed old file is retained and reported rather than deleting another record', async () => {
  const f = service(), old = await f.api.save(snapshot, { title: 'old', tags: [] }); f.files.set(old.path, 'unrelated');
  await assert.rejects(f.api.save(snapshot, { title: 'new', tags: [] }), { code: 'A_MOVE_SOURCE_CHANGED' }); assert.equal(f.files.get(old.path), 'unrelated');
});
test('folder validation keeps generated paths inside the vault', () => {
  for (const folder of ['../outside', 'a/../b', 'E:\\notes', '/absolute', '.obsidian/config', 'a/CON', 'a//b']) assert.throws(() => archive.archiveFolder(folder), { code: 'A_FOLDER_INVALID' });
  assert.equal(archive.archiveFolder('技术\\浏览器'), '技术/浏览器'); assert.deepEqual(archive.archiveTags('#Firefox, 技术/API'), ['Firefox', '技术/API']);
});
test('metadata values are quoted and original Markdown is preserved', () => {
  const text = archive.archiveMarkdown(snapshot, { title: '标题: "测试"', tags: ['技术/API'] });
  assert.match(text, /title: "标题: \\\"测试\\\""/); assert.ok(text.includes(snapshot.answer)); assert.match(text, /source: "https:\/\/chatgpt.com\/c\/fixture"/);
});
test('classification requests only chosen model, question/answer and folder/tag references', async () => {
  let body; const api = new archive.ArchiveService({ config, request: async options => { body = JSON.parse(options.data); return { status: 200, text: JSON.stringify({ choices: [{ message: { content: '{"title":"标题","folder":"技术","tags":["Firefox"]}' } }] }) }; } });
  const fields = await api.classify(snapshot, { folders: ['技术'], tags: ['Firefox'] });
  assert.equal(body.model, 'gemini-3.8-flash-high'); assert.equal(body.stream, false); assert.deepEqual(fields.tags, ['Firefox']);
  const input = JSON.parse(body.messages[1].content); assert.deepEqual(Object.keys(input).sort(), ['answer', 'folders', 'question', 'tags']);
});
test('bad AI output and unavailable API produce coded errors without credential contents', async () => {
  const api = new archive.ArchiveService({ config, request: async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: 'bad' } }] }) }) });
  await assert.rejects(api.classify(snapshot, { folders: [], tags: [] }), { code: 'A_AI_RESPONSE' });
  api.request = async () => { throw Error('fixture-obsidian'); };
  await assert.rejects(api.references(), error => error.code === 'A_OBSIDIAN_UNAVAILABLE' && !error.message.includes('fixture-obsidian'));
});
test('reference collection walks directories and supports the installed array tag contract', async () => {
  const paths = []; const api = new archive.ArchiveService({ config, request: async options => { const url = new URL(options.url); paths.push(url.pathname); const response = url.pathname === '/tags/' ? { tags: [{ name: '技术/API', count: 2 }] } : { files: url.pathname === '/vault/' ? ['技术/', '.obsidian/', 'a.md'] : url.pathname === '/vault/%E6%8A%80%E6%9C%AF/' ? ['浏览器/'] : [] }; return { status: 200, text: JSON.stringify(response) }; } });
  const references = await api.references(); assert.deepEqual(references.folders, ['技术', '技术/浏览器']); assert.deepEqual(references.tags, ['技术/API']); assert.equal(paths.includes('/vault/.obsidian/'), false);
});
test('Chat export pairs selected historical answer rather than latest, and disables only generating reply', t => {
  const f = dom(markup); t.after(f.close); const adapter = new f.ChatGPTAdapter('fixture'), reader = new f.ArchivePageAdapter(adapter), replies = reader.replies();
  assert.equal(reader.complete(replies[0]), true); assert.equal(reader.complete(replies[1]), false);
  const selected = reader.snapshot(replies[0]); assert.equal(selected.question, '问题一'); assert.equal(selected.answer, '回答一');
});
test('Work export obeys task completion rather than retained Copy controls', t => {
  const work = '<main><div data-content-search-turn-key="t0"><div data-content-search-unit-key="t0:user"><div data-user-message-bubble>question</div></div><div data-content-search-unit-key="t0:assistant"><div data-markdown-text-style="assistant-message">answer</div></div><div data-talvt-turn-state="working"></div><div class="turn-action-controls"><button aria-label="Copy"></button></div></div><form><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Work with Codex"></div></form></main>';
  const f = dom(work); t.after(f.close); const reader = new f.ArchivePageAdapter(new f.ChatGPTAdapter('fixture')), reply = reader.replies()[0];
  assert.equal(reader.complete(reply), false); f.w.document.querySelector('[data-talvt-turn-state]').setAttribute('data-talvt-turn-state', 'complete'); assert.equal(reader.snapshot(reply).answer, 'answer');
});
test('Codex final reply export excludes tool text and recognizes completion controls', t => {
  const codex = '<main><div data-content-search-turn-key="t0"><div data-content-search-unit-key="t0:u"><div data-user-message-bubble>question</div></div><div data-content-search-unit-key="t0:a"><div>tool log</div><div data-local-conversation-final-assistant="true"><div data-markdown-text-style="assistant-message"><p>final answer</p></div><div class="turn-action-controls"><button aria-label="Copy"></button><button aria-label="Rate response"></button></div></div></div></div><form><div data-composer-markdown data-codex-composer contenteditable="true" role="textbox"></div></form></main>';
  const f = dom(codex, 'https://chatgpt.com/local/fixture'); t.after(f.close); const reader = new f.ArchivePageAdapter(new f.ChatGPTAdapter('fixture')), reply = reader.replies()[0]; assert.equal(reader.snapshot(reply).answer, 'final answer');
});
test('Codex archive stays in its final-answer toolbar when the shared turn contains user controls', t => {
  const html = '<main><div data-content-search-turn-key="t0"><div data-content-search-unit-key="t0:u"><div data-user-message-bubble>question</div><div class="turn-action-controls" id="user-actions"><button aria-label="Copy message"></button></div></div><div data-content-search-unit-key="t0:a"><div data-local-conversation-final-assistant="true"><div data-markdown-text-style="assistant-message">answer</div><div class="turn-action-controls" id="answer-actions"><button aria-label="Copy"></button><button aria-label="Rate response"></button></div></div></div></div><form><div data-composer-markdown data-codex-composer contenteditable="true" role="textbox"></div></form></main>';
  const f = dom(html, 'https://chatgpt.com/local/fixture'); t.after(f.close);
  const adapter = new f.ChatGPTAdapter('fixture'), reader = new f.ArchivePageAdapter(adapter), reply = reader.replies()[0];
  assert.equal(reader.toolbar(reply).id, 'answer-actions');
  const controller = new f.ArchiveController({ adapter: () => adapter, read: (_key, fallback) => fallback, write: () => {} });
  controller.update(); assert.equal(f.w.document.querySelector('#user-actions [data-cq-archive-button]'), null); assert.ok(f.w.document.querySelector('#answer-actions [data-cq-archive-button]'));
  f.w.document.querySelector('#answer-actions [aria-label="Rate response"]').remove();
  f.w.document.querySelector('#user-actions').insertAdjacentHTML('beforeend', '<button aria-label="Rate response"></button>');
  assert.equal(reader.complete(reply), false); controller.dispose();
});
test('Markdown conversion preserves fenced code whitespace, formulas, tables and source links', t => {
  const f = dom('<div id="content"><p>Hello <strong>world</strong> <a href="https://example.org/">source</a></p><pre><code class="language-js">  a();\n\n\n\n  b();</code></pre><span class="katex"><annotation encoding="application/x-tex">a^2</annotation></span><table><tr><th>A</th><th>B</th></tr><tr><td>x|y</td><td>z</td></tr></table><button>Copy</button></div>'); t.after(f.close);
  const result = f.archiveToMarkdown(f.w.document.getElementById('content')); assert.ok(result.includes('  a();\n\n\n\n  b();')); assert.ok(result.includes('$a^2$')); assert.ok(result.includes('| x\\|y | z |')); assert.ok(result.includes('[source](https://example.org/)')); assert.equal(result.includes('Copy'), false);
});
test('button injection is idempotent and navigation disposes the prior preview and controls', t => {
  const f = dom(markup); t.after(f.close); let adapter = new f.ChatGPTAdapter('fixture');
  const controller = new f.ArchiveController({ adapter: () => adapter, read: (_key, fallback) => fallback, write: () => {} });
  controller.update(); controller.update(); assert.equal(f.w.document.querySelectorAll('[data-cq-archive-button]').length, 2);
  controller.preview = { dispose: () => { controller.disposedPreview = true; } };
  adapter = new f.ChatGPTAdapter('other'); controller.update(); assert.equal(controller.disposedPreview, true); assert.equal(f.w.document.querySelectorAll('[data-cq-archive-button]').length, 2); controller.dispose();
});
test('archive icon follows the native action color when toolbar inheritance has no contrast', t => {
  const f = dom(markup); t.after(f.close);
  const toolbar = f.w.document.querySelector('.actions'), native = toolbar.querySelector('button');
  toolbar.style.color = 'black'; native.style.color = 'rgb(175, 175, 175)';
  const controller = new f.ArchiveController({ adapter: () => new f.ChatGPTAdapter('fixture'), read: (_key, fallback) => fallback, write: () => {} });
  controller.update(); const host = toolbar.querySelector('[data-cq-archive-button]');
  assert.equal(f.w.getComputedStyle(host).color, f.w.getComputedStyle(native).color);
  native.style.color = 'rgb(93, 93, 93)'; controller.update();
  assert.equal(f.w.getComputedStyle(host).color, f.w.getComputedStyle(native).color); controller.dispose();
});
test('preview has only metadata fields, lets users manually save after AI failure, and cancellation writes nothing', async t => {
  const f = dom(markup); t.after(f.close); let writes = 0;
  const controller = new f.ArchiveController({ adapter: () => new f.ChatGPTAdapter('fixture'), read: (_key, fallback) => fallback, write: () => { writes++; } });
  controller.service = () => ({ references: async () => ({ folders: [], tags: [] }), classify: async () => { throw archive.archiveFailure('A_AI_RESPONSE', 'fixture failure'); }, save: async () => { writes++; return { path: 'note.md' }; } });
  await controller.open(f.w.document.querySelector('[data-message-id="a0"]'));
  assert.equal(controller.preview.root.querySelectorAll('input').length, 3); assert.equal(controller.preview.root.textContent.includes('回答一'), false); assert.equal(controller.preview.saveButton.disabled, false);
  controller.close(); assert.equal(writes, 0); controller.dispose();
});
test('late classification cannot overwrite edits or reopen a cancelled preview', async t => {
  const f = dom(markup); t.after(f.close); let resolve;
  const controller = new f.ArchiveController({ adapter: () => new f.ChatGPTAdapter('fixture'), read: (_key, fallback) => fallback, write: () => {} });
  controller.service = () => ({ references: async () => ({ folders: [], tags: [] }), classify: () => new Promise(r => { resolve = r; }) });
  const opened = controller.open(f.w.document.querySelector('[data-message-id="a0"]')); await new Promise(r => setImmediate(r));
  controller.preview.inputs.title.value = 'my edit'; controller.preview.inputs.title.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  resolve({ title: 'AI title', folder: '', tags: [] }); await opened; assert.equal(controller.preview.inputs.title.value, 'my edit');
  controller.close(); assert.equal(f.w.document.getElementById('chatgpt-archive-preview'), null); controller.dispose();
});
test('settings save API credentials locally and preserve the independent full-width choice', t => {
  const f = dom(markup); t.after(f.close); const values = new Map(); let width = false;
  const controller = new f.ArchiveController({ adapter: () => new f.ChatGPTAdapter('fixture'), read: (key, fallback) => values.get(key) || fallback, write: (key, value) => values.set(key, value) });
  const settings = new f.QueueSettings({ read: () => width, write: value => { width = value; }, apply: () => {}, register: () => {}, archive: controller });
  settings.open(); settings.archiveInputs.aiKey.value = 'fixture-secret'; settings.archiveInputs.obsidianKey.value = 'fixture-obsidian';
  assert.equal(settings.archiveInputs.aiKey.type, 'password'); assert.equal(settings.checkbox.checked, false);
  [...settings.dialog.querySelectorAll('button')].find(button => button.textContent === '保存配置').click();
  assert.equal(controller.config().aiKey, 'fixture-secret'); assert.equal(width, false); settings.open(); assert.equal(settings.archiveInputs.aiKey.value, 'fixture-secret'); settings.dispose(); controller.dispose();
});
test('unavailable Obsidian shows a top-right coded notice without writing a note', async t => {
  const f = dom(markup); t.after(f.close); let writes = 0;
  const controller = new f.ArchiveController({ adapter: () => new f.ChatGPTAdapter('fixture'), read: (key, fallback) => key === 'cq-accent-archive-config-v1' ? config : fallback, write: () => { writes++; }, request: async () => { throw Error('offline'); } });
  await controller.open(f.w.document.querySelector('[data-message-id="a0"]'));
  assert.equal(controller.toast.hidden, false); assert.equal(controller.toast.getAttribute('role'), 'alert'); assert.match(controller.toast.textContent, /A_OBSIDIAN_UNAVAILABLE/); assert.equal(writes, 0); controller.dispose();
});
test('user line breaks survive question extraction', t => {
  const f = dom(markup.replace('问题一</div>', '第一行\n第二行</div>')); t.after(f.close);
  const reader = new f.ArchivePageAdapter(new f.ChatGPTAdapter('fixture'));
  assert.equal(reader.snapshot(reader.replies()[0]).question, '第一行\n第二行');
});
