import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateEndpoint } from './session.mjs';

const script = fileURLToPath(new URL('./windows-observer.ps1', import.meta.url));
const command = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];

export function assertRuntime(runtime, expectedExecutable) {
  if (!runtime.listening) throw new Error('F_ENDPOINT_UNAVAILABLE');
  if (!runtime.uniqueOwner || !runtime.loopbackOnly) throw new Error('F_ENDPOINT_OWNER_INVALID');
  if (typeof expectedExecutable !== 'string' || !expectedExecutable ||
      runtime.executablePath?.toLowerCase() !== expectedExecutable.toLowerCase()) throw new Error('F_BROWSER_EXECUTABLE_MISMATCH');
  if (runtime.automationFlags !== false) throw new Error('F_AUTOMATION_STARTUP');
  return runtime;
}

export async function inspectEndpoint(endpoint) {
  const port = new URL(validateEndpoint(endpoint)).port;
  const { stdout } = await promisify(execFile)('pwsh.exe', [...command, '-Mode', 'endpoint', '-Port', port], {
    windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

export function summarizeObservation(samples) {
  const first = samples[0];
  const sufficient = samples.length >= 2 && samples.every(sample => sample.selectionReadable);
  return {
    samples: samples.length,
    durationMs: samples.at(-1)?.elapsedMs ?? 0,
    coverage: sufficient ? 'sampled' : 'incomplete',
    foregroundUnchanged: !!first && samples.every(sample => sample.foreground === first.foreground),
    clipboardUnchanged: !!first && samples.every(sample => sample.clipboardSequence === first.clipboardSequence),
    windowsUnchanged: sufficient && samples.every(sample => JSON.stringify(sample.windows) === JSON.stringify(first.windows)),
  };
}

export async function startObservation(processId) {
  const stopFile = join(tmpdir(), `firefox-observer-${randomUUID()}.stop`);
  const child = spawn('pwsh.exe', [...command, '-Mode', 'watch', '-BrowserProcessId', String(processId), '-StopFile', stopFile], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const samples = [];
  let failure;
  const ready = Promise.withResolvers();
  const done = Promise.withResolvers();
  const lines = createInterface({ input: child.stdout });
  const timeout = setTimeout(() => { failure = new Error('F_WINDOWS_OBSERVER_FAILED'); ready.reject(failure); child.kill(); }, 15000);
  // stderr is deliberately not logged: Windows errors may contain private window data.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  lines.on('line', line => {
    try {
      const sample = JSON.parse(line);
      if (sample.error) throw new Error(sample.error);
      samples.push(sample);
      clearTimeout(timeout);
      ready.resolve();
    } catch { failure = new Error('F_WINDOWS_OBSERVER_FAILED'); ready.reject(failure); child.kill(); }
  });
  child.on('error', () => { failure = new Error('F_WINDOWS_OBSERVER_FAILED'); ready.reject(failure); });
  child.on('close', code => {
    clearTimeout(timeout);
    if (code !== 0 || samples.length === 0) failure ??= new Error('F_WINDOWS_OBSERVER_FAILED');
    if (!samples.length) ready.reject(failure);
    done.resolve();
  });
  try { await ready.promise; }
  catch (error) { child.kill(); await done.promise; throw error; }
  return {
    async stop() {
      await writeFile(stopFile, '', { flag: 'wx' });
      const stopTimeout = setTimeout(() => child.kill(), 10000);
      await done.promise;
      clearTimeout(stopTimeout);
      await unlink(stopFile);
      if (failure) throw failure;
      return { ...summarizeObservation(samples), observations: samples };
    },
  };
}
