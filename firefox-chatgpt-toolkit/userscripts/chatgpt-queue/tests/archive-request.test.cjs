/* SPDX-License-Identifier: GPL-3.0-or-later */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const archive = require('../src/archive-core.cjs');
const source = fs.readFileSync(path.join(__dirname, '../src/archive-browser.js'), 'utf8');

function requestWith(transport) {
  const context = { module: { exports: {} }, URL, ...archive };
  if (transport) context.GM_xmlhttpRequest = transport;
  vm.runInNewContext(source, context);
  return context.module.exports.archiveRequest;
}

test('GM transport preserves archive methods, payloads and explicit authorization without browser cookies', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const input = { url: 'https://api.example/vault/note.md', method, headers: { Authorization: 'Bearer fixture-secret' }, timeout: 20000, ...(method === 'POST' || method === 'PUT' ? { data: 'fixture body' } : {}) };
    const request = requestWith(options => {
      assert.equal(options.method, method);
      assert.deepEqual(options.headers, input.headers);
      assert.equal(options.data, input.data);
      assert.equal(options.timeout, 20000);
      assert.equal(options.anonymous, true);
      options.onload({ status: 200, responseText: 'fixture response', finalUrl: input.url });
    });
    const response = await request(input);
    assert.equal(response.status, 200);
    assert.equal(response.text, 'fixture response');
  }
});

test('response address check canonicalizes hosts, default ports and fragments', async () => {
  const request = requestWith(options => options.onload({ status: 200, responseText: 'ok', finalUrl: 'https://api.example/v1/messages?model=x#returned' }));
  const response = await request({ url: 'HTTPS://API.EXAMPLE:443/v1/messages?model=x#requested' });
  assert.equal(response.text, 'ok');
});

test('redirected responses are rejected for changed origins, paths, queries and unhandled 3xx responses', async () => {
  for (const [status, finalUrl] of [
    [200, 'https://other.example/v1/messages'],
    [200, 'http://api.example/v1/messages'],
    [200, 'https://api.example/v1/messages/'],
    [200, 'https://api.example/v1/messages?redirected=1'],
    [302, 'https://api.example/v1/messages'],
  ]) {
    const request = requestWith(options => options.onload({ status, finalUrl, responseText: 'fixture-secret' }));
    await assert.rejects(request({ url: 'https://api.example/v1/messages' }), error => error.code === 'A_REQUEST_REDIRECT' && !error.message.includes('fixture-secret') && !error.message.includes(finalUrl));
  }
});

test('responses with missing or malformed finalUrl cannot be accepted as verified API responses', async () => {
  for (const finalUrl of [undefined, '', 'not an absolute URL']) {
    const request = requestWith(options => options.onload({ status: 200, finalUrl, responseText: 'fixture-secret' }));
    await assert.rejects(request({ url: 'https://api.example/v1/messages' }), { code: 'A_REQUEST_RESPONSE' });
  }
});

test('missing GM permission and transport failures never include request or extension error details', async () => {
  await assert.rejects(requestWith()({ url: 'https://api.example/' }), { code: 'A_REQUEST_PERMISSION' });
  const failing = requestWith(() => { throw new Error('fixture-secret https://private.example/'); });
  await assert.rejects(failing({ url: 'https://api.example/' }), { message: 'network' });
  for (const [event, message] of [['onerror', 'network'], ['ontimeout', 'timeout'], ['onabort', 'aborted']]) {
    const request = requestWith(options => options[event]({ responseText: 'fixture-secret', message: 'private request details' }));
    await assert.rejects(request({ url: 'https://api.example/' }), { message });
  }
});

test('redirected PUT stops archive verification, mapping updates and deletion of the old note', async () => {
  const methods = [], mappings = [];
  const request = requestWith(options => {
    methods.push(options.method);
    // XHR has already followed the redirect here; this fixture proves only
    // that the archive workflow stops, not that the redirected PUT was blocked.
    options.onload({ status: 204, responseText: '', finalUrl: 'https://redirected.example/note.md' });
  });
  const service = new archive.ArchiveService({
    config: { ...archive.ARCHIVE_DEFAULTS, obsidianKey: 'fixture-secret' }, request,
    readMapping: () => ({ path: 'old-note.md', pending: [] }),
    writeMapping: (...args) => mappings.push(args),
  });
  const snapshot = { mode: 'chat', conversation: 'fixture', answerId: 'a1', key: 'chat:fixture:a1', url: 'https://chatgpt.com/c/fixture', question: 'Question', answer: 'Answer' };
  await assert.rejects(service.save(snapshot, { title: 'New note', folder: '', tags: [] }), { code: 'A_REQUEST_REDIRECT' });
  assert.deepEqual(methods, ['PUT']);
  assert.deepEqual(mappings, []);
});

test('archive service preserves known request errors while sanitizing unknown transport errors', async () => {
  const service = new archive.ArchiveService({ config: { ...archive.ARCHIVE_DEFAULTS, obsidianKey: 'fixture-secret', aiKey: 'fixture-secret' }, request: requestWith() });
  await assert.rejects(service.call('obsidian', '/tags/'), { code: 'A_REQUEST_PERMISSION' });
  service.request = requestWith(options => options.onload({ status: 200, responseText: 'fixture-secret' }));
  await assert.rejects(service.call('ai', '/chat/completions'), { code: 'A_REQUEST_RESPONSE' });
  service.request = async () => { throw Object.assign(new Error('fixture-secret'), { code: 'FOREIGN_ERROR' }); };
  for (const [kind, code] of [['obsidian', 'A_OBSIDIAN_UNAVAILABLE'], ['ai', 'A_AI_UNAVAILABLE']]) {
    await assert.rejects(service.call(kind, '/'), error => error.code === code && !error.message.includes('fixture-secret'));
  }
});
