// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function rpcPath(dir, id, suffix) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Request id must be 1-80 alphanumeric, dash or underscore characters');
  return path.join(dir, `${id}.${suffix}.json`);
}
export async function exists(file) {
  try { await fs.access(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function fingerprint(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export async function readJson(file) { return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')); }
export async function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  try { await fs.rename(temporary, file); } finally { await fs.rm(temporary, { force: true }); }
}
export async function submit(dir, id, request) {
  if (!request || typeof request.name !== 'string' || !request.name || !request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments)) throw new Error('Request requires name and an arguments object');
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = rpcPath(dir, id, 'request');
  // Exclusive creation fixes the identity before the bridge dispatches it.
  const envelope = { fingerprint: fingerprint(request), request };
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
  try {
    try { await fs.link(temporary, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if ((await readJson(file)).fingerprint !== envelope.fingerprint) throw new Error('Request id is already assigned to different arguments');
    }
  } finally { await fs.rm(temporary, { force: true }); }
  return envelope;
}
