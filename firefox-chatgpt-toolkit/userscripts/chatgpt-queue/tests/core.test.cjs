/* SPDX-License-Identifier: GPL-3.0-or-later */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { QueueEngine, emptyState } = require('../src/core.cjs');

function fixture(saved) {
  let clock = 0, counter = 0, persisted;
  const snapshot = { userKey: 'u0', busy: false, ready: true, complete: true, draft: '', attachments: false, error: '' };
  const sent = [];
  const adapter = {
    snapshot: () => ({ ...snapshot }),
    send: async (text, before, valid, beforeClick) => {
      assert.ok(valid()); beforeClick(); sent.push(text);
      snapshot.userKey = `u${sent.length}`; snapshot.busy = true; snapshot.complete = false;
      return snapshot.userKey;
    },
  };
  const engine = new QueueEngine({ saved, save: value => { persisted = value; }, adapter, now: () => clock, id: () => `id${++counter}` });
  return { engine, snapshot, sent, adapter, persisted: () => persisted, tick: async (ms = 0) => { clock += ms; await engine.tick(); } };
}

test('three queued messages send separately and only after each answer completes', async () => {
  const f = fixture(); for (const text of ['A', 'B', 'C']) f.engine.add(text);
  f.engine.resume(); await f.tick(); await f.tick(1200);
  assert.deepEqual(f.sent, ['A']);
  await f.tick(9000); assert.deepEqual(f.sent, ['A']);
  for (const expected of [2, 3]) {
    f.snapshot.busy = false; f.snapshot.complete = true;
    await f.tick(); await f.tick(1200); await f.tick(); await f.tick(1200);
    assert.equal(f.sent.length, expected);
  }
  f.snapshot.busy = false; f.snapshot.complete = true;
  await f.tick(); await f.tick(1200);
  assert.equal(f.engine.state.items.length, 0);
  assert.equal(f.engine.state.paused, true);
});
test('a long text pause is not a completion signal', async () => {
  const f = fixture(); f.snapshot.complete = false; f.engine.add('A'); f.engine.resume();
  await f.tick(); await f.tick(120000); assert.equal(f.sent.length, 0);
});
test('busy answer never advances even if completion controls are stale', async () => {
  const f = fixture(); f.snapshot.busy = true; f.engine.add('A'); f.engine.resume();
  await f.tick(); await f.tick(5000); assert.equal(f.sent.length, 0);
});
test('drafts and attachments block dispatch without deleting them', async () => {
  for (const condition of [{ draft: 'draft' }, { attachments: true }]) {
    const f = fixture(); Object.assign(f.snapshot, condition); f.engine.add('A'); f.engine.resume();
    await f.tick(); await f.tick(5000); assert.equal(f.sent.length, 0); assert.equal(f.engine.state.items.length, 1);
  }
});
test('identical messages have different identities and both send', async () => {
  const f = fixture(); const a = f.engine.add('same'), b = f.engine.add('same'); assert.notEqual(a.id, b.id);
  f.engine.resume(); await f.tick(); await f.tick(1200);
  f.snapshot.busy = false; f.snapshot.complete = true;
  await f.tick(); await f.tick(1200); await f.tick(); await f.tick(1200);
  assert.deepEqual(f.sent, ['same', 'same']);
});
test('post-click failure preserves the item and refuses automatic retry', async () => {
  const f = fixture(); f.adapter.send = async (_text, _before, _valid, click) => { click(); throw new Error('unknown'); };
  f.engine.add('A'); f.engine.resume(); await f.tick(); await f.tick(1200);
  assert.equal(f.engine.state.fault.code, 'Q_SEND_FAILED'); assert.equal(f.engine.state.items.length, 1);
  assert.throws(() => f.engine.resume()); await f.tick(10000);
  assert.equal(f.engine.state.items.length, 1);
});
test('pre-click failure retains item without pretending a request was sent', async () => {
  const f = fixture(); f.adapter.send = async () => { throw new Error('editor unavailable'); };
  f.engine.add('A'); f.engine.resume(); await f.tick(); await f.tick(1200);
  assert.equal(f.engine.recovery, false); assert.equal(f.engine.state.active, null); assert.equal(f.engine.state.items.length, 1);
});
test('reload does not retry an in-flight message and reports missing receipt after hydration deadline', async () => {
  const saved = { ...emptyState(), paused: false, items: [{ id: 'a', text: 'A' }], active: { id: 'a', phase: 'submitting' } };
  const f = fixture(saved); assert.equal(f.engine.state.paused, true); assert.equal(f.engine.recovery, false);
  await f.tick(); await f.tick(12000);
  assert.equal(f.engine.state.fault.code, 'Q_RECEIPT_MISSING');
  assert.throws(() => f.engine.resume()); assert.equal(f.engine.state.items.length, 1); assert.equal(f.sent.length, 0);
});

