/* SPDX-License-Identifier: GPL-3.0-or-later */
function archiveSyncTheme(host) {
  const body = getComputedStyle(document.body), html = getComputedStyle(document.documentElement);
  const background = [body.backgroundColor, html.backgroundColor].find(value => value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)');
  if (background) host.style.setProperty('--cq-settings-bg', background);
  host.style.setProperty('--cq-text', body.color); host.style.fontFamily = body.fontFamily; host.style.colorScheme = body.colorScheme;
}
function archiveRequest(options) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') { reject(archiveFailure('A_REQUEST_PERMISSION', '脚本缺少 API 请求权限，请重新安装完整脚本。')); return; }
    const request = {
      ...options, anonymous: true,
      // Tampermonkey supports this option; Violentmonkey 2.49 ignores it and
      // follows XHR redirects. The finalUrl check rejects the returned response,
      // but cannot prevent a redirect from transmitting credentials or a body.
      redirect: 'error',
      onload: response => {
        let expected, actual;
        try {
          expected = new URL(options.url); actual = new URL(response.finalUrl);
          expected.hash = ''; actual.hash = '';
        } catch (_) { reject(archiveFailure('A_REQUEST_RESPONSE', '无法核对 API 响应地址，请检查脚本管理器和连接配置。')); return; }
        if (actual.href !== expected.href || (response.status >= 300 && response.status < 400)) {
          reject(archiveFailure('A_REQUEST_REDIRECT', 'API 返回了重定向响应，请填写无需重定向的 API 地址。')); return;
        }
        resolve({ status: response.status, text: response.responseText });
      },
      onerror: () => reject(new Error('network')),
      ontimeout: () => reject(new Error('timeout')),
      onabort: () => reject(new Error('aborted')),
    };
    try { GM_xmlhttpRequest(request); } catch (_) { reject(new Error('network')); }
  });
}
class ArchivePreview {
  constructor({ snapshot, config, save, cancel }) {
    this.snapshot = snapshot; this.config = config; this.references = { folders: [], tags: [] }; this.token = 0;
    this.host = document.createElement('div'); this.host.id = 'chatgpt-archive-preview';
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = QUEUE_CSS; this.root.append(style);
    this.dialog = document.createElement('dialog'); this.dialog.setAttribute('aria-label', '保存到 Obsidian');
    this.dialog.innerHTML = '<h2>保存到 Obsidian</h2><label class="archive-field">标题<input name="title" autocomplete="off"></label><label class="archive-field">文件夹<input name="folder" list="cq-archive-folders" placeholder="库根目录" autocomplete="off"></label><datalist id="cq-archive-folders"></datalist><label class="archive-field">标签<input name="tags" placeholder="以逗号分隔" autocomplete="off"></label><div class="archive-path"></div><div class="hint archive-new"></div><div class="hint archive-progress" role="status">正在分类…</div><div class="error" role="alert" hidden></div><div class="footer"></div>';
    this.inputs = Object.fromEntries([...this.dialog.querySelectorAll('input')].map(input => [input.name, input]));
    this.inputs.title.value = snapshot.question.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 80) || '问答';
    this.progress = this.dialog.querySelector('.archive-progress'); this.error = this.dialog.querySelector('.error');
    this.path = this.dialog.querySelector('.archive-path'); this.newItems = this.dialog.querySelector('.archive-new');
    this.saveButton = button('保存', () => save(), 'pill solid'); this.saveButton.disabled = true;
    this.cancelButton = button('取消', () => cancel());
    this.dialog.querySelector('.footer').append(this.cancelButton, this.saveButton);
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); if (!this.saving) cancel(); });
    this.dialog.addEventListener('input', () => { this.edited = true; this.token++; this.updatePath(); });
    this.root.append(this.dialog); document.body.append(this.host); this.syncTheme(); this.updatePath(); this.dialog.showModal();
  }
  fields() { return archiveFields(Object.fromEntries(Object.entries(this.inputs).map(([name, input]) => [name, input.value]))); }
  updatePath() {
    try {
      const fields = this.fields(), path = archivePath(this.snapshot, fields);
      this.path.textContent = this.config.vaultPath.replace(/[\\/]$/, '') + '\\' + path.replace(/\//g, '\\');
      const fresh = fields.tags.filter(tag => !this.references.tags.includes(tag));
      this.newItems.textContent = [fields.folder && !this.references.folders.includes(fields.folder) ? `新建文件夹：${fields.folder}` : '', fresh.length ? `新标签：${fresh.join('、')}` : ''].filter(Boolean).join(' · ');
      this.valid = true;
    } catch (_) { this.path.textContent = ''; this.newItems.textContent = ''; this.valid = false; }
    this.saveButton.disabled = Boolean(this.loading || this.saving || !this.valid);
  }
  setFields(fields) { for (const [name, input] of Object.entries(this.inputs)) input.value = name === 'tags' ? fields.tags.join(', ') : fields[name]; this.updatePath(); }
  setReferences(references) {
    this.references = references;
    const list = this.dialog.querySelector('datalist'); list.replaceChildren();
    for (const folder of references.folders) { const option = document.createElement('option'); option.value = folder; list.append(option); }
    this.updatePath();
  }
  setBusy(loading, text) { this.loading = loading; this.progress.textContent = text || ''; this.updatePath(); }
  setSaving(value) { this.saving = value; for (const input of Object.values(this.inputs)) input.disabled = value; this.cancelButton.disabled = value; this.setBusy(value, value ? '正在保存…' : ''); }
  showError(error) { this.error.textContent = `[${error.code || 'A_ARCHIVE_ERROR'}] ${error.message}`; this.error.hidden = false; }
  syncTheme() { archiveSyncTheme(this.host); }
  dispose() { if (this.dialog.open) this.dialog.close(); this.host.remove(); }
}
class ArchiveController {
  constructor({ adapter, request = archiveRequest, read = (key, fallback) => GM_getValue(key, fallback), write = (key, value) => GM_setValue(key, value) }) {
    this.adapter = adapter; this.request = request; this.read = read; this.write = write; this.buttons = new Map(); this.context = ''; this.generation = 0;
    this.configKey = 'cq-accent-archive-config-v1';
    this.toastHost = document.createElement('div'); this.toastHost.id = 'chatgpt-archive-notices';
    this.toastRoot = this.toastHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = QUEUE_CSS; this.toastRoot.append(style);
    this.toast = document.createElement('div'); this.toast.className = 'archive-toast'; this.toast.hidden = true; this.toast.setAttribute('role', 'status'); this.toastRoot.append(this.toast); document.body.append(this.toastHost);
  }
  config() { return { ...ARCHIVE_DEFAULTS, ...this.read(this.configKey, {}) }; }
  configure(value) {
    const config = { ...ARCHIVE_DEFAULTS, ...value };
    archiveEndpoint(config.aiUrl, ''); archiveEndpoint(config.obsidianUrl, '');
    if (!config.vaultPath.trim() || !config.model.trim()) throw archiveFailure('A_CONFIG_INVALID', '请填写库路径和模型 ID。');
    this.write(this.configKey, config);
  }
  service(config = this.config()) { return new ArchiveService({ config, request: this.request, readMapping: key => this.read('cq-accent-archive-note-v1:' + key, null), writeMapping: (key, value) => this.write('cq-accent-archive-note-v1:' + key, value) }); }
  notify(message, error = false) {
    archiveSyncTheme(this.toastHost); this.toast.textContent = message; this.toast.hidden = false; this.toast.setAttribute('role', error ? 'alert' : 'status');
    clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, error ? 14000 : 6000);
  }
  report(error) {
    const code = error.code || 'A_ARCHIVE_ERROR'; this.notify(`[${code}] ${error.message}`, true);
    console.error(`[ChatGPT Archive][${code}]`);
    page.document.dispatchEvent(new page.CustomEvent('chatgpt-archive:error', { detail: JSON.stringify({ code }) }));
  }
  close() { this.generation++; this.preview?.dispose(); this.preview = null; }
  update() {
    const adapter = this.adapter(); if (!adapter) return;
    const context = `${adapter.mode}:${adapter.conversation}`;
    if (context !== this.context) { this.context = context; this.close(); for (const item of this.buttons.values()) item.host.remove(); this.buttons.clear(); }
    const reader = new ArchivePageAdapter(adapter), replies = reader.replies(), current = new Set(replies);
    for (const [node, item] of this.buttons) if (!current.has(node) || !item.host.isConnected) { item.host.remove(); this.buttons.delete(node); }
    for (const node of replies) {
      const toolbar = reader.toolbar(node); if (!toolbar) continue;
      let item = this.buttons.get(node);
      if (!item) {
        const host = document.createElement('span'); host.dataset.cqArchiveButton = ''; host.style.cssText = 'display:inline-flex;align-items:center;';
        const root = host.attachShadow({ mode: 'open' }), style = document.createElement('style');
        style.textContent = ':host{display:inline-flex;color:inherit}button{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}button:hover{background:var(--bg-elevated-secondary,#8882)}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid currentColor}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}';
        const control = document.createElement('button'); control.type = 'button'; control.title = '保存到 Obsidian'; control.setAttribute('aria-label', '保存到 Obsidian');
        control.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l3 3v15H4V3zM8 3v6h8V3M8 21v-7h8v7"/></svg>';
        control.addEventListener('click', event => { event.stopPropagation(); this.open(node); });
        root.append(style, control); toolbar.append(host); item = { host, control }; this.buttons.set(node, item);
      }
      if (item.host.parentElement !== toolbar) toolbar.append(item.host);
      const nativeControl = toolbar.querySelector('[data-testid="copy-turn-action-button"],button[aria-label="Copy"]') || toolbar.querySelector('button');
      if (nativeControl) item.host.style.color = getComputedStyle(nativeControl).color;
      item.control.disabled = !reader.complete(node) || !adapter.conversation;
    }
    this.preview?.syncTheme();
  }
  async open(node) {
    if (this.preview?.saving) return;
    this.close(); const token = this.generation;
    let snapshot;
    try { snapshot = new ArchivePageAdapter(this.adapter()).snapshot(node); } catch (error) { this.report(error); return; }
    const config = this.config(), service = this.service(config);
    const preview = new ArchivePreview({ snapshot, config, save: () => this.save(preview, service), cancel: () => this.close() });
    this.preview = preview; preview.setBusy(true, '正在读取目录与标签…');
    try {
      const references = await service.references(); if (token !== this.generation) return;
      preview.setReferences(references); preview.setBusy(true, '正在分类…');
      const fields = await service.classify(snapshot, references); if (token !== this.generation) return;
      if (!preview.edited) preview.setFields(fields);
      preview.setBusy(false, '');
    } catch (error) { if (token !== this.generation) return; preview.setBusy(false, ''); preview.showError(error); this.report(error); }
  }
  async save(preview, service) {
    if (preview !== this.preview || preview.saving) return;
    let fields;
    try { fields = preview.fields(); } catch (error) { preview.showError(error); return; }
    const token = this.generation; preview.setSaving(true);
    try {
      const result = await service.save(preview.snapshot, fields);
      if (token !== this.generation) return;
      this.close(); this.notify(`已保存到 Obsidian：${result.path}`);
    } catch (error) { if (token !== this.generation) return; preview.setSaving(false); preview.showError(error); this.report(error); }
  }
  dispose() { this.close(); clearTimeout(this.toastTimer); for (const item of this.buttons.values()) item.host.remove(); this.buttons.clear(); this.toastHost.remove(); }
}
if (typeof module !== 'undefined') Object.assign(module.exports, { ArchivePreview, ArchiveController, archiveRequest, archiveSyncTheme });
