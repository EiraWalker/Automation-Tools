/* SPDX-License-Identifier: GPL-3.0-or-later */
'use strict';

const normalize = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
const emptyState = () => ({ version: 1, items: [], active: null, paused: true, reason: '', fault: null });

class QueueEngine {
  constructor({ saved, save, adapter, changed = () => {}, onError = () => {}, now = Date.now, id = () => crypto.randomUUID() }) {
    this.state = saved?.version === 1 ? structuredClone(saved) : emptyState();
    this.state.paused = true;
    this.state.fault = this.state.fault || null;
    this.state.reason = this.state.fault ? '队列执行出错，自动发送已停止。' : '';
    this.save = save;
    this.adapter = adapter;
    this.changed = changed;
    this.onError = onError;
    this.now = now;
    this.id = id;
    this.running = false;
    this.disposed = false;
    this.recovery = false;
    this.needsReconcile = Boolean(this.state.active);
    this.reconcileSince = null;
    this.expectedUser = null;
    this.stableSince = null;
    this.epoch = 0;
    this.status = this.state.reason || '已暂停';
  }

  commit() {
    // Persist before a click. A failed write must prevent any dispatch.
    try { this.save(structuredClone(this.state)); }
    catch (error) {
      const reported = this.state.fault?.code === 'Q_STORAGE_FAILED';
      this.state.fault = { code: 'Q_STORAGE_FAILED', stage: 'persist', at: this.now(), phase: this.state.active?.phase || null };
      this.state.paused = true;
      this.state.reason = '保存失败，已暂停；请勿刷新页面。';
      this.status = this.state.reason;
      this.changed(this);
      if (!reported) this.onError(structuredClone(this.state.fault));
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
    const activeIndex = this.state.items.findIndex(item => item.id === this.state.active?.id);
    if (activeIndex >= 0 && (index === activeIndex || target === activeIndex)) return;
    [this.state.items[index], this.state.items[target]] = [this.state.items[target], this.state.items[index]];
    this.commit();
  }

  resume() {
    if (this.needsReconcile) this.reconcile();
    if (this.state.fault || this.needsReconcile) throw new Error(this.state.fault ? `队列错误：${this.state.fault.code}` : '正在读取页面消息记录。');
    if (!this.state.items.length && !this.state.active) return;
    const snapshot = this.adapter.snapshot();
    if (snapshot.error) throw new Error(snapshot.error);
    this.expectedUser = this.state.active?.userKey || snapshot.userKey;
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

  diagnostics(snapshot = this.adapter.snapshot()) {
    return { schemaVersion: 1, fault: this.state.fault, queueLength: this.state.items.length,
      phase: this.state.active?.phase || null, paused: this.state.paused,
      signals: { ready: Boolean(snapshot.ready), busy: Boolean(snapshot.busy), complete: Boolean(snapshot.complete),
        attachments: Boolean(snapshot.attachments), pageError: Boolean(snapshot.error),
        userCount: snapshot.userCount ?? null, draftLength: snapshot.draft?.length || 0,
        receivedLength: snapshot.userText?.length ?? null } };
  }

  fail(code, stage, snapshot = this.adapter.snapshot()) {
    const previous = this.state.fault?.code;
    if (previous === code && this.state.fault.stage === stage) return;
    const signals = this.diagnostics(snapshot).signals;
    this.state.fault = { code, stage, at: this.now(), phase: this.state.active?.phase || null,
      hasBaseline: Boolean(this.state.active && Object.hasOwn(this.state.active, 'beforeUserKey')), signals };
    this.needsReconcile = Boolean(this.state.active);
    this.pause(`队列执行出错（${code}），自动发送已停止。`);
    if (previous !== code) this.onError(structuredClone(this.state.fault));
  }

  acknowledge(userKey) {
    const active = this.state.active;
    const item = this.state.items.find(item => item.id === active.id);
    // The queue contains only unsent prompts. Retain the accepted turn separately
    // so completion, reload and error handling never resend it.
    this.state.active = { ...item, ...active, phase: 'waiting', userKey };
    this.state.items = this.state.items.filter(item => item.id !== active.id);
    this.expectedUser = userKey;
    this.stableSince = null;
    this.status = '等待本条回答结束';
  }

  reconcile(snapshot = this.adapter.snapshot()) {
    const active = this.state.active;
    if (!active || this.running || this.disposed) return;
    if (active.phase === 'preparing') {
      this.state.active = null; this.state.fault = null; this.needsReconcile = false;
      this.commit(); return;
    }
    if (snapshot.error) { this.fail('Q_PAGE_ERROR', 'restore', snapshot); return; }
    if (!snapshot.ready) return;
    const text = active.text ?? this.state.items.find(item => item.id === active.id)?.text;
    if (typeof text !== 'string') { this.fail('Q_STATE_INVALID', 'restore', snapshot); return; }
    const receipt = this.adapter.receipt ? this.adapter.receipt(active, text) :
      { status: active.phase === 'waiting' && snapshot.userKey === active.userKey ? 'accepted' : 'pending', userKey: snapshot.userKey };
    if (receipt.status === 'accepted') {
      this.acknowledge(receipt.userKey);
      this.state.fault = null; this.state.reason = '';
      this.needsReconcile = false; this.reconcileSince = null; this.commit(); return;
    }
    if (receipt.status === 'changed') { this.fail('Q_CONTEXT_CHANGED', 'restore', snapshot); return; }
    if (this.reconcileSince === null) this.reconcileSince = this.now();
    if (this.now() - this.reconcileSince >= 12000 && !this.state.fault) this.fail('Q_RECEIPT_MISSING', 'restore', snapshot);
  }

  recheck() {
    if (this.running || this.disposed) return;
    if (this.state.active) { this.needsReconcile = true; this.reconcile(); }
    else {
      const snapshot = this.adapter.snapshot();
      if (snapshot.ready && !snapshot.error) { this.state.fault = null; this.state.reason = ''; this.commit(); }
    }
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
    if (this.running || this.disposed) return;
    if (this.needsReconcile) { this.reconcile(); return; }
    if (this.state.paused || (!this.state.items.length && !this.state.active)) return;
    this.running = true;
    try {
      const snapshot = this.adapter.snapshot();
      if (snapshot.error) { this.fail('Q_PAGE_ERROR', 'page', snapshot); return; }
      const active = this.state.active;
      if (active) {
        if (snapshot.userKey !== active.userKey) {
          this.needsReconcile = true;
          this.running = false;
          this.reconcile(snapshot);
          return;
        }
        if (this.settled(snapshot)) {
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
      this.state.active = { id: item.id, phase: 'preparing', userKey: null, beforeUserKey: snapshot.userKey };
      this.commit();
      const valid = () => !this.disposed && !this.state.paused && epoch === this.epoch;
      try {
        const userKey = await this.adapter.send(item.text, snapshot, valid, () => {
          this.state.active.phase = 'submitting';
          this.commit();
        });
        this.acknowledge(userKey);
        this.commit();
      } catch (error) {
          if (this.state.active?.phase === 'preparing') {
            this.state.active = null;
            if (!valid()) this.pause(error.message);
            else this.fail(error.code || 'Q_SEND_PREPARE_FAILED', 'prepare');
          } else this.fail(error.code || 'Q_SEND_FAILED', 'acknowledge');
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

module.exports = { QueueEngine, normalize, emptyState };
