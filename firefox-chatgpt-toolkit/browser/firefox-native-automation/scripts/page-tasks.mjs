// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';

export function wrapPageTask({ title, url, sentinel = `CHECK_${randomUUID().replaceAll('-', '')}` }, body) {
  if (!title || !url || !/^[A-Za-z][A-Za-z0-9_-]{2,79}$/.test(sentinel)) throw new Error('Exact title, URL and a short sentinel are required');
  const canonicalUrl = new URL(url).href;
  return `(async () => {\nconst expected = ${JSON.stringify({ title, url: canonicalUrl, sentinel })};\ntry {\nif (document.title !== expected.title || location.href !== expected.url) throw new Error('Document changed; no page action performed');\nconst result = await (async () => {\n${body}\n})();\nconsole.log(expected.sentinel + ' ' + JSON.stringify({ok:true,...result}));\n} catch (error) { console.log(expected.sentinel + ' ' + JSON.stringify({ok:false,error:error.message})); }\n})();\n`;
}

export function userscriptTask({ mode, source, namespace, saveId, ...guard }) {
  if (!['prepare', 'apply'].includes(mode) || !namespace || !source.startsWith('// ==UserScript==')) throw new Error('Userscript, namespace and prepare/apply mode are required');
  if (!saveId) throw new Error('Exact save control id is required');
  return wrapPageTask(guard, `
const desired = ${JSON.stringify(source)}, namespace = ${JSON.stringify(namespace)}, saveId = ${JSON.stringify(saveId)};
const metadataNamespace = code => /^\\/\\/\\s*@namespace\\s+(.+)$/m.exec(code)?.[1].trim();
if (metadataNamespace(desired) !== namespace) throw new Error('Source namespace differs');
const editors = [...document.querySelectorAll('.CodeMirror')].map(node => node.CodeMirror).filter(cm => cm && metadataNamespace(cm.getValue()) === namespace);
if (editors.length !== 1) throw new Error('Exactly one matching CodeMirror editor is required');
const cm = editors[0], save = document.getElementById(saveId);
if (!save || save.getAttribute('aria-disabled') === 'true' || save.disabled) throw new Error('Save control is unavailable');
const key = 'firefox-toolkit-userscript-backup:' + namespace;
${mode === 'prepare' ? `
const previous = sessionStorage.getItem(key);
if (previous && cm.getValue() !== previous && cm.getValue() !== desired) throw new Error('Another editor change conflicts with the existing backup');
if (!previous) sessionStorage.setItem(key, cm.getValue());
cm.setValue(desired);
if (cm.getValue() !== desired) throw new Error('Editor did not accept the complete source');
return {action:'prepared',characters:desired.length,saveRequested:false};` : `
if (cm.getValue() !== desired) throw new Error('Editor changed after preparation');
save.click();
return {action:'save_requested',installedVerified:false};`}
`);
}

export function draftTask({ mode, selector = '#prompt-textarea', key = 'firefox-toolkit-draft-backup', busySelector, ...guard }) {
  if (!['backup', 'restore'].includes(mode)) throw new Error('Use backup or restore');
  return wrapPageTask(guard, `
const selector = ${JSON.stringify(selector)}, key = ${JSON.stringify(key)}, busy = ${JSON.stringify(busySelector || '')};
const editors = [...document.querySelectorAll(selector)].filter(el => !el.hidden && getComputedStyle(el).display !== 'none');
if (editors.length !== 1) throw new Error('Exactly one visible editor is required');
const editor = editors[0], read = () => 'value' in editor ? editor.value : editor.innerText || editor.textContent || '';
${mode === 'backup' ? `
if (sessionStorage.getItem(key)) throw new Error('A draft backup already exists; it will not be overwritten');
const text = read();
sessionStorage.setItem(key, JSON.stringify({url:location.href,text}));
return {action:'draft_backed_up',characters:text.length};` : `
if (busy && document.querySelector(busy)) throw new Error('Page is busy; draft restoration deferred');
const raw = sessionStorage.getItem(key);
if (!raw) throw new Error('No draft backup exists');
const backup = JSON.parse(raw);
if (backup.url !== location.href || typeof backup.text !== 'string') throw new Error('Draft belongs to a different document');
if (read() && read() !== backup.text) throw new Error('A new draft exists; it has been preserved');
if (read() !== backup.text) {
 if ('value' in editor) {
  const proto = editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(editor,backup.text);
  editor.dispatchEvent(new Event('input',{bubbles:true}));
 } else {
  editor.focus();
  if (!document.execCommand('insertText',false,backup.text)) throw new Error('Native editor insertion failed');
 }
}
if (read() !== backup.text) throw new Error('Draft readback differs; backup retained');
sessionStorage.removeItem(key);
return {action:'draft_restored',characters:backup.text.length};`}
`);
}
