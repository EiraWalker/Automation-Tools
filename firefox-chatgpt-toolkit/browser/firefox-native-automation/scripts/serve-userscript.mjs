// SPDX-License-Identifier: MIT
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { options, required, number } from './options.mjs';
export async function serveUserscript(file, port = 8766) {
  const source = path.resolve(file);
  if (!source.endsWith('.user.js')) throw new Error('Only a .user.js file may be served');
  await fs.access(source);
  const route = '/' + encodeURIComponent(path.basename(source));
  const server = http.createServer(async (req, res) => {
    if (req.url !== route) { res.writeHead(404); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    try {
      const content = await fs.readFile(source);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(503); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}${route}` };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const opts = options(process.argv.slice(2), { file: 'value', port: 'value' });
  const { server, url } = await serveUserscript(required(opts.file, '--file'), number(opts.port, 8766, 0, 65535));
  console.log(JSON.stringify({ status: 'ready', url }));
  process.on('SIGINT', () => server.close()); process.on('SIGTERM', () => server.close());
}
