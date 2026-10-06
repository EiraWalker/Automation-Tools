// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { options, required, number } from './options.mjs';
import { atomicJson, exists, readJson, rpcPath, delay } from './rpc-files.mjs';

const opts = options(process.argv.slice(2), { dir: 'value', server: 'value', 'marionette-port': 'value', 'timeout-ms': 'value', 'allow-tools': 'value', 'authorize-existing': 'flag' });
if (!opts['authorize-existing']) throw new Error('--authorize-existing is required; this bridge only attaches to an authorized existing Firefox');
const dir = path.resolve(required(opts.dir, '--dir'));
const port = number(opts['marionette-port'], 2828, 1, 65535);
const timeout = number(opts['timeout-ms'], 30000, 100, 60000);
const allow = new Set((opts['allow-tools'] || 'list_pages,get_firefox_info').split(',').filter(Boolean));
const server = opts.server ? path.resolve(opts.server) : createRequire(import.meta.url).resolve('@mozilla/firefox-devtools-mcp');
await fs.mkdir(dir, { recursive: true, mode: 0o700 });
const lock = path.join(dir, 'bridge.lock'), ready = path.join(dir, 'ready.json');
if (await exists(path.join(dir, 'stop'))) throw new Error('This directory contains a stop marker; choose a fresh private directory');
const handle = await fs.open(lock, 'wx', 0o600);
await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.close();
const transport = new StdioClientTransport({ command: process.execPath, args: [server, '--tool-preset', 'developer', '--connect-existing', '--marionette-port', String(port)], stderr: 'pipe' });
// Drain diagnostics without persisting browser URLs, page text or credentials in logs.
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'local-existing-firefox-bridge', version: '1.0.0' });
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
try {
  // Starting the stdio server takes longer than an individual test/tool deadline.
  await client.connect(transport, { timeout: Math.max(timeout, 10000) });
  const available = []; let cursor;
  do {
    const result = await client.listTools(cursor ? { cursor } : undefined);
    available.push(...result.tools.map(tool => tool.name)); cursor = result.nextCursor;
  } while (cursor);
  await atomicJson(ready, { pid: process.pid, connectedMode: 'existing-only', availableTools: available, allowedTools: [...allow] });
  console.log(JSON.stringify({ status: 'ready', connectedMode: 'existing-only' }));
  const previousClaims = new Set((await fs.readdir(dir)).filter(name => name.endsWith('.claimed.json')));
  while (!stopping && !await exists(path.join(dir, 'stop'))) {
    for (const file of (await fs.readdir(dir)).filter(name => name.endsWith('.request.json')).sort()) {
      if (stopping || await exists(path.join(dir, 'stop'))) break;
      const id = file.slice(0, -'.request.json'.length);
      const response = rpcPath(dir, id, 'response'), claim = rpcPath(dir, id, 'claimed');
      if (await exists(response)) continue;
      if (previousClaims.has(path.basename(claim))) {
        await atomicJson(response, { id, status: 'indeterminate', message: 'A previous bridge claimed this request. It is not replayed; inspect the browser state.' });
        continue;
      }
      let claimed = false;
      try {
        const { request } = await readJson(path.join(dir, file));
        if (!request || typeof request.name !== 'string' || !allow.has(request.name) || !available.includes(request.name)) throw new Error('Tool is unavailable or outside --allow-tools');
        const claimHandle = await fs.open(claim, 'wx', 0o600); await claimHandle.close(); claimed = true;
        const result = await client.callTool(request, undefined, { timeout });
        await atomicJson(response, { id, status: 'completed', result });
      } catch (error) {
        await atomicJson(response, { id, status: claimed ? 'indeterminate' : 'rejected', message: claimed ? 'Tool did not return a confirmed result. Request will not be retried.' : error.message });
      }
    }
    await delay(100);
  }
} finally {
  // close() tears down this stdio client/server, not the Firefox executable.
  try { await client.close(); }
  finally {
    await fs.rm(ready, { force: true });
    await fs.rm(lock, { force: true });
  }
}
