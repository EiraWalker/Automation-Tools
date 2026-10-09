/* SPDX-License-Identifier: GPL-3.0-or-later */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const core = require('../src/core.cjs');

// Semantic markup inspected in native Firefox on 2026-10-09.
const WORK = `<main><div data-turn-key="user0"><div data-content-search-turn-key="turn0">
<div data-content-search-unit-key="turn0:0:user"><div data-user-message-bubble>start</div><button aria-label="Copy message"></button></div>
<div data-talvt-turn-state="complete"><div data-local-conversation-final-assistant="true"><div data-content-search-unit-key="turn0:1:assistant"><div data-markdown-text-style="assistant-message">done</div></div></div><button aria-label="Copy"></button><button aria-label="Regenerate response"></button></div>
</div></div><form data-thread-find-composer="true"><div data-composer-markdown contenteditable="true" role="textbox" aria-label="Work with ChatGPT"></div><button type="submit" aria-label="Send"></button></form></main>`;
const CODEX = `<main><div data-content-search-turn-key="turn0">
<div data-content-search-unit-key="turn0:fco_user0"><div data-user-message-bubble>start</div></div>
<div data-local-conversation-final-assistant="true"><div data-content-search-unit-key="turn0:msg_answer0"><div data-markdown-text-style="assistant-message">done</div></div></div><button aria-label="Copy"></button><button aria-label="Rate response"></button>
</div><div data-codex-composer-root><div><div data-composer-markdown data-codex-composer="true" contenteditable="true" role="textbox" aria-label="Ask for follow-up changes"></div></div><button type="button" aria-label="Send"></button></div></main>`;

function fixture(markup = WORK, url = 'https://chatgpt.com/c/test') {
  const w = new JSDOM(markup, { url, runScripts: 'outside-only' }).window;
  w.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{ width: 10 }]; };
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
  w.module = { exports: {} }; w.process = {}; w.normalize = core.normalize; w.emptyState = core.emptyState;
  w.QUEUE_CSS = fs.readFileSync(path.join(__dirname, '../src/queue.css'), 'utf8');
  w.eval(fs.readFileSync(path.join(__dirname, '../src/notice-card.js'), 'utf8') + '\nwindow.NoticeCard = NoticeCard;');
  w.eval(fs.readFileSync(path.join(__dirname, '../src/browser.js'), 'utf8'));
  return { w, adapter: new w.module.exports.ChatGPTAdapter('test'), close: () => w.close() };
}

