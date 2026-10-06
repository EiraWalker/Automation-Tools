// SPDX-License-Identifier: MIT
import path from 'node:path';
import fs from 'node:fs/promises';
import { options, required, number } from './options.mjs';
import { submit, rpcPath, exists, readJson, delay } from './rpc-files.mjs';
try {
  const [command, ...argv] = process.argv.slice(2);
  const opts = options(argv, { dir: 'value', id: 'value', file: 'value', 'wait-ms': 'value' });
  const dir = path.resolve(required(opts.dir, '--dir'));
  if (command === 'stop') {
    await fs.writeFile(path.join(dir, 'stop'), '', { mode: 0o600 });
    console.log(JSON.stringify({ status: 'stop_requested' }));
  } else {
    if (!['submit', 'read'].includes(command)) throw new Error('Use submit, read or stop');
    const id = required(opts.id, '--id'), response = rpcPath(dir, id, 'response');
    if (command === 'submit') await submit(dir, id, await readJson(required(opts.file, '--file')));
    const wait = number(opts['wait-ms'], 0, 0, 60000), until = Date.now() + wait;
    while (!await exists(response) && Date.now() < until) await delay(100);
    console.log(JSON.stringify(await exists(response) ? await readJson(response) : { id, status: 'pending', responseFile: response }));
  }
} catch (error) { console.error(JSON.stringify({ status: 'error', message: error.message })); process.exitCode = 1; }