test('reload before the click clears preparation without a false error', async () => {
  const f=fixture({...emptyState(),items:[{id:'a',text:'A'}],active:{id:'a',phase:'preparing'}});
  await f.tick();assert.equal(f.engine.state.active,null);assert.equal(f.engine.state.fault,null);assert.equal(f.sent.length,0);
});

test('late receipt clears a send error without duplicating a message', async () => {
  const f=fixture();let accepted=false;
  f.adapter.receipt=()=>accepted?{status:'accepted',userKey:'u1'}:{status:'pending'};
  f.adapter.send=async (_text,_before,_valid,click)=>{click();throw Object.assign(new Error('timeout'),{code:'Q_ACK_TIMEOUT'});};
  f.engine.add('A');f.engine.resume();await f.tick();await f.tick(1200);
  accepted=true;await f.tick(15000);
  assert.equal(f.engine.state.fault,null);assert.equal(f.engine.state.active.phase,'waiting');assert.equal(f.engine.state.active.userKey,'u1');
  assert.equal(f.sent.length,0);assert.equal(f.engine.state.paused,true);
});

test('diagnostics contain signals but no message, conversation or draft text', async () => {
  const f=fixture();f.engine.add('private message');f.snapshot.draft='private draft';
  f.engine.fail('Q_TEST','test');const diagnostic=JSON.stringify(f.engine.diagnostics());
  assert.ok(!diagnostic.includes('private message'));assert.ok(!diagnostic.includes('private draft'));
  assert.equal(f.engine.diagnostics().signals.draftLength,13);
});
test('external message or branch change pauses before dispatch', async () => {
  const f = fixture(); f.engine.add('A'); f.engine.resume(); await f.tick();
  f.snapshot.userKey = 'other'; await f.tick(1200);
  assert.equal(f.sent.length, 0); assert.equal(f.engine.state.paused, true);
});
test('manual pause cancels a preparation already in progress', async () => {
  const f = fixture(); let release;
  f.adapter.send = async (_text, _before, valid, click) => {
    await new Promise(resolve => { release = resolve; });
    if (!valid()) throw new Error('paused'); click(); return 'u1';
  };
  f.engine.add('A'); f.engine.resume(); await f.tick();
  const sending = f.tick(1200); f.engine.pause(); release(); await sending;
  assert.equal(f.engine.state.active, null); assert.equal(f.engine.state.paused, true);
});
test('a storage failure prevents dispatch', async () => {
  const f = fixture(); f.engine.add('A'); f.engine.resume(); await f.tick();
  f.engine.save = () => { throw new Error('storage full'); };
  await assert.rejects(f.tick(1200)); assert.equal(f.sent.length, 0); assert.equal(f.engine.state.paused, true);
});
test('an item awaiting acknowledgement cannot be edited, deleted, or reordered', async () => {
  const f = fixture(); const a = f.engine.add('A'), b = f.engine.add('B'); let release;
  f.adapter.send = async (_text, _before, _valid, click) => { click(); await new Promise(resolve => { release = resolve; }); return 'u1'; };
  f.engine.resume(); await f.tick(); const sending = f.tick(1200);
  assert.throws(() => f.engine.edit(a.id, 'changed')); assert.throws(() => f.engine.remove(a.id));
  f.engine.move(b.id, -1); assert.equal(f.engine.state.items[0].id, a.id);
  release(); await sending;
});

