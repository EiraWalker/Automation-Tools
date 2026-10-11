/* SPDX-License-Identifier: GPL-3.0-or-later */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { emptyState } = require('../src/core.cjs');
const source = fs.readFileSync(path.join(__dirname, '../chatgpt-queue.user.js'), 'utf8');

test('distribution selects page injection while preserving script identity and declared GM APIs', () => {
  const metadata = source.split('// ==/UserScript==')[0];
  assert.match(metadata, /@inject-into\s+page\s*$/m);
  assert.match(metadata, /@name\s+ChatGPT Queue · Accent\s*$/m);
  assert.match(metadata, /@namespace\s+local\.chatgpt-queue-accent\s*$/m);
  assert.match(metadata, new RegExp(`@version\\s+${require('../package.json').version.replaceAll('.', '\\.')}\\s*$`, 'm'));
  for (const name of new Set(source.match(/\bGM_[A-Za-z]+\b/g))) {
    if (name !== 'GM_info') assert.match(metadata, new RegExp(`@grant\\s+${name}\\s*$`, 'm'));
  }
});

for (const withExportFunction of [false, true]) {
test(`page-context runtime preserves stored queue, releases its lock, and reports manager/version (${withExportFunction ? 'Violentmonkey exportFunction polyfill' : 'no exportFunction'})`, async t => {
  const dom = new JSDOM('<main><form><textarea id="prompt-textarea"></textarea><button data-testid="stop-button">Stop</button></form></main>', {
    url: 'https://chatgpt.com/c/migration-fixture', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLElement.prototype.getClientRects = () => [{ width: 10 }];
  const key = 'cq-accent-v1:migration-fixture';
  const storage = new Map([[key, { ...emptyState(), items: [{ id: 'saved', text: 'preserved' }] }], ['cq-accent-layout-v1', false]]);
  const listeners = new Map(), exported = [];
  let lockName, held, copied;
  w.unsafeWindow = w;
  w.structuredClone = structuredClone;
  w.GM_info = { script: { version: '1.9.0.7' }, scriptHandler: 'Violentmonkey', injectInto: 'page' };
  w.GM_getValue = (name, fallback) => storage.has(name) ? structuredClone(storage.get(name)) : fallback;
  w.GM_setValue = (name, value) => storage.set(name, structuredClone(value));
  w.GM_registerMenuCommand = () => {};
  w.GM_setClipboard = text => { copied = JSON.parse(text); };
  w.GM_addValueChangeListener = (name, callback) => { const id = listeners.size; listeners.set(id, { name, callback }); return id; };
  w.GM_removeValueChangeListener = id => listeners.delete(id);
  // Violentmonkey 2.49 supplies this identity polyfill in Firefox page mode.
  if (withExportFunction) w.exportFunction = (callback, target) => {
    assert.equal(target, w);
    exported.push(callback);
    return callback;
  };
  Object.defineProperty(w.navigator, 'locks', { value: { request(name, options, callback) {
    lockName = name;
    assert.equal(options.ifAvailable, true);
    if (withExportFunction) assert.equal(callback, exported[0]);
    held = callback({});
    assert.ok(held instanceof w.Promise, 'Web Locks receives a page-realm Promise');
    return held;
  } } });
  assert.equal(typeof w.exportFunction, withExportFunction ? 'function' : 'undefined');
  w.eval(source);
  await new Promise(resolve => setImmediate(resolve));
  const host = w.document.getElementById('chatgpt-queue-accent');
  assert.equal(host.dataset.cqOwner, 'true');
  assert.equal(host.dataset.cqVersion, '1.9.0.7');
  assert.equal(host.dataset.cqScriptHandler, 'Violentmonkey');
  assert.equal(host.dataset.cqInjectInto, 'page');
  assert.equal(exported.length, withExportFunction ? 2 : 0, 'lock callback and Promise executor use the same supported bridge');
  assert.equal(lockName, `cq-accent-owner:${key}`);
  assert.equal(storage.get(key).items[0].text, 'preserved');
  assert.equal(storage.get(key).paused, true, 'restored queues never auto-resume during migration');
  assert.equal(w.document.querySelector('[data-cq-wide-root]'), null);
  host.shadowRoot.querySelector('.notice-card button').click();
  assert.equal(copied.scriptVersion, '1.9.0.7');
  assert.equal(copied.scriptHandler, 'Violentmonkey');
  assert.ok(!JSON.stringify(copied).includes('preserved'));
  w.dispatchEvent(new w.Event('pagehide'));
  await held;
  assert.equal(listeners.size, 0);
});
}
