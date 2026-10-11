import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HOST, PORT, BASE, optionalJson, atomicJson, publishRelease, loadRelease } from './userscript-release.mjs';
import { createUpdateServer } from './userscript-server.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const directory = resolve(root, '.local/userscript-update');
const plugin = resolve(root, 'firefox-chatgpt-toolkit/userscripts/chatgpt-queue');
const serviceFile = join(directory, 'service.json');
const thisFile = fileURLToPath(import.meta.url);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function health() {
  try {
    const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { return null; }
}
async function ownedHealth() {
  const [state, live] = await Promise.all([optionalJson(serviceFile), health()]);
  if (live && (live.service !== 'chatgpt-queue-update' || !state || live.instance !== state.instance)) {
    throw new Error('U_PORT_NOT_OWNED');
  }
  return { state, live };
}
async function serve(instance) {
  if (!/^[a-f0-9-]{36}$/.test(instance || '')) throw new Error('U_INSTANCE_INVALID');
  await loadRelease(directory);
  const server = createUpdateServer({ directory, instance });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(PORT, HOST, ok); });
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await atomicJson(serviceFile, { instance, pid: process.pid, port: PORT, expiresAt });
  const stopFile = join(directory, `${instance}.stop`);
  let ending = false;
  const timer = setInterval(async () => {
    if (ending) return;
    const stop = await readFile(stopFile, 'utf8').catch(() => null);
    if (stop === instance || Date.now() >= Date.parse(expiresAt)) {
      ending = true; clearInterval(timer);
      server.close(); server.closeIdleConnections();
      await unlink(stopFile).catch(() => {});
      if ((await optionalJson(serviceFile))?.instance === instance) await unlink(serviceFile);
    }
  }, 500);
}
async function start() {
  await loadRelease(directory);
  const { state, live } = await ownedHealth();
  if (live) return { alreadyRunning: true, ...live, expiresAt: state.expiresAt };
  const instance = randomUUID();
  // An explicitly requested development publisher, not a Windows service/startup task.
  const child = spawn(process.execPath, [thisFile, '_serve', instance], {
    detached: true, windowsHide: true, stdio: 'ignore', cwd: root,
  });
  let launchError = false;
  child.on('error', () => { launchError = true; });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const result = await health();
    if (result?.instance === instance) return { alreadyRunning: false, ...result,
      expiresAt: (await optionalJson(serviceFile))?.expiresAt };
    if (launchError) break;
  }
  throw new Error('U_SERVER_START_FAILED_PORT_OR_RELEASE');
}
async function stop() {
  const { state, live } = await ownedHealth();
  if (!live) return { stopped: false, running: false };
  await writeFile(join(directory, `${state.instance}.stop`), state.instance, { flag: 'wx' });
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    if ((await health())?.instance !== state.instance) return { stopped: true };
  }
  throw new Error('U_STOP_TIMEOUT');
}
async function publish() {
  await mkdir(directory, { recursive: true });
  const execute = promisify(execFile);
  // Reuse the project's positive-count test gate; no browser interaction or npm shell.
  const result = await execute('python', ['-X', 'utf8', resolve(root, 'scripts/verify-project.py'),
    'node-tests', 'firefox-chatgpt-toolkit/userscripts/chatgpt-queue'], {
    cwd: root, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
  });
  await writeFile(join(directory, 'last-check.log'), result.stdout + result.stderr);
  await execute(process.execPath, ['--check', 'chatgpt-queue.user.js'], { cwd: plugin, windowsHide: true });
  const release = await publishRelease(directory, await readFile(join(plugin, 'chatgpt-queue.user.js'), 'utf8'));
  return { release, installation: 'not_verified', installUrl: `${BASE}/chatgpt-queue.user.js` };
}

try {
  const [command, instance, ...extra] = process.argv.slice(2);
  if (extra.length || instance && command !== '_serve') throw new Error('U_USAGE');
  let result;
  if (command === '_serve') await serve(instance);
  else if (command === 'publish') result = await publish();
  else if (command === 'start') result = await start();
  else if (command === 'update') { result = await publish(); result.server = await start(); }
  else if (command === 'stop') result = await stop();
  else if (command === 'status') {
    const { state, live } = await ownedHealth();
    const release = await optionalJson(join(directory, 'current.json'));
    result = { running: !!live, expiresAt: live ? state.expiresAt : null, release,
      installation: 'not_verified', installUrl: `${BASE}/chatgpt-queue.user.js` };
  } else throw new Error('U_USAGE: publish|start|update|stop|status');
  if (result) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', code: /^U_[A-Z_]+/.exec(error.message)?.[0] ||
    (error.code === 'EEXIST' ? 'U_PUBLISH_LOCK_OR_RELEASE_EXISTS' : 'U_WORKFLOW_FAILED') }));
  process.exitCode = 1;
}
