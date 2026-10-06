/* SPDX-License-Identifier: GPL-3.0-or-later */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../src/core.cjs');

function fixture(html) {
  const dom = new JSDOM(html || `<main><article data-testid="conversation-turn-0"><div data-message-author-role="user" data-message-id="u0">start</div></article><article data-testid="conversation-turn-1"><div data-message-author-role="assistant" data-message-id="a0">done</div><button data-testid="copy-turn-action-button">Copy</button></article><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">Send</button></form></main>`, { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  const w = dom.window;
  w.module = { exports: {} }; w.process = {}; w.normalize = core.normalize; w.emptyState = core.emptyState;
  w.QUEUE_CSS = fs.readFileSync(path.join(__dirname, '../src/queue.css'), 'utf8');
  w.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 10 }]; };
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  w.eval(fs.readFileSync(path.join(__dirname, '../src/browser.js'), 'utf8'));
  const adapter = new w.module.exports.ChatGPTAdapter('test');
  return { w, adapter, close: () => w.close(), ...w.module.exports, Panel: w.module.exports.QueuePanel, Layout: w.module.exports.WideLayout };
}

// Semantic attributes observed in the logged-in October 2026 Firefox page.
const MODERN = `<aside style="width:320px">sidebar</aside><main><div data-request-input-activity-root>
<div data-turn-key="turn0"><div data-content-search-turn-key="fallback-turn-0">
<div data-content-search-unit-key="fallback-turn-0:0:user"><div data-user-message-bubble><div data-search-result-target>start</div></div><button aria-label="Copy message">Copy message</button></div>
<div data-content-search-unit-key="fallback-turn-0:2:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-markdown-text-style="assistant-message">done</div></div>
<div class="turn-action-controls"><button aria-label="Copy"></button><button aria-label="Regenerate response"></button></div>
</div></div><div class="max-w-(--thread-body-max-width)" style="--thread-content-max-width:48rem"><form data-chatgpt-composer><div class="ProseMirror" contenteditable="true" role="textbox"></div><button type="button" aria-label="Send"></button></form></div>
</div></main>`;
test('current completed turn is recognized, a new unanswered user turn is not', () => {
  const f = fixture(); assert.equal(f.adapter.snapshot().complete, true);
  const user = f.w.document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.textContent = 'new';
  f.w.document.querySelector('form').before(user);
  assert.equal(f.adapter.snapshot().complete, false); f.close();
});
test('stop button overrides completion controls', () => {
  const f = fixture(); f.w.document.querySelector('[data-testid="send-button"]').dataset.testid = 'stop-button';
  assert.equal(f.adapter.snapshot().busy, true); assert.equal(f.adapter.snapshot().complete, false); f.close();
});
test('disabled send button on empty editor does not mean busy', () => {
  const f = fixture(); f.w.document.querySelector('button[data-testid="send-button"]').disabled = true;
  assert.equal(f.adapter.snapshot().busy, false); assert.equal(f.adapter.snapshot().ready, true); f.close();
});
test('writing textarea dispatches the native input event', () => {
  const f = fixture(); let count = 0;
  f.adapter.editor().addEventListener('input', () => count++); f.adapter.write('line one\nline two');
  assert.equal(f.adapter.text(), 'line one\nline two'); assert.equal(count, 1); f.close();
});