test('accepted prompt leaves the queue while its answer is still running and blocks the next send', async () => {
  const f = fixture(); f.engine.add('A'); const b = f.engine.add('B');
  f.engine.resume(); await f.tick(); await f.tick(1200);
  assert.equal(f.snapshot.busy, true);
  assert.deepEqual(f.engine.state.items.map(item => item.id), [b.id]);
  assert.equal(f.engine.state.active.text, 'A');
  assert.equal(f.persisted().items.length, 1);
  assert.equal(f.persisted().active.phase, 'waiting');
  await f.tick(20000); assert.deepEqual(f.sent, ['A']);
});

test('pending prompts can be reordered while a popped prompt runs', async () => {
  const f = fixture(); f.engine.add('A'); const b = f.engine.add('B'), c = f.engine.add('C');
  f.engine.resume(); await f.tick(); await f.tick(1200);
  f.engine.move(c.id, -1);
  assert.deepEqual(f.engine.state.items.map(item => item.id), [c.id, b.id]);
  assert.equal(f.engine.state.active.text, 'A');
});

test('reload of a popped final prompt preserves its running turn with an empty queue', async () => {
  const f = fixture({ ...emptyState(), active: { id: 'a', text: 'A', phase: 'waiting', userKey: 'u0' } });
  f.snapshot.busy = true; f.snapshot.complete = false;
  await f.tick(); assert.equal(f.engine.state.fault, null); assert.equal(f.engine.state.items.length, 0);
  f.engine.resume(); await f.tick(20000); assert.equal(f.engine.state.active.text, 'A');
  f.snapshot.busy = false; f.snapshot.complete = true;
  await f.tick(); await f.tick(1200);
  assert.equal(f.engine.state.active, null); assert.equal(f.engine.state.paused, true);
  assert.equal(f.sent.length, 0);
});
test('page errors pause and preserve the pending queue', async () => {
  const f = fixture(); f.engine.add('A'); f.engine.resume(); f.snapshot.error = 'rate limit'; await f.tick();
  assert.equal(f.engine.state.fault.code, 'Q_PAGE_ERROR'); assert.equal(f.sent.length, 0);
});

test('reload of an acknowledged message reconciles automatically without asking sent or unsent', async () => {
  const saved = { ...emptyState(), items: [{ id: 'a', text: 'A' }], active: { id: 'a', phase: 'waiting', userKey: 'u0' } };
  const f = fixture(saved);
  await f.tick();
  assert.equal(f.engine.recovery, false);
  assert.equal(f.engine.state.fault ?? null, null);
  assert.equal(f.engine.state.items.length, 0);
  assert.equal(f.engine.state.active.text, 'A');
  assert.doesNotThrow(() => f.engine.resume());
  await f.tick(); await f.tick(1200);
  assert.equal(f.engine.state.items.length, 0);
  assert.equal(f.sent.length, 0);
});

test('an unconfirmed post-click result is a coded error with diagnostic callback, never manual recovery', async () => {
  const f = fixture(); const faults = []; f.engine.onError = fault => faults.push(fault);
  f.adapter.send = async (_text, _before, _valid, click) => { click(); throw Object.assign(new Error('ack timeout'), { code: 'Q_ACK_TIMEOUT' }); };
  f.engine.add('A'); f.engine.resume(); await f.tick(); await f.tick(1200);
  assert.equal(f.engine.recovery, false);
  assert.equal(f.engine.state.fault.code, 'Q_ACK_TIMEOUT');
  assert.equal(faults.length, 1);
  assert.equal(f.engine.state.paused, true);
  assert.equal(f.engine.state.items.length, 1);
  assert.equal(typeof f.engine.resolve, 'undefined');
});
