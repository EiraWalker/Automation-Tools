import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { prepareRelease, publishRelease, loadRelease, parseMetadata, sha256, BASE } from '../scripts/userscript-release.mjs';
import { createUpdateServer } from '../scripts/userscript-server.mjs';

const source = `// ==UserScript==
// @name ChatGPT Queue · Accent
// @namespace local.chatgpt-queue-accent
// @version 1.8.1
// @noframes
// @updateURL none
// @downloadURL none
// @grant GM_getValue
// ==/UserScript==
(() => { const fixture = 1; })();
`;
async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'userscript-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
test('release keeps identity, grants and body; uses stable update URLs and monotonically versions changes', () => {
  const first = prepareRelease(source, null);
  assert.equal(prepareRelease(source.replaceAll('\n', '\r\n'), null).manifest.version, '1.8.1.1');
  assert.equal(first.manifest.version, '1.8.1.1');
  assert.ok(first.script.endsWith(source.slice(source.indexOf('// ==/UserScript=='))));
  assert.match(first.script, /@grant GM_getValue/);
  assert.equal(parseMetadata(first.script).fields.downloadURL[0], `${BASE}/chatgpt-queue.user.js`);
  assert.equal(parseMetadata(first.metadata).fields.updateURL[0], `${BASE}/chatgpt-queue.meta.js`);
  assert.equal(prepareRelease(source, first.manifest), null);
  assert.equal(prepareRelease(source + '\n', first.manifest).manifest.version, '1.8.1.2');
  assert.equal(prepareRelease(source.replace('1.8.1', '1.8.2'), first.manifest).manifest.version, '1.8.2.1');
  assert.throws(() => prepareRelease(source.replace('1.8.1', '1.8.0'), first.manifest), /U_VERSION_DOWNGRADE/);
});

test('publishing unchanged source migrates a legacy pinned-download release once and preserves its archive', async t => {
  const directory = await temporary(t);
  const initial = prepareRelease(source, null);
  const oldScript = initial.script.replace(`${BASE}/chatgpt-queue.user.js`, `${BASE}/releases/1.8.1.1.user.js`);
  const oldMetadata = parseMetadata(oldScript).header + '\n';
  const { updateURL, downloadURL, ...oldManifest } = initial.manifest;
  oldManifest.scriptHash = sha256(oldScript);
  await mkdir(join(directory, 'releases'));
  const stem = join(directory, 'releases', oldManifest.version);
  await writeFile(`${stem}.user.js`, oldScript);
  await writeFile(`${stem}.meta.js`, oldMetadata);
  await writeFile(`${stem}.json`, JSON.stringify(oldManifest));
  await writeFile(join(directory, 'current.json'), JSON.stringify(oldManifest));
  const result = await publishRelease(directory, source);
  assert.equal(result.changed, true);
  assert.equal(result.version, '1.8.1.2');
  assert.equal(result.sourceHash, oldManifest.sourceHash);
  assert.equal(parseMetadata((await loadRelease(directory)).script).fields.downloadURL[0], `${BASE}/chatgpt-queue.user.js`);
  assert.equal((await loadRelease(directory, '1.8.1.1')).script, oldScript);
  assert.equal((await publishRelease(directory, source)).changed, false);
});
test('publisher rejects ambiguous/foreign identity and keeps immutable releases', async t => {
  const directory = await temporary(t);
  assert.throws(() => prepareRelease(source.replace('local.chatgpt-queue-accent', 'other'), null), /U_SCRIPT_IDENTITY/);
  assert.throws(() => prepareRelease(source.replace('// @version', '// @version 7\n// @version'), null), /U_METADATA_AMBIGUOUS/);
  await publishRelease(directory, source);
  const old = await loadRelease(directory);
  await publishRelease(directory, source + '\n');
  assert.equal((await loadRelease(directory)).manifest.version, '1.8.1.2');
  assert.equal((await loadRelease(directory, '1.8.1.1')).script, old.script);
  assert.equal((await publishRelease(directory, source + '\n')).changed, false);
  await writeFile(join(directory, 'publish.lock'), '{}');
  await assert.rejects(publishRelease(directory, source + '\n\n'), { code: 'EEXIST' });
  assert.equal((await loadRelease(directory)).manifest.version, '1.8.1.2');
});
test('distribution detects tampered source and metadata', async t => {
  const directory = await temporary(t);
  await publishRelease(directory, source);
  await writeFile(join(directory, 'releases', '1.8.1.1.meta.js'), 'incorrect');
  await assert.rejects(loadRelease(directory), /U_RELEASE_CORRUPT/);
});
test('real loopback HTTP serves only validated releases, retains pinned versions and rejects remote host/write/traversal', async t => {
  const directory = await temporary(t);
  await publishRelease(directory, source);
  const server = createUpdateServer({ directory, instance: 'test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const first = await (await fetch(base + '/chatgpt-queue.meta.js')).text();
  const installed = parseMetadata(await (await fetch(base + '/chatgpt-queue.user.js')).text());
  await publishRelease(directory, source + '\n');
  assert.match(first, /1\.8\.1\.1/);
  // VM 2.49 retains these URLs from the installed script while checking a new
  // metadata version. Use the test server port with those exact stored paths.
  const available = parseMetadata(await (await fetch(base + new URL(installed.fields.updateURL[0]).pathname)).text());
  assert.equal(available.version, '1.8.1.2');
  const old = await fetch(base + '/releases/1.8.1.1.user.js');
  assert.match(await old.text(), /@version\s+1\.8\.1\.1/);
  const current = await fetch(base + new URL(installed.fields.downloadURL[0]).pathname);
  assert.match(await current.text(), /@version\s+1\.8\.1\.2/);
  assert.equal(current.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(base + '/chatgpt-queue.user.js', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/.local/firefox-connection.json')).status, 404);
  assert.equal((await fetch(base + '/releases/%2e%2e/current.json')).status, 404);
  const rejected = await new Promise((resolve, reject) => {
    const req = request(base + '/health', { headers: { Host: 'attacker.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    }); req.on('error', reject); req.end();
  });
  assert.equal(rejected, 403);
  assert.equal((await (await fetch(base + '/health')).json()).version, '1.8.1.2');
  const evidence = await readFile(join(directory, 'requests.jsonl'), 'utf8');
  assert.ok(!evidence.includes('attacker') && !evidence.includes('installation'));
});
