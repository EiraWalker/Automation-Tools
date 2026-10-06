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

module.exports = { QueueEngine, normalize, emptyState };
