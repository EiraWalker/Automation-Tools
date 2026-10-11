import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEndpoint, validateTarget, withExistingPage, inspectArchive } from '../scripts/session.mjs';

const config = { endpoint: 'ws://127.0.0.1:9222/session', target: { url: 'https://example.test/approved', title: 'Approved test' } };
test('reject remote endpoints and incomplete targets before connecting', () => {
  for (const endpoint of ['ws://example.test:9222/session', 'ws://127.0.0.1:9222/session?token=x', 'ws://u:p@127.0.0.1:9222/session', 'ws://127.0.0.1:9222/other']) {
    assert.throws(() => validateEndpoint(endpoint), /F_ENDPOINT_INVALID/);
  }
  assert.throws(() => validateTarget({ url: config.target.url, title: '' }), /F_TARGET_INVALID/);
});
function fixture(pages) {
  let disconnects = 0;
  const browser = { version: async () => 'firefox/160.0a1', pages: async () => pages, disconnect: async () => { disconnects++; } };
  return { connect: async options => {
    assert.equal(options.protocol, 'webDriverBiDi');
    assert.equal(options.defaultViewport, null);
    assert.equal(options.acceptInsecureCerts, false);
    assert.equal(options.networkEnabled, false);
    assert.equal(options.capabilities.unhandledPromptBehavior, 'ignore');
    return browser;
  }, count: () => disconnects };
}
const page = { url: () => config.target.url, title: async () => config.target.title, evaluate: async () => ({ webdriver: false }) };
test('inspect only the unique matching page and disconnect without closing the browser', async () => {
  const other = { url: () => 'https://example.test/private', title: () => { throw new Error('unrelated page read'); } };
  const f = fixture([other, page]);
  assert.equal(await withExistingPage(config, async chosen => { assert.equal(chosen, page); return 7; }, f.connect), 7);
  assert.equal(f.count(), 1);
});
test('missing or duplicate targets dispatch no task and still disconnect', async () => {
  for (const pages of [[], [page, page]]) {
    const f = fixture(pages);
    await assert.rejects(withExistingPage(config, () => assert.fail('must not run'), f.connect), /F_TARGET_NOT_UNIQUE/);
    assert.equal(f.count(), 1);
  }
});
test('changed title prevents execution', async () => {
  const f = fixture([{ ...page, title: async () => 'Different page' }]);
  await assert.rejects(withExistingPage(config, () => assert.fail('must not run'), f.connect), /F_TARGET_CHANGED/);
  assert.equal(f.count(), 1);
});
test('task failure disconnects without repeating the task', async () => {
  const f = fixture([page]); let calls = 0;
  await assert.rejects(withExistingPage(config, () => { calls++; throw new Error('failed'); }, f.connect), /failed/);
  assert.equal(calls, 1); assert.equal(f.count(), 1);
});
test('automation mode stops before task execution without overriding navigator.webdriver', async () => {
  for (const webdriver of [true, undefined]) {
    const f = fixture([{ ...page, evaluate: async () => ({ webdriver }) }]);
    await assert.rejects(withExistingPage(config, () => assert.fail('must not run'), f.connect), /F_AUTOMATION_MODE/);
    assert.equal(f.count(), 1);
  }
});
test('inspection guards the actual document after a navigation race', async () => {
  globalThis.location = { href: 'https://example.test/changed' };
  globalThis.document = { title: config.target.title };
  try {
    await assert.rejects(inspectArchive({ evaluate: async (fn, arg) => fn(arg) }, config.target), /F_TARGET_CHANGED/);
  } finally { delete globalThis.location; delete globalThis.document; }
});
