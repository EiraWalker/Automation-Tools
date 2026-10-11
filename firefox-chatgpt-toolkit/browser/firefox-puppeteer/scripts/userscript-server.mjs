import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HOST, loadRelease } from './userscript-release.mjs';

// Static script distribution only: no filesystem browsing, browser control or remote writes.
export function createUpdateServer({ directory, instance }) {
  return createServer(async (request, response) => {
    const port = request.socket.localPort;
    const finish = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (request.headers.host !== `${HOST}:${port}`) return finish(403, '{}');
    if (!['GET', 'HEAD'].includes(request.method)) return finish(405, '{}');
    const path = new URL(request.url, `http://${HOST}:${port}`).pathname;
    const pinned = /^\/releases\/(\d+\.\d+\.\d+\.\d+)\.user\.js$/.exec(path)?.[1];
    if (!pinned && !['/health', '/chatgpt-queue.user.js', '/chatgpt-queue.meta.js'].includes(path)) return finish(404, '{}');
    try {
      const release = await loadRelease(directory, pinned);
      if (path === '/health') return finish(200, JSON.stringify({ service: 'chatgpt-queue-update', instance,
        version: release.manifest.version, scriptHash: release.manifest.scriptHash }));
      const kind = path.endsWith('.meta.js') ? 'metadata' : 'script';
      // Requests are delivery evidence, never proof of installation. Do not log URL queries/headers.
      await appendFile(join(directory, 'requests.jsonl'), JSON.stringify({ at: new Date().toISOString(),
        kind, method: request.method, version: release.manifest.version }) + '\n');
      finish(200, kind === 'metadata' ? release.metadata : release.script, 'text/javascript; charset=utf-8');
    } catch { finish(503, JSON.stringify({ code: 'U_RELEASE_UNAVAILABLE' })); }
  });
}