async function install(f) {
  const w = f.w, storage = new Map(), locks = [];
  w.module = undefined; w.process = undefined; w.structuredClone = structuredClone;
  w.GM_getValue = (key, fallback) => storage.has(key) ? storage.get(key) : fallback;
  w.GM_setValue = (key, value) => storage.set(key, structuredClone(value));
  w.GM_registerMenuCommand = () => {}; w.GM_addValueChangeListener = () => 0; w.GM_removeValueChangeListener = () => {};
  Object.defineProperty(w.navigator, 'locks', { value: { request: (name, _options, callback) => {
    locks.push(name); callback({}); return new w.Promise(() => {});
  } } });
  w.document.execCommand = (_command, _show, text) => { f.adapter.editor().textContent = text; return true; };
  w.eval(fs.readFileSync(path.join(__dirname, '../chatgpt-queue.user.js'), 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  return { storage, locks, root: w.document.getElementById('chatgpt-queue-accent').shadowRoot };
}

test('Work native markdown composer mounts without the Chat-specific wrapper', () => {
  const f = fixture();
  assert.equal(f.adapter.mode, 'work'); assert.ok(f.adapter.editor());
  assert.equal(f.adapter.composer().tagName, 'FORM');
  assert.equal(f.adapter.snapshot().ready, true); assert.equal(f.adapter.snapshot().complete, true);
  f.close();
});

test('Work waits through tools and approvals despite retained completion controls', () => {
  const f = fixture(), run = f.w.document.querySelector('[data-talvt-turn-state]');
  for (const state of ['working', 'waiting_for_approval', 'waiting_for_input']) {
    run.setAttribute('data-talvt-turn-state', state);
    assert.equal(f.adapter.snapshot().busy, true); assert.equal(f.adapter.snapshot().complete, false);
  }
  run.removeAttribute('data-talvt-turn-state');
  assert.equal(f.adapter.snapshot().complete, false);
  f.close();
});

test('Work retains its mode when the global experience changes the composer label', () => {
  const f = fixture();
  f.adapter.editor().setAttribute('aria-label', 'Work with Codex');
  assert.equal(f.adapter.snapshot().ready, true); assert.equal(f.adapter.snapshot().complete, true);
  f.adapter.editor().setAttribute('aria-label', 'Localized label');
  assert.equal(f.adapter.snapshot().ready, true); f.close();
});

test('Work terminal failure stops dispatch and a newer unanswered user prevents old completion', () => {
  const f = fixture(), run = f.w.document.querySelector('[data-talvt-turn-state]');
  run.setAttribute('data-talvt-turn-state', 'failed'); assert.ok(f.adapter.snapshot().error);
  run.setAttribute('data-talvt-turn-state', 'complete');
  const user = f.w.document.createElement('div'); user.setAttribute('data-content-search-unit-key', 'turn1:0:user'); user.innerHTML = '<div data-user-message-bubble>new</div>';
  f.adapter.composer().before(user); assert.equal(f.adapter.snapshot().complete, false);
  f.close();
});

test('Codex local URL and role-less message units identify the composer, receipt and final answer', () => {
  const f = fixture(CODEX, 'https://chatgpt.com/local/test');
  const snapshot = f.adapter.snapshot();
  assert.equal(f.adapter.mode, 'codex'); assert.equal(snapshot.ready, true); assert.equal(snapshot.complete, true);
  assert.equal(snapshot.userKey, 'turn0:fco_user0'); assert.equal(snapshot.userText, 'start');
  assert.equal(f.adapter.composer().hasAttribute('data-codex-composer-root'), true); assert.ok(f.adapter.sendButton());
  const unit = f.w.document.createElement('div'); unit.setAttribute('data-content-search-unit-key', 'turn1:fco_user1'); unit.innerHTML = '<div data-user-message-bubble>follow up</div>';
  f.adapter.composer().before(unit);
  assert.equal(f.adapter.receipt({ phase: 'submitting', beforeUserKey: snapshot.userKey }, 'follow up').status, 'accepted');
  assert.equal(f.adapter.snapshot().complete, false); f.close();
});

test('Codex running controls override a retained final answer and feedback', () => {
  const f = fixture(CODEX, 'https://chatgpt.com/local/test');
  f.adapter.sendButton().setAttribute('aria-label', 'Stop');
  assert.equal(f.adapter.snapshot().busy, true); assert.equal(f.adapter.snapshot().complete, false); f.close();
});

test('Codex waits for native composer state before clicking its always-enabled send button', async t => {
  const f = fixture(CODEX, 'https://chatgpt.com/local/test'); t.after(() => f.close());
  let submitted = null, nativeValue = '';
  f.w.document.execCommand = (_command, _show, text) => {
    f.adapter.editor().textContent = text;
    f.w.setTimeout(() => { nativeValue = text; }, 0); return true;
  };
  f.adapter.sendButton().addEventListener('click', () => {
    submitted = nativeValue;
    const unit = f.w.document.createElement('div');
    unit.setAttribute('data-content-search-unit-key', 'turn1:fco_user1');
    const bubble = f.w.document.createElement('div'); bubble.setAttribute('data-user-message-bubble', '');
    bubble.textContent = nativeValue; unit.append(bubble); f.adapter.composer().before(unit);
  });
  const receipt = await f.adapter.send('follow up', f.adapter.snapshot(), () => true, () => {});
  assert.equal(submitted, 'follow up'); assert.equal(receipt, 'turn1:fco_user1');
});

test('mode or route changes refuse writing a queued prompt into the new composer', async () => {
  const f = fixture(), before = f.adapter.snapshot();
  f.w.history.replaceState(null, '', '/local/another');
  await assert.rejects(f.adapter.send('queued prompt', before, () => true, () => {}));
  assert.equal(f.adapter.text(), ''); f.close();
});

test('optimistic Work IDs wait for the real conversation identity', () => {
  const f = fixture(WORK, 'https://chatgpt.com/c/local-chatgpt%3Atemporary');
  assert.equal(f.adapter.snapshot().ready, false); f.close();
});

test('installed Work script uses the original composer and stores Ctrl Q in a Work-specific queue', async t => {
  const f = fixture(); t.after(() => f.close());
  const installed = await install(f), editor = f.adapter.editor(); editor.textContent = 'work follow up';
  assert.equal(editor.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true })), false);
  assert.equal(editor.textContent, ''); assert.equal(installed.storage.get('cq-accent-v1:work:test').items[0].text, 'work follow up');
  assert.equal(installed.storage.has('cq-accent-v1:test'), false);
  assert.equal(installed.root.querySelectorAll('.row').length, 1);
  assert.equal(f.w.document.querySelectorAll('[contenteditable],textarea').length, 1);
  assert.match(installed.locks[0], /:work:test$/);
});

test('installed Codex script isolates its queue and cannot capture during a route transition', async t => {
  const f = fixture(CODEX, 'https://chatgpt.com/local/test'); t.after(() => f.close());
  const installed = await install(f), editor = f.adapter.editor(); editor.textContent = 'codex follow up';
  editor.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true }));
  assert.equal(installed.storage.get('cq-accent-v1:codex:test').items[0].text, 'codex follow up');
  assert.equal(installed.storage.has('cq-accent-v1:work:test'), false);
  f.w.history.replaceState(null, '', '/local/another'); editor.textContent = 'another draft';
  assert.equal(editor.dispatchEvent(new f.w.KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true })), true);
  assert.equal(editor.textContent, 'another draft');
  assert.equal(installed.storage.get('cq-accent-v1:codex:test').items.length, 1);
});
