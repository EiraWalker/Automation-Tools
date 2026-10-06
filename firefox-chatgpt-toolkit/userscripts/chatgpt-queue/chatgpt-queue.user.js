// ==UserScript==
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

(() => {
'use strict';
/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';

const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
const emptyState = () => ({ version: 1, items: [], active: null, paused: true, reason: '' });

class QueueEngine {
  constructor({ saved, save, adapter, changed = () => {}, now = Date.now, id = () => crypto.randomUUID() }) {
    this.state = saved?.version === 1 ? structuredClone(saved) : emptyState();
    this.state.paused = true;
    this.state.reason = this.state.active ? '上次发送尚未核对，请先处理该条消息。' : '';
    this.save = save;
    this.adapter = adapter;
    this.changed = changed;
    this.now = now;
    this.id = id;
    this.running = false;
    this.disposed = false;
    this.recovery = Boolean(this.state.active);
    this.expectedUser = null;
    this.stableSince = null;
    this.epoch = 0;
    this.status = this.state.reason || '已暂停';
  }

  commit() {
    // Persist before a click. A failed write must prevent any dispatch.
    try { this.save(structuredClone(this.state)); }
    catch (error) {
      this.state.paused = true;
      this.state.reason = '保存失败，已暂停；请勿刷新页面。';
      this.status = this.state.reason;
      this.changed(this);
      throw error;
    }
    this.changed(this);
  }

  add(text) {
    const value = normalize(text);
    if (!value) throw new Error('消息不能为空。');
    if (this.state.items.length >= 100) throw new Error('队列最多保留 100 条消息。');
    const item = { id: this.id(), text: value, createdAt: this.now() };
    this.state.items.push(item);
    this.commit();
    return item;
  }

  edit(id, text) {
    if (id === this.state.active?.id) throw new Error('正在处理的消息不能修改。');
    const item = this.state.items.find(item => item.id === id);
    if (!item || !normalize(text)) return;
    item.text = normalize(text);
    this.commit();
  }

  remove(id) {
    if (id === this.state.active?.id) throw new Error('请先核对正在处理的消息。');
    this.state.items = this.state.items.filter(item => item.id !== id);
    this.commit();
  }

  move(id, delta) {
    const index = this.state.items.findIndex(item => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= this.state.items.length) return;
    if (this.state.active && (index === 0 || target === 0)) return;
    [this.state.items[index], this.state.items[target]] = [this.state.items[target], this.state.items[index]];
    this.commit();
  }

  resume() {
    if (this.recovery) throw new Error('请先核对上次发送是否成功。');
    if (!this.state.items.length) return;
    const snapshot = this.adapter.snapshot();
    if (snapshot.error) throw new Error(snapshot.error);
    this.expectedUser = snapshot.userKey;
    this.state.paused = false;
    this.state.reason = '';
    this.status = '等待当前回答结束';
    this.stableSince = null;
    this.commit();
  }

  pause(reason = '已暂停') {
    this.epoch++;
    this.state.paused = true;
    this.state.reason = reason;
    this.status = reason;
    this.stableSince = null;
    this.commit();
  }

  resolve(sent) {
    if (!this.recovery || this.running) return;
    if (sent) this.state.items = this.state.items.filter(item => item.id !== this.state.active?.id);
    this.state.active = null;
    this.recovery = false;
    this.pause(sent ? '已移出该条；请确认上一轮已结束再继续。' : '已退回队列，请确认不会重复发送再继续。');
  }

  settled(snapshot) {
    if (snapshot.busy || !snapshot.ready || !snapshot.complete) {
      this.stableSince = null;
      return false;
    }
    if (this.stableSince === null) this.stableSince = this.now();
    return this.now() - this.stableSince >= 1200;
  }

  async tick() {
    if (this.running || this.disposed || this.state.paused || !this.state.items.length) return;
    this.running = true;
    try {
      const snapshot = this.adapter.snapshot();
      if (snapshot.error) { this.pause(snapshot.error); return; }
      const active = this.state.active;
      if (active) {
        if (snapshot.userKey !== active.userKey) {
          this.recovery = true;
          this.pause('会话内容已改变，请核对正在处理的消息。');
          return;
        }
        if (this.settled(snapshot)) {
          this.state.items = this.state.items.filter(item => item.id !== active.id);
          this.state.active = null;
          this.stableSince = null;
          this.status = this.state.items.length ? '准备下一条' : '队列已完成';
          if (!this.state.items.length) this.state.paused = true;
          this.commit();
        } else this.status = '等待本条回答结束';
        return;
      }
      if (this.expectedUser !== snapshot.userKey) { this.pause('检测到其他消息或分支变化，请确认会话后继续。'); return; }
      if (snapshot.draft || snapshot.attachments) {
        this.status = '等待输入框空闲（保留你的草稿）';
        this.stableSince = null;
        return;
      }
      if (!this.settled(snapshot)) { this.status = snapshot.reason || '等待当前回答结束'; return; }

      const item = this.state.items[0];
      const epoch = this.epoch;
      this.state.active = { id: item.id, phase: 'preparing', userKey: null };
      this.commit();
      const valid = () => !this.disposed && !this.state.paused && epoch === this.epoch;
      try {
        const userKey = await this.adapter.send(item.text, snapshot, valid, () => {
          this.state.active.phase = 'submitting';
          this.commit();
        });
        this.state.active = { id: item.id, phase: 'waiting', userKey };
        this.expectedUser = userKey;
        this.stableSince = null;
        this.status = '等待本条回答结束';
        this.commit();
      } catch (error) {
        if (this.state.active?.phase === 'preparing') this.state.active = null;
        else this.recovery = true;
        this.pause(error.message || '发送结果未知，请核对后再继续。');
      }
    } finally {
      this.running = false;
      this.changed(this);
    }
  }

  dispose() {
    this.disposed = true;
    this.pause('页面已离开；返回后可恢复队列。');
  }
}


const QUEUE_CSS = "/* SPDX-License-Identifier: GPL-3.0-or-later\r\n   Rounded inline queue layout inspired by kgruiz/chatgpt-queue. */\r\n:host {\r\n  --cq-accent: var(--color-background-composer-primary, var(--theme-submit-btn-bg, var(--interactive-bg-accent-default, var(--text-accent, #707070))));\r\n  --cq-on-accent: var(--color-text-composer-primary, var(--theme-submit-btn-text, var(--text-inverted, #fff)));\r\n  --cq-text: var(--color-text-primary, var(--text-primary, #202123));\r\n  --cq-muted: var(--color-text-secondary, var(--text-secondary, #676767));\r\n  --cq-bg: var(--color-background-primary, var(--color-background-surface, var(--bg-primary, #fff)));\n  --cq-card: var(--color-background-composer-surface, var(--bg-elevated-secondary, var(--bg-secondary, #f4f4f4)));\r\n  --cq-border: var(--color-border-default, var(--color-token-border-default, var(--border-light, color-mix(in srgb, currentColor 15%, transparent))));\n  display: block; margin: 0 0 10px; width: 100%; color: var(--cq-text);\r\n  font: 13px/1.5 var(--font-sans, ui-sans-serif, system-ui, sans-serif);\r\n  color-scheme: inherit;\r\n}\r\n* { box-sizing: border-box; }\r\nbutton { font: inherit; }\r\nbutton { color: inherit; cursor: pointer; border: 0; background: transparent; }\r\nbutton:disabled { opacity: .45; cursor: default; }\r\nbutton:focus-visible { outline: 2px solid var(--cq-accent); outline-offset: 3px; }\r\n.pill { border-radius: 999px; padding: 6px 12px; border: 1px solid var(--cq-border); white-space: nowrap; }\r\n.accent { color: var(--cq-accent); background: color-mix(in srgb, var(--cq-accent) 12%, transparent); border-color: color-mix(in srgb, var(--cq-accent) 38%, transparent); }\r\n.solid { color: var(--cq-on-accent); background: var(--cq-accent); border-color: transparent; }\r\n.pill:hover:not(:disabled), .icon:hover:not(:disabled) { background: color-mix(in srgb, var(--cq-accent) 15%, var(--cq-card)); }\r\n.solid:hover:not(:disabled) { background: var(--cq-accent); filter: brightness(.92); }\r\n.list { display: flex; flex-direction: column; gap: 8px; max-height: min(35vh, 320px); overflow: auto; padding: 3px; }\r\n.row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--cq-border); background: var(--cq-card); border-radius: 24px; }\r\n.row.active, .row.editing { border-color: color-mix(in srgb, var(--cq-accent) 65%, transparent); }\r\n.number { width: 29px; height: 29px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--cq-accent) 13%, var(--cq-card)); color: var(--cq-accent); font-weight: 600; flex-shrink: 0; }\r\n.icon { width: 26px; height: 28px; border-radius: 8px; display: grid; place-items: center; }\r\n.icons { display: flex; gap: 2px; }\r\n.footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 3px 0; }\r\n.hint { color: var(--cq-muted); font-size: 11px; white-space: pre-wrap; }\r\n.recovery { border: 1px solid color-mix(in srgb, var(--cq-accent) 50%, transparent); border-radius: 16px; padding: 10px; margin: 6px 0; }\r\n.recovery p { margin: 0 0 8px; }\r\n[hidden] { display: none !important; }\r\nsvg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\r\n@media (max-width: 560px) { .pill { padding: 6px 9px; } .row { gap: 5px; padding: 8px; } .hint { max-width: 160px; } }\r\n.message { flex: 1; min-width: 0; max-height: 160px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 3px 0; }\r\n.edit { padding: 3px 8px; }\r\n:host([hidden]) { display: none !important; }\r\n:host(#chatgpt-queue-settings) { margin: 0; width: 0; height: 0; }\r\n.actions { display: flex; align-items: center; gap: 8px; }\r\n.error { color: var(--cq-muted); padding: 6px; overflow-wrap: anywhere; }\r\ndialog { width: min(380px, calc(100vw - 32px)); padding: 24px; border: 1px solid var(--cq-border); border-radius: 20px; color: var(--cq-text); background: var(--cq-settings-bg, var(--cq-bg)); font: inherit; font-size: 14px; color-scheme: inherit; box-shadow: 0 18px 60px #0005; }\ndialog::backdrop { background: #0008; }\ndialog h2 { margin: 0 0 18px; color: var(--cq-text); font-size: 16px; font-weight: 600; line-height: 1.4; }\n.setting { display: flex; align-items: center; gap: 10px; padding: 8px 0 18px; color: var(--cq-text); cursor: pointer; }\n.setting input { width: 18px; height: 18px; margin: 0; flex-shrink: 0; accent-color: var(--cq-accent); }\n.setting input:focus-visible { outline: 2px solid var(--cq-accent); outline-offset: 3px; }\ndialog .footer { justify-content: flex-end; }\r\n";
/* SPDX-License-Identifier: GPL-3.0-or-later */
const page = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
const firstVisible = (selector, root = document) => [...root.querySelectorAll(selector)].find(visible) || null;
const uuid = () => crypto.randomUUID();
const ICONS = {
  down: '<path d="m4 6 4 4 4-4"/>', up: '<path d="m4 10 4-4 4 4"/>',
  trash: '<path d="M3 4h10M6 4V2h4v2M5 6v7m3-7v7m3-7v7M4 4l1 11h6l1-11"/>',
  play: '<path d="m5 3 7 5-7 5z"/>', pause: '<path d="M5 3v10M11 3v10"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
};
function icon(name) { return `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`; }
function button(label, action, className = 'pill', symbol) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = className; node.title = label; node.setAttribute('aria-label', label);
  if (symbol) node.innerHTML = icon(symbol); else node.textContent = label;
  node.addEventListener('click', action);
  return node;
}
function route() { return location.pathname.match(/\/c\/([^/]+)/)?.[1] || null; }
const EDITOR_SELECTOR = '#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,[data-chatgpt-composer] .ProseMirror[contenteditable="true"][role="textbox"]';
const STOP_SELECTOR = '[data-testid="stop-button"],button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="停止生成"],button[aria-label="停止"]';

// Percentages resolve against the thread's own container, including any space
// reserved for side panels. Override only ChatGPT's conversation width tokens.
const WIDE_CSS = `
[data-cq-wide-root],
[data-cq-wide-root] [class*="--thread-content-"],
[data-cq-wide-root] [class*="--thread-body-max-width"],
[data-cq-wide-root] [class*="--composer-adjacent-max-width"] {
  --thread-content-max-width: 100% !important;
  --thread-content-responsive-max-width: 100% !important;
  --thread-content-expanded-max-width: 100% !important;
  --thread-content-compact-max-width: 100% !important;
  --thread-body-max-width: 100% !important;
  --composer-adjacent-max-width: 100% !important;
}
`;
class WideLayout {
  constructor(enabled = true) {
    this.enabled = enabled; this.root = null;
    this.style = document.createElement('style'); this.style.id = 'chatgpt-queue-width';
    this.style.textContent = WIDE_CSS; document.head.append(this.style);
  }
  update(adapter) {
    const next = adapter.editor()?.closest('[data-request-input-activity-root],main,[role="main"]') || null;
    if (this.root !== next || !this.enabled) this.root?.removeAttribute('data-cq-wide-root');
    this.root = next;
    if (this.enabled && next && !next.hasAttribute('data-cq-wide-root')) next.setAttribute('data-cq-wide-root', '');
  }
  dispose() { this.root?.removeAttribute('data-cq-wide-root'); this.style.remove(); }
}

class ChatGPTAdapter {
  constructor(conversation) { this.conversation = conversation; }
  editor() { return firstVisible(EDITOR_SELECTOR); }
  composer() { return this.editor()?.closest('[data-chatgpt-composer],form,[data-type="unified-composer"]') || this.editor()?.parentElement?.parentElement; }
  text() { const editor = this.editor(); return normalize(editor?.value ?? editor?.innerText ?? ''); }
  messages(role) {
    const legacy = [...document.querySelectorAll(`[data-message-author-role="${role}"]`)];
    return legacy.length ? legacy : [...document.querySelectorAll(`[data-content-search-unit-key$=":${role}"]`)];
  }
  key(node, index) {
    if (!node) return null;
    return node.getAttribute('data-message-id') || node.querySelector('[data-chatgpt-selection-message-id]')?.getAttribute('data-chatgpt-selection-message-id') ||
      node.closest('[data-turn-key]')?.getAttribute('data-turn-key') || node.getAttribute('data-content-search-unit-key') ||
      node.closest('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid') || `position:${index}`;
  }
  snapshot() {
    const editor = this.editor(), composer = this.composer();
    const users = this.messages('user'), user = users.at(-1);
    const assistants = this.messages('assistant');
    const assistant = assistants.filter(node => !user || Boolean(user.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
    const turn = assistant?.closest('[data-content-search-turn-key],[data-testid^="conversation-turn-"],article') || assistant?.parentElement;
    const stop = firstVisible(STOP_SELECTOR, composer || document);
    const busy = Boolean(stop || firstVisible('[data-is-streaming="true"],.result-streaming'));
    const finished = Boolean(turn?.querySelector('[data-testid="copy-turn-action-button"],[data-testid="good-response-turn-action-button"],[data-testid="bad-response-turn-action-button"]') ||
      (turn?.querySelector('.turn-action-controls button[aria-label="Copy"]') && turn?.querySelector('.turn-action-controls button[aria-label="Regenerate response"]')));
    const errorNode = firstVisible('[role="alert"]', turn || document);
    const errorText = errorNode?.textContent || '';
    const error = /something went wrong|network error|failed|limit|try again|出错|错误|上限|重试|失敗|限制/i.test(errorText)
      ? '页面提示出错或达到限制，请处理后继续。' : '';
    const attachments = Boolean(composer?.querySelector('[data-testid="file-upload-preview"],[data-testid="attachment"],[data-testid*="attachment-preview"],[data-composer-attachment],[data-composer-file-preview],button[aria-label^="Remove file"],button[aria-label^="Remove attachment"],img[src^="blob:"]'));
    const special = composer && /deep research|深入研究|深度研究|研究模式/i.test(composer.textContent || '');
    return {
        userKey: this.key(user, users.length), userText: normalize((user?.querySelector('[data-user-message-bubble] [data-search-result-target],[data-user-message-bubble]') || user)?.innerText || ''),
      busy, complete: Boolean(assistant && finished && !busy),
      ready: Boolean(editor && this.conversation && route() === this.conversation && !special),
      draft: this.text(), attachments,
      error: route() !== this.conversation ? '会话已切换，队列已暂停。' : error,
      reason: !this.conversation ? '请先在 ChatGPT 发送首条消息，再运行队列。' : special ? '此版本仅自动处理普通文字聊天。' : !editor ? '等待页面输入框就绪' : !finished && !busy ? '等待确认回答完成' : '',
    };
  }
  sendButton() { return firstVisible('[data-testid="send-button"],button[aria-label="Send"],button[aria-label="Send prompt"],button[aria-label="发送"],button[aria-label="发送提示"],button[aria-label="发送消息"]', this.composer() || document); }
  write(text) {
    const editor = this.editor();
    if (!editor) throw new Error('找不到 ChatGPT 输入框。');
    editor.focus();
    if (editor.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(page.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(editor, text);
      editor.dispatchEvent(new page.Event('input', { bubbles: true }));
    } else {
      // The rich editor owns its state. Use its transaction when accessible;
      // otherwise use the browser editing command, never replace innerHTML.
      // React keeps hidden composers after navigation. Use the page-realm
      // counterpart of the same visible editor selected for this operation.
      const raw = [...page.document.querySelectorAll(EDITOR_SELECTOR)].find(node => node.isSameNode(editor));
      const view = raw?.pmViewDesc?.view || raw?.pmViewDesc?.root?.view;
      if (view?.state?.schema && view.dispatch) {
        const json = { type: 'doc', content: text.split('\n').map(line => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) };
        const doc = view.state.schema.nodeFromJSON(page.JSON.parse(JSON.stringify(json)));
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
      } else {
        const selection = window.getSelection(), range = document.createRange();
        range.selectNodeContents(editor); selection.removeAllRanges(); selection.addRange(range);
        if (!document.execCommand(text ? 'insertText' : 'delete', false, text)) throw new Error('网页编辑器未接受输入，队列已暂停。');
      }
    }
    if (this.text() !== normalize(text)) throw new Error('输入内容核对失败，请检查原生输入框。');
  }
  async send(text, before, valid, beforeClick) {
    if (!valid() || this.text() || this.snapshot().attachments) throw new Error('输入框被占用或队列已暂停。');
    this.write(text);
    const deadline = Date.now() + 3500;
    let send;
    while (Date.now() < deadline) {
      if (!valid() || route() !== this.conversation) throw new Error('已暂停；待发文字保留在输入框。');
      if (this.text() !== normalize(text)) throw new Error('输入框内容发生变化，已取消自动发送。');
      send = this.sendButton();
      if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') break;
      await sleep(100);
    }
    if (!send || send.disabled || send.getAttribute('aria-disabled') === 'true') throw new Error('发送按钮未就绪，文字保留在输入框。');
    const final = this.snapshot();
    if (!valid() || final.busy || !final.ready || final.error || final.attachments || final.userKey !== before.userKey) throw new Error('页面状态已改变，取消发送。');
    beforeClick();
    send.click();
    const ackDeadline = Date.now() + 12000;
    while (Date.now() < ackDeadline) {
      if (route() !== this.conversation) throw new Error('发送期间切换了会话，请核对是否已发送。');
      const after = this.snapshot();
      if (after.userKey && after.userKey !== before.userKey) {
        if (after.userText !== normalize(text)) throw new Error('检测到不同的用户消息，请核对发送结果。');
        return after.userKey;
      }
      await sleep(150);
    }
    throw new Error('未能确认消息已发送；请核对聊天记录，勿直接重试。');
  }
}

class NativeQueueInput {
  constructor(engine, adapter) { this.engine = engine; this.adapter = adapter; this.editingId = null; }
  capture() {
    if (this.adapter.snapshot().attachments) throw new Error('请先处理原生输入框中的附件。');
    const text = normalize(this.adapter.text());
    if (!text) {
      if (!this.editingId && this.engine.state.items.length) { this.engine.resume(); return; }
      return;
    }
    const previous = this.editingId && this.engine.state.items.find(item => item.id === this.editingId);
    if (this.editingId && !previous) throw new Error('这条消息已不在队列中，请取消编辑。');
    const oldText = previous?.text;
    const item = previous || this.engine.add(text);
    if (previous) this.engine.edit(item.id, text);
    try { this.adapter.write(''); }
    catch (error) {
      if (previous) this.engine.edit(item.id, oldText); else this.engine.remove(item.id);
      throw error;
    }
    this.editingId = null;
    if (this.engine.state.paused && !this.engine.recovery) this.engine.resume();
  }
  edit(id) {
    const item = this.engine.state.items.find(item => item.id === id);
    if (!item || id === this.engine.state.active?.id) throw new Error('这条消息当前不能编辑。');
    if (this.editingId === id) { this.adapter.editor()?.focus(); return; }
    if (this.editingId || this.adapter.text() || this.adapter.snapshot().attachments) throw new Error('请先处理原生输入框中的内容。');
    this.resumeAfterEdit = !this.engine.state.paused;
    this.engine.pause();
    this.adapter.write(item.text);
    this.editingId = id;
  }
  cancel() {
    this.editingId = null;
    if (this.resumeAfterEdit && !this.engine.recovery) this.engine.resume();
    this.resumeAfterEdit = false;
  }
}

function enqueueShortcut(event, editor, capture, queueOnEnter = false) {
  if (!(event.ctrlKey || event.metaKey || queueOnEnter) || event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || !editor || !(event.target === editor || editor.contains(event.target))) return;
  event.preventDefault(); event.stopImmediatePropagation(); capture();
}

class QueuePanel {
  constructor(actions) {
    this.actions = actions;
    this.host = document.createElement('div'); this.host.id = 'chatgpt-queue-accent';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = QUEUE_CSS; this.root.append(style);
    this.root.innerHTML += `<section aria-label="消息队列"><div class="recovery" hidden><p>上次发送结果需要核对。请查看聊天记录后选择：</p><div class="actions"></div></div><div class="error" role="alert" hidden></div><div class="list"></div><div class="footer"><span class="hint">Ctrl + Enter  Enqueue</span><div class="actions"></div></div></section>`;
    this.error = this.root.querySelector('.error');
    this.list = this.root.querySelector('.list');
    this.list.hidden = true;
    this.queueActions = this.root.querySelector('.footer .actions'); this.queueActions.hidden = true;
    this.save = button('保存修改', () => actions.capture(), 'pill solid');
    this.save.title = '用原生输入框中的文字更新原队列条目'; this.save.hidden = true;
    this.cancel = button('取消编辑', () => actions.cancelEdit(), 'pill');
    this.cancel.title = '保留原生输入框中的文字，退出队列编辑'; this.cancel.hidden = true;
    this.queueActions.append(this.cancel, this.save);
    this.root.querySelector('.recovery .actions').append(
      button('已发送，移出', () => actions.resolve(true), 'pill accent'),
      button('未发送，退回', () => actions.resolve(false), 'pill'),
    );
    this.rows = new Map();
  }
  render(engine, owner, notice = '', editingId = null) {
    const state = engine?.state || emptyState();
    this.list.hidden = !state.items.length;
    this.queueActions.hidden = !editingId;
    this.error.textContent = notice;
    this.error.hidden = !notice || !state.items.length;
    this.save.disabled = !owner; this.save.hidden = !editingId;
    this.cancel.hidden = !editingId; this.cancel.disabled = !owner;
    this.root.querySelector('.recovery').hidden = !engine?.recovery || !state.items.length;
    for (const control of this.root.querySelectorAll('.recovery button')) control.disabled = !owner || engine?.running;
    const ids = new Set(state.items.map(item => item.id));
    for (const [id, row] of this.rows) if (!ids.has(id)) { row.remove(); this.rows.delete(id); }
    state.items.forEach((item, index) => {
      let row = this.rows.get(item.id);
      if (!row) {
        row = document.createElement('div'); row.className = 'row';
        const number = document.createElement('span'); number.className = 'number';
        const message = document.createElement('div'); message.className = 'message';
        const controls = document.createElement('div'); controls.className = 'icons';
        controls.append(button('编辑', () => this.actions.edit(item.id), 'pill edit'), button('上移', () => this.actions.move(item.id, -1), 'icon', 'up'), button('下移', () => this.actions.move(item.id, 1), 'icon', 'down'), button('删除', () => this.actions.remove(item.id), 'icon', 'trash'));
        row.append(number, message, controls); this.rows.set(item.id, row);
      }
      row.querySelector('.number').textContent = String(index + 1);
      const active = item.id === state.active?.id;
      row.classList.toggle('active', active);
      row.classList.toggle('editing', item.id === editingId);
      row.querySelector('.message').textContent = item.text;
      const controls = row.querySelectorAll('button');
      controls[0].disabled = !owner || active || Boolean(editingId && editingId !== item.id);
      controls[1].disabled = !owner || active || index === 0 || (Boolean(state.active) && index === 1);
      controls[2].disabled = !owner || active || index === state.items.length - 1;
      controls[3].disabled = !owner || active || item.id === editingId;
      if (this.list.children[index] !== row) this.list.insertBefore(row, this.list.children[index] || null);
    });
  }
  mount(adapter) {
    const composer = adapter.composer();
    if (composer && this.host.nextElementSibling !== composer) composer.before(this.host);
    // Semantic CSS tokens inherit through the shadow host. If a site variant
    // removes them, sample its actual submit button rather than invent a hue.
    if (composer) {
      const theme = getComputedStyle(composer);
      const accent = ['--color-background-composer-primary', '--theme-submit-btn-bg', '--interactive-bg-accent-default', '--text-accent']
        .map(key => theme.getPropertyValue(key).trim()).find(value => value && CSS.supports('color', value));
      const submit = adapter.sendButton();
      const submitStyle = submit && getComputedStyle(submit);
      const fallback = submitStyle?.backgroundColor;
      const next = accent || (fallback && fallback !== 'rgba(0, 0, 0, 0)' && fallback !== 'transparent' ? fallback : null);
      if (next && this.host.style.getPropertyValue('--cq-accent') !== next) this.host.style.setProperty('--cq-accent', next);
      const onAccent = theme.getPropertyValue('--color-text-composer-primary').trim() || theme.getPropertyValue('--theme-submit-btn-text').trim() || submitStyle?.color;
      if (onAccent && this.host.style.getPropertyValue('--cq-on-accent') !== onAccent) this.host.style.setProperty('--cq-on-accent', onAccent);
    }
  }
}

class QueueSettings {
  constructor({ read, write, apply, register }) {
    this.read = read; this.write = write; this.apply = apply;
    register('ChatGPT Queue · Accent 设置', () => this.open());
  }
  open() {
    if (!this.host) {
      this.host = document.createElement('div'); this.host.id = 'chatgpt-queue-settings';
      this.root = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style'); style.textContent = QUEUE_CSS; this.root.append(style);
      const dialog = document.createElement('dialog'); this.dialog = dialog;
      dialog.setAttribute('aria-label', 'ChatGPT Queue · Accent 设置');
      dialog.innerHTML = '<h2>ChatGPT Queue · Accent</h2><label class="setting"><input type="checkbox">会话全宽</label><div class="error" role="alert" hidden></div><div class="footer"></div>';
      this.checkbox = dialog.querySelector('input'); this.error = dialog.querySelector('.error');
      this.checkbox.addEventListener('change', () => {
        try {
          this.write(this.checkbox.checked); this.apply(this.checkbox.checked);
          this.error.hidden = true; this.error.textContent = '';
        } catch (error) {
          this.checkbox.checked = this.read(); this.error.textContent = error.message; this.error.hidden = false;
        }
      });
      dialog.querySelector('.footer').append(button('完成', () => dialog.close(), 'pill solid'));
      this.root.append(dialog); document.body.append(this.host);
    }
    this.checkbox.checked = this.read();
    this.syncTheme();
    if (!this.dialog.open) this.dialog.showModal();
  }
  syncTheme() {
    if (!this.host) return;
    const pageStyle = getComputedStyle(document.body);
    const background = [pageStyle.backgroundColor, getComputedStyle(document.documentElement).backgroundColor]
      .find(value => value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)');
    if (background) this.host.style.setProperty('--cq-settings-bg', background);
    else this.host.style.removeProperty('--cq-settings-bg');
    this.host.style.setProperty('--cq-text', pageStyle.color);
    this.host.style.fontFamily = pageStyle.fontFamily;
    this.host.style.colorScheme = pageStyle.colorScheme;
  }
  sync(enabled) { if (this.checkbox) this.checkbox.checked = enabled; }
  dispose() { if (this.dialog?.open) this.dialog.close(); this.host?.remove(); }
}

// Export only in the local test harness, never through a page-controlled bridge.
if (typeof module !== 'undefined' && module.exports && typeof process !== 'undefined') {
  module.exports = { ChatGPTAdapter, QueuePanel, WideLayout, NativeQueueInput, enqueueShortcut, QueueSettings };
} else {
  bootQueue().catch(error => console.error('[ChatGPT Queue] Initialization failed:', error));
}

async function bootQueue() {
  if (document.getElementById('chatgpt-queue-accent')) return;
  let engine, adapter, input, owner = false, release, listener, storageKey, currentRoute;
  let generation = 0, attaching = false, notice = '', lastStatus = '';
  const layoutKey = 'cq-accent-layout-v1';
  const readWidth = () => Boolean(GM_getValue(layoutKey, true));
  const layout = new WideLayout(readWidth());
  const settings = new QueueSettings({
    read: readWidth, write: enabled => GM_setValue(layoutKey, enabled),
    apply: enabled => { layout.enabled = enabled; layout.update(adapter); },
    register: (name, callback) => GM_registerMenuCommand(name, callback),
  });
  const tempKey = sessionStorage.getItem('cq-accent-temp') || uuid();
  sessionStorage.setItem('cq-accent-temp', tempKey);
  const keyFor = id => `cq-accent-v1:${id || `new:${tempKey}`}`;
  function render() { panel.render(engine, owner, notice, input?.editingId); }
  function act(callback) {
    if (!owner || !engine) return;
    try { notice = ''; callback(); render(); }
    catch (error) { notice = error.message; render(); }
  }
  const panel = new QueuePanel({
    capture: () => act(() => input.capture()),
    edit: id => act(() => input.edit(id)), cancelEdit: () => act(() => input.cancel()),
    remove: id => act(() => engine.remove(id)), move: (id, delta) => act(() => engine.move(id, delta)),
    resolve: sent => act(() => {
      if (!sent && !window.confirm('请确认聊天记录中没有这条消息。退回后再次运行可能重复发送。')) return;
      engine.resolve(sent);
    }),
  });
  const layoutListener = GM_addValueChangeListener(layoutKey, (_key, _old, value, remote) => {
    if (remote) { layout.enabled = Boolean(value); layout.update(adapter); settings.sync(layout.enabled); }
  });

  async function attach() {
    if (attaching) return;
    attaching = true;
    const id = route(), token = ++generation;
    const old = engine, wasNew = currentRoute === null;
    currentRoute = id;
    old?.dispose(); owner = false;
    input = null;
    release?.(); release = null;
    if (listener !== undefined) GM_removeValueChangeListener(listener);
    storageKey = keyFor(id);
    const migrate = wasNew && id && old?.state.items.length && !old.state.active ? structuredClone(old.state) : null;
    const targetKey = storageKey;
    adapter = new ChatGPTAdapter(id);
    layout.update(adapter);
    engine = new QueueEngine({ saved: GM_getValue(targetKey, null), save: state => GM_setValue(targetKey, state), adapter, changed: render });
    input = new NativeQueueInput(engine, adapter);
    listener = GM_addValueChangeListener(targetKey, (_key, _old, value, remote) => {
      if (remote && !owner && token === generation) {
        engine = new QueueEngine({ saved: value, save: () => {}, adapter, changed: render });
        input = new NativeQueueInput(engine, adapter);
        render();
      }
    });
    notice = '正在取得当前会话的队列控制权…'; render(); panel.mount(adapter);
    const locks = navigator.locks;
    if (!locks) { notice = '当前环境不支持标签页互斥锁，自动发送已禁用。'; render(); attaching = false; return; }
    let acquired, lockError = '';
    const ready = new Promise(resolve => { acquired = resolve; });
    const holdLock = lock => {
      if (token !== generation || !lock) { acquired(false); return; }
      // Firefox must receive a promise in the page realm. Returning a sandbox
      // async-function promise makes Web Locks fail with permission denied: then.
      const executor = resolve => { release = resolve; };
      const held = new page.Promise(typeof exportFunction === 'function' ? exportFunction(executor, page) : executor);
      if (migrate && !GM_getValue(targetKey, null)) {
        GM_setValue(targetKey, migrate); GM_setValue(keyFor(null), emptyState());
      }
      owner = true;
      engine = new QueueEngine({ saved: GM_getValue(targetKey, null), save: state => GM_setValue(targetKey, state), adapter, changed: render });
      input = new NativeQueueInput(engine, adapter);
      engine.commit(); notice = ''; render(); acquired(true);
      return held;
    };
    const callback = typeof exportFunction === 'function' ? exportFunction(holdLock, page) : holdLock;
    locks.request(`cq-accent-owner:${targetKey}`, { ifAvailable: true }, callback).catch(error => {
      lockError = '无法取得标签页互斥锁，自动发送已禁用；请刷新重试。';
      acquired(false);
      if (token !== generation) return;
      owner = false; release?.(); release = null;
      try { engine.pause('无法保持标签页互斥锁，自动发送已暂停。'); } catch (_) {}
      notice = lockError; console.error('[ChatGPT Queue] Lock failed:', error); render();
    });
    if (!await ready && token === generation) { notice = lockError || '另一个标签页正在管理此会话队列；关闭它后刷新本页即可接管。'; render(); }
    attaching = false;
  }
  await attach();
  const interval = setInterval(() => {
    if (settings.dialog?.open) settings.syncTheme();
    if (route() !== currentRoute) { attach().catch(error => { notice = error.message; attaching = false; render(); }); return; }
    panel.mount(adapter);
    layout.update(adapter);
    if (owner) engine.tick().catch(error => { notice = error.message; render(); });
    if (engine.status !== lastStatus) { lastStatus = engine.status; render(); }
  }, 500);
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (owner && target?.matches(STOP_SELECTOR)) {
      act(() => engine.pause('你已停止回答；队列同时暂停。'));
    }
    if (owner && target === adapter.sendButton() && engine.state.active?.phase !== 'submitting' && (input.editingId || engine.state.items.length || adapter.snapshot().busy)) {
      event.preventDefault(); event.stopImmediatePropagation(); panel.actions.capture();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && owner && !engine.state.paused) act(() => engine.pause('已暂停队列。'));
    if (owner && event.key === 'Enter') enqueueShortcut(event, adapter.editor(), () => panel.actions.capture(), Boolean(input.editingId || engine.state.items.length || adapter.snapshot().busy));
  }, true);
  window.addEventListener('pagehide', () => {
    clearInterval(interval);
    try { engine?.dispose(); } finally { release?.(); owner = false; }
    GM_removeValueChangeListener(layoutListener); layout.dispose(); settings.dispose();
    if (listener !== undefined) GM_removeValueChangeListener(listener);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) { notice = '页面从浏览器缓存恢复；请刷新后继续队列。'; render(); }
  });
}

})();
