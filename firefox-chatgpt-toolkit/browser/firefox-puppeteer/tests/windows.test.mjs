import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntime, summarizeObservation } from '../scripts/windows.mjs';

const executable = 'C:\\Program Files\\Firefox Nightly\\firefox.exe';
const runtime = { listening: true, uniqueOwner: true, loopbackOnly: true, executablePath: executable, automationFlags: false };
test('connecting requires the expected process and runtime startup on loopback', () => {
  assert.equal(assertRuntime(runtime, executable.toLowerCase()), runtime);
  for (const [change, code] of [
    [{ listening: false }, 'F_ENDPOINT_UNAVAILABLE'],
    [{ uniqueOwner: false }, 'F_ENDPOINT_OWNER_INVALID'],
    [{ loopbackOnly: false }, 'F_ENDPOINT_OWNER_INVALID'],
    [{ executablePath: 'C:\\other\\firefox.exe' }, 'F_BROWSER_EXECUTABLE_MISMATCH'],
    [{ automationFlags: true }, 'F_AUTOMATION_STARTUP'],
  ]) assert.throws(() => assertRuntime({ ...runtime, ...change }, executable), new RegExp(code));
  assert.throws(() => assertRuntime(runtime, undefined), /F_BROWSER_EXECUTABLE_MISMATCH/);
});
test('observation reports incomplete coverage and user-visible changes without claiming causality', () => {
  const sample = { elapsedMs: 0, foreground: '101', clipboardSequence: 5, selectionReadable: true, windows: [{ hwnd: '102', selectedTab: '42' }] };
  assert.equal(summarizeObservation([sample]).coverage, 'incomplete');
  const unchanged = summarizeObservation([sample, { ...sample, elapsedMs: 100 }]);
  assert.equal(unchanged.coverage, 'sampled');
  assert.equal(unchanged.foregroundUnchanged && unchanged.clipboardUnchanged && unchanged.windowsUnchanged, true);
  const changed = summarizeObservation([sample, { ...sample, foreground: '102', clipboardSequence: 6, windows: [] }]);
  assert.equal(changed.foregroundUnchanged || changed.clipboardUnchanged || changed.windowsUnchanged, false);
  assert.equal(summarizeObservation([sample, { ...sample, selectionReadable: false }]).coverage, 'incomplete');
});