test('rich editor writes to the visible composer after SPA retains a hidden editor', () => {
  const f = fixture(`<main><form data-chatgpt-composer><div hidden id="old" class="ProseMirror" contenteditable="true" role="textbox">old draft</div></form><form data-chatgpt-composer><div id="current" class="ProseMirror" contenteditable="true" role="textbox"></div></form></main>`);
  const old = f.w.document.getElementById('old'), current = f.w.document.getElementById('current');
  const dispatched = [];
  for (const node of [old, current]) {
    node.pmViewDesc = { view: {
      state: { schema: { nodeFromJSON: value => value }, doc: { content: { size: 0 } },
        tr: { replaceWith: (_from, _to, doc) => doc } },
      dispatch(content) {
        dispatched.push(node.id);
        node.textContent = content.map(p => (p.content || []).map(t => t.text).join('')).join('\n');
      },
    } };
  }
  assert.equal(f.adapter.editor(), current);
  f.adapter.write('next round');
  assert.deepEqual(dispatched, ['current']);
  assert.equal(current.textContent, 'next round');
  assert.equal(old.textContent, 'old draft'); f.close();
});
test('click sends once and acknowledges the new user message', async () => {
  const f = fixture(); let clicks = 0, intents = 0;
  f.adapter.sendButton().addEventListener('click', () => {
    clicks++; const node = f.w.document.createElement('div'); node.dataset.messageAuthorRole = 'user'; node.dataset.messageId = 'u1'; node.textContent = 'next';
    f.w.document.querySelector('form').before(node); f.adapter.editor().value = '';
  });
  const key = await f.adapter.send('next', f.adapter.snapshot(), () => true, () => intents++);
  assert.equal(key, 'u1'); assert.equal(clicks, 1); assert.equal(intents, 1); f.close();
});
test('an existing draft is never overwritten', async () => {
  const f = fixture(); f.adapter.editor().value = 'mine';
  await assert.rejects(f.adapter.send('next', f.adapter.snapshot(), () => true, () => {}));
  assert.equal(f.adapter.text(), 'mine'); f.close();
});
test('route change is an explicit error', () => {
  const f = fixture(); f.w.history.replaceState(null, '', '/c/other'); assert.ok(f.adapter.snapshot().error); f.close();
});
test('queue renders plain text without creating any message editor', () => {
  const f = fixture(); const panel = new f.Panel({}); f.w.document.body.append(panel.host);
  const engine = { state: { ...core.emptyState(), items: [{ id: 'a', text: '<img src=x onerror=alert(1)>' }] }, status: 'paused' };
  panel.render(engine, true); assert.equal(panel.root.querySelectorAll('img').length, 0);
  assert.equal(panel.root.querySelector('.message').textContent, engine.state.items[0].text);
  assert.equal(panel.root.querySelectorAll('textarea,input,[contenteditable]').length, 0); f.close();
});

test('native enqueue shortcut respects IME, regular Enter, and other text fields', () => {
  const f = fixture(MODERN); let count = 0; const editor = f.adapter.editor();
  const child = f.w.document.createElement('p'); editor.append(child);
  f.w.document.addEventListener('keydown', e => f.enqueueShortcut(e, editor, () => count++), true);
  const key = (target, options) => target.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options }));
  key(child, { ctrlKey: true, isComposing: true }); key(child, {}); key(f.w.document.body, { ctrlKey: true });
  assert.equal(count, 0); assert.equal(key(child, { ctrlKey: true }), false);
  assert.equal(count, 1); f.close();
});

function nativeQueueFixture() {
  const f = fixture(); const engine = new core.QueueEngine({ adapter: f.adapter, save: () => {} });
  return { ...f, engine, input: new f.NativeQueueInput(engine, f.adapter) };
}

test('shortcut hint stays visible before enqueue and after clearing while empty list and actions hide', () => {
  const f = nativeQueueFixture(), panel = new f.Panel({}); f.w.document.body.append(panel.host);
  const hint = panel.root.querySelector('.hint');
  assert.equal(panel.host.hidden, false); assert.equal(hint.textContent, 'Ctrl + Enter  Enqueue');
  panel.render(f.engine, true); assert.equal(panel.host.hidden, false);
  assert.equal(panel.list.hidden, true); assert.equal(panel.queueActions.hidden, true);
  assert.equal(hint.closest('[hidden]'), null);
  assert.equal(panel.root.querySelector('.status,.toggle,.bar'), null);
  f.engine.add('pending'); panel.render(f.engine, true);
  assert.equal(panel.host.hidden, false); assert.equal(panel.root.querySelector('.message').textContent, 'pending');
  assert.equal(panel.list.hidden, false); assert.equal(panel.queueActions.hidden, true);
  assert.equal([...panel.root.querySelectorAll('button')].some(x => x.textContent === '加入队列'), false);
  assert.equal(hint.closest('[hidden]'), null);
  assert.equal(/已暂停|请输入要排队的消息/.test(panel.root.textContent), false);
  assert.equal([...panel.root.querySelectorAll('button')].some(x => /会话全宽|运行队列/.test(x.textContent)), false);
  f.engine.remove(f.engine.state.items[0].id); panel.render(f.engine, true);
  assert.equal(panel.host.hidden, false); assert.equal(panel.root.querySelector('.row'), null);
  assert.equal(panel.list.hidden, true); assert.equal(panel.queueActions.hidden, true);
  assert.equal(hint.closest('[hidden]'), null); f.close();
});

