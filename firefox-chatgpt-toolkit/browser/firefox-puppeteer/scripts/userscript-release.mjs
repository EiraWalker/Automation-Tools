import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const HOST = '127.0.0.1';
export const PORT = 18765;
export const BASE = `http://${HOST}:${PORT}`;
export const NAME = 'ChatGPT Queue · Accent';
export const NAMESPACE = 'local.chatgpt-queue-accent';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const readJson = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
export async function optionalJson(path) {
  try { return await readJson(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function atomicJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
  try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => {}); }
}

export function parseMetadata(source) {
  const header = /^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==/m.exec(source)?.[0];
  if (!header || !source.startsWith('// ==UserScript==')) throw new Error('U_METADATA_INVALID');
  const fields = {};
  for (const match of header.matchAll(/^\/\/[ \t]+@(\S+)[ \t]+([^\r\n]+)/gm)) {
    const key = match[1];
    (fields[key] ??= []).push(match[2].trim());
  }
  for (const key of ['name', 'namespace', 'version', 'updateURL', 'downloadURL']) {
    if (fields[key]?.length !== 1) throw new Error('U_METADATA_AMBIGUOUS');
  }
  if (fields.name[0] !== NAME || fields.namespace[0] !== NAMESPACE) throw new Error('U_SCRIPT_IDENTITY');
  return { header, fields, version: fields.version[0] };
}

export function prepareRelease(source, previous) {
  const { header, version: baseVersion } = parseMetadata(source);
  if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) throw new Error('U_BASE_VERSION_INVALID');
  if (previous) {
    const a = baseVersion.split('.').map(Number), b = previous.baseVersion.split('.').map(Number);
    const index = a.findIndex((value, i) => value !== b[i]);
    if (index >= 0 && a[index] < b[index]) throw new Error('U_VERSION_DOWNGRADE');
  }
  const sourceHash = sha256(source);
  const updateURL = `${BASE}/chatgpt-queue.meta.js`;
  const downloadURL = `${BASE}/chatgpt-queue.user.js`;
  // Publishing policy also matters: legacy manifests used a pinned download
  // URL and must receive a new revision even when the source is unchanged.
  if (previous?.sourceHash === sourceHash && previous.updateURL === updateURL && previous.downloadURL === downloadURL) return null;
  const revision = previous?.baseVersion === baseVersion ? previous.revision + 1 : 1;
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('U_REVISION_INVALID');
  const version = `${baseVersion}.${revision}`;
  let metadata = header.replace(/^\/\/\s+@version\s+.*$/m, `// @version      ${version}`)
    .replace(/^\/\/\s+@updateURL\s+.*$/m, `// @updateURL    ${updateURL}`)
    // Violentmonkey downloads from the installed script's URL, not the new
    // metadata's URL. Keep this stable while archiving immutable release files.
    .replace(/^\/\/\s+@downloadURL\s+.*$/m, `// @downloadURL  ${downloadURL}`);
  const script = metadata + source.slice(header.length);
  metadata += '\n';
  return { manifest: { schema: 1, name: NAME, namespace: NAMESPACE, baseVersion, revision,
    version, sourceHash, updateURL, downloadURL, scriptHash: sha256(script), publishedAt: new Date().toISOString() }, script, metadata };
}

export async function publishRelease(directory, source) {
  await mkdir(join(directory, 'releases'), { recursive: true });
  // Exclusive lock prevents concurrent publishers from reusing a revision.
  const lock = join(directory, 'publish.lock');
  await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
  try {
    const previous = await optionalJson(join(directory, 'current.json'));
    const release = prepareRelease(source, previous);
    if (!release) { await loadRelease(directory); return { changed: false, ...previous }; }
    const { manifest, script, metadata } = release;
    const stem = join(directory, 'releases', manifest.version);
    await writeFile(`${stem}.user.js`, script, { flag: 'wx' });
    await writeFile(`${stem}.meta.js`, metadata, { flag: 'wx' });
    await writeFile(`${stem}.json`, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await atomicJson(join(directory, 'current.json'), manifest);
    return { changed: true, ...manifest };
  } finally { await unlink(lock); }
}

export async function loadRelease(directory, version) {
  if (version && !/^\d+\.\d+\.\d+\.\d+$/.test(version)) throw new Error('U_VERSION_INVALID');
  const manifest = await readJson(version ? join(directory, 'releases', `${version}.json`) : join(directory, 'current.json'));
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('U_VERSION_INVALID');
  const stem = join(directory, 'releases', manifest.version);
  const script = await readFile(`${stem}.user.js`, 'utf8');
  const metadata = await readFile(`${stem}.meta.js`, 'utf8');
  const parsed = parseMetadata(script);
  if (sha256(script) !== manifest.scriptHash || parsed.version !== manifest.version ||
      parsed.header + '\n' !== metadata) throw new Error('U_RELEASE_CORRUPT');
  return { manifest, script, metadata };
}
