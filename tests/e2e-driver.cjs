// Real browser adapters for the same end-to-end journeys. No production dependencies.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
async function launch(name, fixture, profile) {
  const errors = [], requests = [], cancelledRequests = [];
  if (name === 'chromium') {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const extension = path.resolve('dist/chrome');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    // Anything that fails before the driver is returned must close the browser, or it keeps running.
    try {
    context.setDefaultTimeout(15000);
    context.on('request', request => { if (request.isNavigationRequest()) requests.push(request.url()); });
    context.on('page', page => page.on('pageerror', e => errors.push(e.message)));
    // Chromium protects this preference; use its real switch instead of editing JSON.
    const manager = await context.newPage(); await manager.goto('chrome://extensions');
    const devMode = manager.locator('#devMode'); await devMode.waitFor();
    if (!await devMode.evaluate(n => n.checked)) await devMode.click();
    await until(() => devMode.evaluate(n => n.checked), 'Chromium developer mode enabled');
    await manager.close();
    if (fixture) await context.route('https://**/*', route => {
      const u = new URL(route.request().url());
      if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'example.test'].includes(u.host) && route.request().resourceType() === 'document')
        return route.fulfill({ contentType: 'text/html', body: fixture });
      return route.abort();
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    var extensionBase = `chrome-extension://${new URL(worker.url()).host}/`;
    } catch (error) { await context.close().catch(() => {}); throw error; }
    const driver = {
      name, errors, requests, cancelledRequests, version: context.browser().version(),
      extensionUrl(file) { return extensionBase + file; },
      async settleRequests() {},
      async tabs() { return context.pages(); },
      async open(url) { const p = await context.newPage(); await p.goto(url, { waitUntil: 'domcontentloaded' }); return p; },
      async navigate(p, url) { await p.goto(url, { waitUntil: 'domcontentloaded' }); },
      async evaluate(p, fn, arg) { return p.evaluate(fn, arg); },
      // Input goes to the front page, as in the Firefox adapter and for a real user. A page left behind
      // another gets throttled animation frames, which Playwright's stability check depends on: clicks
      // there intermittently failed with "element is not stable" although nothing moved.
      async click(p, expression) { await p.bringToFront(); await p.locator('body').evaluate(() => {}); const h = await p.evaluateHandle(expression); await h.asElement().click(); await h.dispose(); },
      async fill(p, expression, text) { await p.bringToFront(); const h = await p.evaluateHandle(expression); await h.asElement().fill(text); await h.dispose(); },
      async hover(p, expression) { await p.bringToFront(); const h = await p.evaluateHandle(expression); await h.asElement().hover(); await h.dispose(); },
      async movePointer(p, x, y) { await p.mouse.move(x, y); },
      async key(p, key) { await p.keyboard.press(key); },
      async activate(p) { await p.bringToFront(); },
      async closeTab(p) { await p.close(); },
      async url(p) { return p.url(); },
      async screenshot(p, file) { await p.screenshot({ path: file, fullPage: true }); },
      async resize(p, width, height) { await p.setViewportSize({ width, height }); },
      async background(fn, arg) {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        return worker.evaluate(fn, arg);
      },
      async suspendBackground() {
        const session = await context.newCDPSession(context.pages()[0]);
        await session.send('ServiceWorker.enable');
        await session.send('ServiceWorker.stopAllWorkers'); await session.detach();
      },
      async close() { await context.close(); }
    };
    return driver;
  }
  // A fixed internal UUID makes moz-extension:// pages addressable from tests.
  const FIREFOX_UUID = '6a1c6e2e-4f0b-4b8e-9c3a-2b1d7c0e5f41';
  await fs.writeFile(path.join(profile, 'user.js'), `user_pref("extensions.webextensions.uuids","{\\"curb-your-youtube@local.extension\\":\\"${FIREFOX_UUID}\\"}");
` + 'user_pref("remote.experimental.enabled",true);\nuser_pref("browser.shell.checkDefaultBrowser",false);\nuser_pref("browser.startup.homepage_override.mstone","ignore");\nuser_pref("ui.prefersReducedMotion",1);\n');
  const proc = spawn(process.env.FIREFOX_EXECUTABLE || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', '--remote-allow-system-access'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let socket, seq = 0, logs = '', closed = false;
  const abortedRequests = new Map();
  const responseJobs = new Set();
  const pending = new Map();
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`BiDi timeout: ${method}`)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluateTarget(target, fn, arg) {
    const expression = `Promise.resolve((${fn.toString()})(${JSON.stringify(arg) ?? 'undefined'})).then(value=>JSON.stringify(value ?? null))`;
    const r = await command('script.evaluate', { target, expression, awaitPromise: true });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return JSON.parse(r.result.value);
  }
  async function pointerPosition(context, expression) {
    await command('browsingContext.activate', { context });
    // Like Playwright in Chromium, wait briefly for the control to exist: a page can still be
    // rendering or reloading (YouTube reloads once with ?themeRefresh=1 in fresh Firefox profiles).
    return evaluateTarget({ context }, new Function(`return (async () => {
      let node = null;
      for (const end = Date.now() + 10000; !(node = (${expression})) && Date.now() < end;) await new Promise(resolve => setTimeout(resolve, 100));
      if (!node) throw new Error('Missing control');
      node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      // Firefox dispatches scroll after scrollIntoView returns. Flush it before
      // hovering so the queued scroll cannot immediately dismiss a preview.
      let previous;
      let stable = 0;
      for (let frame = 0; frame < 120; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const rect = node.getBoundingClientRect();
        const geometry = [rect.x, rect.y, rect.width, rect.height].join(',');
        stable = geometry === previous ? stable + 1 : 0;
        previous = geometry;
        if (stable < 2) continue;
        const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
        const root = node.getRootNode();
        const hit = root.elementFromPoint(x, y);
        if (!rect.width || !rect.height || !(hit === node || node.contains(hit)))
          throw new Error('Control is outside the viewport or obscured');
        return { x, y };
      }
      throw new Error('Control geometry did not settle');
    })();`));
  }
  async function close() {
    if (socket?.readyState === WebSocket.OPEN && !closed) await command('browser.close').catch(() => {});
    closed = true; socket?.close();
    for (const job of pending.values()) clearTimeout(job.timer);
    if (proc.exitCode === null) await Promise.race([new Promise(r => proc.once('exit', r)), delay(2500)]);
    if (proc.exitCode === null) proc.kill();
  }
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Firefox startup: ${logs.slice(-1000)}`)), 20000);
      const read = bytes => { logs += bytes; const m = logs.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/); if (m) { clearTimeout(timer); resolve(m[1] + '/session'); } };
      proc.stdout.on('data', read); proc.stderr.on('data', read);
      proc.once('error', e => { clearTimeout(timer); reject(e); });
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Firefox exited: ${code}`)); });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const m = JSON.parse(event.data);
      if (m.id) {
        const job = pending.get(m.id); if (!job) return; pending.delete(m.id); clearTimeout(job.timer);
        if (m.type === 'error') job.reject(new Error(`${m.error}: ${m.message}`)); else job.resolve(m.result);
      } else if (m.method === 'network.beforeRequestSent' && m.params.isBlocked) {
        requests.push(m.params.request.url);
        const html = fixture;
        const requestId = m.params.request.request;
        const response = command('network.provideResponse', { request: requestId, statusCode: 200,
          headers: [{ name: 'Content-Type', value: { type: 'string', value: html ? 'text/html' : 'text/plain' } }],
          body: { type: 'base64', value: Buffer.from(html).toString('base64') } }).catch(async e => {
          // Firefox can cancel a favicon/old document before its fixture response.
          // Only accept a missing intercept when the browser confirms that abort.
          if (e.message.startsWith('no such request:')) {
            try {
              await until(() => /abort|cancel/i.test(abortedRequests.get(requestId) || ''), 'browser-confirmed request cancellation', 1000);
              cancelledRequests.push({ url: m.params.request.url, error: abortedRequests.get(requestId) });
              return;
            } catch {}
          }
          errors.push(`${e.message} (${m.params.request.url})`);
        });
        responseJobs.add(response); response.finally(() => responseJobs.delete(response));
      } else if (m.method === 'network.fetchError') {
        abortedRequests.set(m.params.request.request, m.params.errorText);
      } else if (m.method === 'log.entryAdded' && m.params.type === 'javascript' && m.params.level === 'error') errors.push(m.params.text);
    });
    const session = await command('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
    await command('webExtension.install', { extensionData: { type: 'path', path: path.resolve('dist/firefox') } });
    await command('session.subscribe', { events: ['log.entryAdded', ...(fixture ? ['network.beforeRequestSent', 'network.fetchError'] : [])] });
    if (fixture) await command('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'example.test'].map(hostname => ({ type: 'pattern', protocol: 'https', hostname })) });
    return {
      name, errors, requests, cancelledRequests, version: session.capabilities.browserVersion,
      extensionUrl(file) { return `moz-extension://${FIREFOX_UUID}/${file}`; },
      async settleRequests() { while (responseJobs.size) await Promise.all([...responseJobs]); },
      async tabs() { return (await command('browsingContext.getTree')).contexts.map(c => c.context); },
      async open(url, type = 'tab') { const { context } = await command('browsingContext.create', { type }); await command('browsingContext.navigate', { context, url, wait: 'complete' }); return context; },
      async navigate(context, url) { await command('browsingContext.navigate', { context, url, wait: 'complete' }); },
      async evaluate(context, fn, arg) { return evaluateTarget({ context }, fn, arg); },
      async click(context, expression) {
        const rect = await pointerPosition(context, expression);
        await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
          actions: [{ type: 'pointerMove', x: rect.x, y: rect.y }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] });
      },
      async fill(context, expression, text) {
        await command('browsingContext.activate', { context });
        await evaluateTarget({ context }, new Function(`const node=(${expression}); node.focus(); node.select();`));
        const actions = [{ type: 'keyDown', value: '\uE003' }, { type: 'keyUp', value: '\uE003' }];
        for (const value of [...text]) actions.push({ type: 'keyDown', value }, { type: 'keyUp', value });
        await command('input.performActions', { context, actions: [{ type: 'key', id: 'typing', actions }] });
      },
      async hover(context, expression) {
        const { x, y } = await pointerPosition(context, expression);
        await this.movePointer(context, x, y);
      },
      async movePointer(context, x, y) {
        await command('input.performActions', { context, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x, y }] }] });
      },
      async key(context, key) {
        const keys = { Tab: '\uE004', Escape: '\uE00C', Enter: '\uE007', Shift: '\uE008', Home: '\uE011', ArrowDown: '\uE015' };
        const parts = key.split('+'); const actions = parts.map(k => ({ type: 'keyDown', value: keys[k] || k }));
        actions.push(...parts.reverse().map(k => ({ type: 'keyUp', value: keys[k] || k })));
        await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions }] });
      },
      async activate(context) { await command('browsingContext.activate', { context }); },
      async closeTab(context) { await command('browsingContext.close', { context }); },
      async url(context) { return (await command('browsingContext.getTree', { root: context })).contexts[0].url; },
      async screenshot(context, file) { const r = await command('browsingContext.captureScreenshot', { context }); await fs.writeFile(file, Buffer.from(r.data, 'base64')); },
      async resize(context, width, height) { await command('browsingContext.setViewport', { context, viewport: { width, height } }); },
      async background(fn, arg) {
        // Firefox does not expose its hidden event-page realm through BiDi.
        // Its same-origin options page can access the actual background window.
        const tree = await command('browsingContext.getTree');
        const options = tree.contexts.find(c => c.url.endsWith('/options.html'));
        if (!options) throw new Error('Options page required for Firefox background clock setup');
        const bridge = new Function('arg', `return browser.runtime.getBackgroundPage().then(async background=>{ const state=background.snapshot(); const persist=background.persist.bind(background); return (${fn.toString()})(arg); });`);
        return evaluateTarget({ context: options.context }, bridge, arg);
      },
      close
    };
  } catch (e) { await close(); throw e; }
}
module.exports = { launch, until, delay };
