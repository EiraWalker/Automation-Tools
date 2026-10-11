import puppeteer from 'puppeteer-core';

export function validateEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new Error('F_ENDPOINT_INVALID'); }
  if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port || endpoint.pathname !== '/session' ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('F_ENDPOINT_INVALID');
  }
  return endpoint.href;
}

export function validateTarget(target) {
  let url;
  try { url = new URL(target?.url); } catch { throw new Error('F_TARGET_INVALID'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      !target.title?.trim() || target.url.includes('REPLACE_WITH_') || target.title.includes('REPLACE_WITH_')) {
    throw new Error('F_TARGET_INVALID');
  }
  return { url: url.href, title: target.title };
}

// Puppeteer owns the protocol. This wrapper only scopes the task and its cleanup.
export async function withExistingBrowser(config, task, connect = options => puppeteer.connect(options)) {
    const endpoint = validateEndpoint(config.endpoint);
    const browser = await connect({
    browserWSEndpoint: endpoint,
    protocol: 'webDriverBiDi',
    defaultViewport: null,
    acceptInsecureCerts: false,
    networkEnabled: false,
      capabilities: { unhandledPromptBehavior: 'ignore' },
      protocolTimeout: 60000,
    });
    try {
      if (!/^firefox\//i.test(await browser.version())) throw new Error('F_BROWSER_UNEXPECTED');
      return await task(browser);
    } finally {
      await browser.disconnect();
    }
}

export async function withExistingPage(config, task, connect) {
    const target = validateTarget(config.target);
    return withExistingBrowser(config, async browser => {
      const matches = (await browser.pages()).filter(page => page.url() === target.url);
    if (matches.length !== 1) throw new Error('F_TARGET_NOT_UNIQUE');
    const page = matches[0];
    if (await page.title() !== target.title || page.url() !== target.url) {
      throw new Error('F_TARGET_CHANGED');
    }
      const state = await inspectPageState(page, target);
      if (state.webdriver !== false) throw new Error('F_AUTOMATION_MODE');
      return task(page, target, { browserVersion: await browser.version(), initialState: state });
    }, connect);
}

export async function inspectPageState(page, target) {
  return page.evaluate(async expected => {
    if (location.href !== expected.url || document.title !== expected.title) throw new Error('F_TARGET_CHANGED');
    const editor = document.querySelector('#prompt-textarea, [contenteditable="true"][role="textbox"], textarea');
    const draft = editor ? ('value' in editor ? editor.value : editor.innerText) : '';
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(draft));
    const getter = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver')?.get;
    const state = {
      webdriver: navigator.webdriver,
      nativeWebdriverGetter: !!getter && Function.prototype.toString.call(getter).includes('[native code]'),
      readyState: document.readyState,
      visibility: document.visibilityState,
      focused: document.hasFocus(),
      composerPresent: !!editor,
      draftLength: draft.length,
      draftHash: Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join(''),
      challengeDetected: !!document.querySelector('#challenge-running, #challenge-stage, form#challenge-form'),
      viewport: { width: innerWidth, height: innerHeight },
      scroll: { x: scrollX, y: scrollY },
    };
    if (location.href !== expected.url || document.title !== expected.title) throw new Error('F_TARGET_CHANGED');
    return state;
  }, target);
}

export async function inspectEnvironment(page, target, context) {
  const samples = [context.initialState];
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    samples.push(await inspectPageState(page, target));
  }
  return { browserVersion: context.browserVersion, samples,
    webdriverFalse: samples.every(state => state.webdriver === false),
    pageStateUnchanged: samples.every(state => JSON.stringify(state) === JSON.stringify(samples[0])),
  };
}

export async function inspectArchive(page, target) {
  return page.evaluate(expected => {
    if (location.href !== expected.url || document.title !== expected.title) {
      throw new Error('F_TARGET_CHANGED');
    }
    const buttons = [...document.querySelectorAll('[data-cq-archive-button]')].map(host => {
      const button = host.shadowRoot?.querySelector('button');
      const native = host.parentElement?.querySelector('[data-testid="copy-turn-action-button"],button[aria-label="Copy"]');
      const rect = button?.getBoundingClientRect();
      const style = button && getComputedStyle(button);
      const ancestors = [];
      for (let element = host; element; element = element.parentElement) {
        const css = getComputedStyle(element);
        if (css.display === 'none' || css.visibility !== 'visible' || Number(css.opacity) < 1) {
          ancestors.push({ tag: element.tagName, display: css.display, visibility: css.visibility, opacity: css.opacity });
        }
      }
      return {
        present: !!button, disabled: button?.disabled, color: style?.color,
        hostColor: getComputedStyle(host).color,
        nativeColor: native ? getComputedStyle(native).color : null,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        ancestors,
      };
    });
    // No prompt, reply body, storage value, cookie or API key is collected.
    return { readyState: document.readyState, visibility: document.visibilityState, focused: document.hasFocus(),
      runningUserscriptVersion: document.querySelector('#chatgpt-queue-accent')?.dataset.cqVersion ?? null,
      runningScriptHandler: document.querySelector('#chatgpt-queue-accent')?.dataset.cqScriptHandler ?? null,
      runningInjectInto: document.querySelector('#chatgpt-queue-accent')?.dataset.cqInjectInto ?? null, buttons };
  }, target);
}
