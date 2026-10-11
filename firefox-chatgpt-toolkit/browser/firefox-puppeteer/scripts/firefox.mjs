import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withExistingPage, inspectArchive, inspectEnvironment } from './session.mjs';
import { inspectEndpoint, assertRuntime, startObservation } from './windows.mjs';

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const command = process.argv[2];
const args = process.argv.slice(3);
const configFlag = args.indexOf('--config');
const configPath = configFlag >= 0 ? args[configFlag + 1] : resolve(projectRoot, '.local/firefox-connection.json');

try {
  if (!['doctor', 'inspect', 'environment'].includes(command) ||
      (args.length && !(args.length === 2 && configFlag === 0 && configPath))) {
    throw new Error('F_USAGE: node scripts/firefox.mjs doctor|inspect|environment [--config path]');
  }
  let config;
  try { config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (command === 'doctor' && error.code === 'ENOENT') config = {
      endpoint: 'ws://127.0.0.1:9222/session', browserExecutable: 'C:\\Program Files\\Firefox Nightly\\firefox.exe',
    };
    else throw new Error('F_CONFIG_UNREADABLE');
  }
  const runtime = await inspectEndpoint(config.endpoint);
  if (command === 'doctor') {
    const require = createRequire(import.meta.url);
    let code = 'F_RUNTIME_READY_HANDSHAKE_PENDING';
    try { assertRuntime(runtime, config.browserExecutable); }
    catch (error) { code = error.message; process.exitCode = 2; }
    console.log(JSON.stringify({
      node: process.version,
      puppeteer: require('puppeteer-core/package.json').version,
      runtime,
      browserAcceptance: 'not_run',
      code,
    }));
  } else {
    assertRuntime(runtime, config.browserExecutable);
    const observer = await startObservation(runtime.processId);
    let result, observation, failure;
    try { result = await withExistingPage(config, command === 'environment' ? inspectEnvironment : inspectArchive); }
    catch (error) { failure = /^F_[A-Z_]+/.exec(error.message)?.[0] || 'F_CONNECT_OR_INSPECT_FAILED'; }
    finally {
      try { observation = await observer.stop(); }
      catch { failure ??= 'F_WINDOWS_OBSERVER_FAILED'; }
    }
    const after = await inspectEndpoint(config.endpoint);
    const processPreserved = after.processId === runtime.processId && after.executablePath === runtime.executablePath;
    const unchanged = observation?.coverage === 'sampled' && observation.foregroundUnchanged && observation.clipboardUnchanged && observation.windowsUnchanged;
    const checkedAt = new Date().toISOString();
    const report = { checkedAt, command, runtime, processPreserved, observation, result, failure: failure ?? null };
    const output = resolve(projectRoot, `.local/firefox-runs/${checkedAt.replace(/[:.]/g, '-')}-${command}.json`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    if (failure) {
      console.error(JSON.stringify({ status: 'failed', code: failure, output }));
      process.exitCode = 1;
    } else {
      const complete = unchanged && processPreserved && (command !== 'environment' || result.webdriverFalse && result.pageStateUnchanged);
      console.log(JSON.stringify({ status: complete ? 'passed' : 'inconclusive',
        browserAcceptance: 'read_only', nonInterference: unchanged ? 'sampled_unchanged' : 'inconclusive',
        webdriverFalse: result.webdriverFalse, archiveButtons: result.buttons?.length,
        runningUserscriptVersion: result.runningUserscriptVersion, output }));
      process.exitCode = complete ? 0 : 2;
    }
  }
} catch (error) {
  // Protocol errors can contain private page data. Only publish our own code.
  console.error(JSON.stringify({ status: 'failed', code: /^F_[A-Z_]+/.exec(error.message)?.[0] || 'F_CONNECT_OR_INSPECT_FAILED' }));
  process.exitCode = 1;
}