test('empty native enqueue has no validation text and leaves the composer untouched', () => {
  const f = nativeQueueFixture(); assert.doesNotThrow(() => f.input.capture());
  assert.equal(f.engine.state.items.length, 0); assert.equal(f.adapter.text(), ''); f.close();
});

test('full width defaults on and settings save, reopen, and sync an explicit off choice', () => {
  const f = fixture(MODERN), layout = new f.Layout(); layout.update(f.adapter);
  assert.equal(layout.enabled, true); assert.ok(f.w.document.querySelector('[data-cq-wide-root]'));
  let value, menuName, open;
  f.w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  f.w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const settings = new f.QueueSettings({
    read: () => value ?? true, write: enabled => { value = enabled; },
    apply: enabled => { layout.enabled = enabled; layout.update(f.adapter); },
    register: (name, callback) => { menuName = name; open = callback; },
  });
  assert.match(menuName, /设置/); assert.equal(f.w.document.getElementById('chatgpt-queue-settings'), null);
  open(); assert.equal(settings.checkbox.checked, true); assert.equal(settings.dialog.open, true);
  settings.checkbox.checked = false; settings.checkbox.dispatchEvent(new f.w.Event('change'));
  assert.equal(value, false); assert.equal(layout.enabled, false); assert.equal(f.w.document.querySelector('[data-cq-wide-root]'), null);
  settings.dialog.close(); open(); assert.equal(settings.checkbox.checked, false);
  settings.sync(true); assert.equal(settings.checkbox.checked, true);
  settings.dispose(); assert.equal(f.w.document.getElementById('chatgpt-queue-settings'), null); layout.dispose(); f.close();
});

test('enqueue shortcut transfers native text and clears the same original editor', () => {
  const f = nativeQueueFixture(), editor = f.adapter.editor();
  editor.value = 'first\nsecond';
  f.w.document.addEventListener('keydown', event => f.enqueueShortcut(event, editor, () => f.input.capture()), true);
  editor.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(f.engine.state.items[0].text, 'first\nsecond');
  assert.equal(f.engine.state.paused, false);
  assert.equal(f.adapter.editor(), editor); assert.equal(editor.value, ''); f.close();
});

test('busy Enter enqueues while Shift Enter and IME Enter retain native behavior', () => {
  const f = nativeQueueFixture(), editor = f.adapter.editor();
  f.w.document.addEventListener('keydown', e => f.enqueueShortcut(e, editor, () => f.input.capture(), true), true);
  editor.value = 'follow up';
  for (const options of [{ shiftKey: true }, { isComposing: true }, { altKey: true }]) {
    assert.equal(editor.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })), true);
    assert.equal(f.engine.state.items.length, 0);
  }
  assert.equal(editor.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), false);
  assert.equal(f.engine.state.items[0].text, 'follow up'); assert.equal(f.engine.state.paused, false); f.close();
});

test('native enqueue automatically waits for an answer and then dispatches without a run action', async () => {
  const f = nativeQueueFixture(); let busy = true, sent = [], clock = 0, userKey = 'initial';
  const snapshot = f.adapter.snapshot.bind(f.adapter);
  f.adapter.snapshot = () => ({ ...snapshot(), busy, complete: !busy, userKey });
  f.adapter.send = async (text, before, valid, click) => { assert.equal(valid(), true); click(); sent.push(text); busy = true; return userKey = 'sent'; };
  f.engine.now = () => clock;
  f.adapter.write('automatic'); f.input.capture();
  await f.engine.tick(); clock = 10000; await f.engine.tick(); assert.equal(sent.length, 0);
  busy = false; await f.engine.tick(); clock += 1200; await f.engine.tick();
  assert.deepEqual(sent, ['automatic']); f.close();
});

test('empty native shortcut continues a paused queue and the panel has no run button', () => {
  const f = nativeQueueFixture(); f.engine.add('pending');
  f.input.capture(); assert.equal(f.engine.state.paused, false);
  const panel = new f.Panel({}); panel.render(f.engine, true);
  assert.equal([...panel.root.querySelectorAll('button')].some(x => /运行队列|暂停队列/.test(x.textContent)), false); f.close();
});

test('editing uses the native composer and preserves queue identity and order', () => {
  const f = nativeQueueFixture(), first = f.engine.add('first'), second = f.engine.add('second');
  f.input.edit(first.id); assert.equal(f.adapter.text(), 'first'); assert.equal(f.engine.state.paused, true);
  f.adapter.write('edited'); f.input.capture();
  assert.equal(f.engine.state.items.length, 2); assert.equal(f.engine.state.items[0].id, first.id);
  assert.equal(f.engine.state.items[0].text, 'edited'); assert.equal(f.engine.state.items[1].id, second.id);
  assert.equal(f.input.editingId, null); assert.equal(f.adapter.text(), ''); f.close();
});

test('editing protects a native draft and cancelling retains draft and original item', () => {
  const f = nativeQueueFixture(), item = f.engine.add('original');
  f.adapter.write('my draft'); assert.throws(() => f.input.edit(item.id));
  assert.equal(f.adapter.text(), 'my draft'); f.adapter.write('');
  f.input.edit(item.id); f.adapter.write('unsaved edit'); f.input.cancel();
  assert.equal(f.adapter.text(), 'unsaved edit'); assert.equal(f.engine.state.items[0].text, 'original');
  assert.equal(f.input.editingId, null); f.close();
});

test('failed native clear rolls back an enqueue or edit without losing the native text', () => {
  const f = nativeQueueFixture(), item = f.engine.add('original');
  f.adapter.write('new'); const write = f.adapter.write.bind(f.adapter);
  f.adapter.write = () => { throw new Error('write failed'); };
  assert.throws(() => f.input.capture()); assert.equal(f.engine.state.items.length, 1);
  assert.equal(f.adapter.text(), 'new');
  f.adapter.write = write; f.adapter.write(''); f.input.edit(item.id); f.adapter.write('edited');
  f.adapter.write = () => { throw new Error('write failed'); };
  assert.throws(() => f.input.capture()); assert.equal(f.engine.state.items[0].text, 'original');
  assert.equal(f.adapter.text(), 'edited'); assert.equal(f.input.editingId, item.id); f.close();
});

test('modern composer and answer controls are recognized and user labels excluded', () => {
  const f = fixture(MODERN);
  assert.ok(f.adapter.editor()); assert.equal(f.adapter.composer().tagName, 'FORM');
  const s = f.adapter.snapshot(); assert.equal(s.userKey, 'turn0'); assert.equal(s.userText, 'start');
  assert.equal(s.complete, true); assert.equal(s.ready, true);
  f.adapter.sendButton().setAttribute('aria-label', 'Stop');
  assert.equal(f.adapter.snapshot().busy, true); assert.equal(f.adapter.snapshot().complete, false);
  f.close();
});

test('a copy button inside a code/table block is not answer completion', () => {
  const f = fixture(MODERN);
  f.w.document.querySelector('.turn-action-controls').remove();
  f.adapter.messages('assistant')[0].innerHTML += '<button aria-label="Copy">Copy code</button>';
  assert.equal(f.adapter.snapshot().complete, false); f.close();
});

test('message identity survives virtualization and fallback search key updates', () => {
  const f = fixture(MODERN);
  const user = f.adapter.messages('user')[0], before = f.adapter.key(user, 5);
  user.setAttribute('data-content-search-unit-key', 'server-turn:0:user');
  assert.equal(f.adapter.key(user, 1), before); f.close();
});

test('full width stays scoped to the thread and restores after disable or SPA remount', () => {
  const f = fixture(MODERN), d = f.w.document, layout = new f.Layout(true);
  const thread = d.querySelector('[data-request-input-activity-root]'), lane = d.querySelector('[class*="--thread-body-max-width"]');
  const oldStyle = lane.getAttribute('style'); layout.update(f.adapter);
  assert.ok(thread.hasAttribute('data-cq-wide-root'));
  assert.equal(d.querySelector('aside').hasAttribute('data-cq-wide-root'), false);
  const next = d.createElement('div'); next.setAttribute('data-request-input-activity-root', '');
  thread.replaceWith(next); next.append(thread.querySelector('form')); layout.update(f.adapter);
  assert.equal(thread.hasAttribute('data-cq-wide-root'), false); assert.ok(next.hasAttribute('data-cq-wide-root'));
  layout.enabled = false; layout.update(f.adapter);
  assert.equal(next.hasAttribute('data-cq-wide-root'), false); assert.equal(lane.getAttribute('style'), oldStyle);
  assert.equal(d.querySelector('aside').style.width, '320px');
  layout.dispose(); assert.equal(d.getElementById('chatgpt-queue-width'), null); f.close();
});
