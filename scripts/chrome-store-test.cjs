// Exercise the Store build in Chromium and capture listing screenshots.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { until } = require('../tests/e2e-driver.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const youtube = 'https://www.youtube.com';
const fixture = `<!doctype html><html dark><meta charset="utf-8"><title>Python lists and loops - YouTube</title><link rel="icon" href="data:,">
<style>
  html { color-scheme: dark; }
  body { margin: 0; background: #0f0f0f; color: #f1f1f1; font: 16px Arial, sans-serif; }
  #masthead-container { display: grid; place-items: center; height: 56px; border-bottom: 1px solid #292929; }
  input { width: 480px; padding: 10px 16px; border-radius: 24px; border: 1px solid #383838; background: #121212; font: inherit; }
  main { max-width: 960px; margin: 96px auto; }
  ytd-video-renderer { display: block; width: 420px; margin-bottom: 34px; }
  #video-title { color: #f1f1f1; font-size: 20px; font-weight: 600; text-decoration: none; }
  #channel-name, #description-text { margin: 7px 0; color: #aaa; font-size: 14px; }
</style>
<ytd-app><div id="masthead-container"><form action="/results"><input aria-label="Search" name="search_query" value="Existing site text"></form></div>
<main><ytd-video-renderer><a id="video-title" href="/watch?v=Js05B8Z1ivE">Python lists and loops</a>
<div id="channel-name"><yt-formatted-string>Python Workshop</yt-formatted-string></div>
<p id="description-text">Create a list, add items, and loop through them.</p><ytd-thumbnail><img></ytd-thumbnail></ytd-video-renderer></main></ytd-app>
<script>
  const query = new URLSearchParams(location.search).get('search_query');
  if (query) document.querySelector('[name=search_query]').value = query;
  window.siteInputs = []; addEventListener('input', e => window.siteInputs.push(e.data), true);
</script>`;

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'curb-chrome-store-'));
  const extension = path.resolve('dist/chrome-store');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      headless: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce',
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const errors = [], requests = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('https://**/*', route => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ url: url.href, type: request.resourceType() });
      if (url.origin === youtube && request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixture });
      if (url.hostname === 'i.ytimg.com') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="gray"/></svg>' });
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionUrl = file => `chrome-extension://${new URL(worker.url()).host}/${file}`;
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const shadow = async (fn, value = null, session = cdp) => {
      const { root } = await session.send('DOM.getDocument');
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#curb-extension-root' });
      if (!nodeId) return null;
      const { node } = await session.send('DOM.describeNode', { nodeId, depth: 1, pierce: true });
      const { object } = await session.send('DOM.resolveNode', { backendNodeId: node.shadowRoots[0].backendNodeId });
      try {
        const result = await session.send('Runtime.callFunctionOn', {
          objectId: object.objectId, functionDeclaration: `function(value) { return (${fn})(this, value); }`,
          arguments: [{ value }], returnByValue: true
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
        return result.result.value;
      } finally { await session.send('Runtime.releaseObject', { objectId: object.objectId }); }
    };
    const click = async name => {
      const point = await until(() => shadow((root, name) => {
        const b = [...root.querySelectorAll('button')].find(button => button.textContent === name && !button.disabled && button.getClientRects().length);
        const r = b?.getBoundingClientRect();
        return r?.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      }, name), name);
      await page.bringToFront();
      await page.mouse.click(point.x, point.y);
    };
    const heading = text => until(() => shadow((root, text) => root.querySelector('h1')?.textContent === text, text), text);
    const output = path.resolve('artifacts/chrome-store');
    await fs.mkdir(output, { recursive: true });
    const capture = async (tab, name) => {
      const png = await tab.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
      assert.equal(png.readUInt32BE(16), 1280, name);
      assert.equal(png.readUInt32BE(20), 800, name);
      assert.equal(png[24], 8, name);
      assert.equal(png[25], 2, name); // RGB without alpha
    };

    await page.goto(youtube);
    await heading('Enable Curb on YouTube');
    assert.equal(await page.evaluate(() => document.querySelector('#curb-extension-root').shadowRoot), null);
    assert.equal(await page.locator('ytd-app').evaluate(app => app.inert), false);
    assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get()), {});
    await click('Not now');
    await page.locator('#curb-extension-root').waitFor({ state: 'detached' });
    assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get()), {});
    await page.reload();
    await click('Enable Curb');
    await heading('What brings you to YouTube?');
    assert.equal(await shadow(root => root.querySelector('input') !== null), false);
    await click('Practice programming');
    await click('Start session');
    await until(() => shadow(root => root.querySelector('.intent')?.textContent.includes('Practice programming')), 'preset started');
    console.log('chrome-store: PASS closed overlay and no tab tracking before affirmative consent');

    const settings = await context.newPage();
    await settings.goto(extensionUrl('options.html'));
    await settings.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    await settings.getByRole('heading', { name: 'Privacy & data' }).waitFor({ state: 'attached' });
    await settings.getByRole('heading', { name: 'Video summaries', exact: true }).waitFor();
    const localManifest = JSON.parse(await fs.readFile('dist/chrome/manifest.json', 'utf8'));
    const storeManifest = await settings.evaluate(() => chrome.runtime.getManifest());
    for (const field of ['name', 'action', 'version', 'manifest_version', 'minimum_chrome_version', 'permissions', 'optional_host_permissions', 'content_scripts', 'background', 'options_ui'])
      assert.deepEqual(storeManifest[field], localManifest[field], field);
    assert.deepEqual(await fs.readFile('dist/chrome/summary.js'), await fs.readFile('dist/chrome-store/summary.js'));
    const localCore = require('../dist/chrome/core.js'), storeCore = require('../dist/chrome-store/core.js');
    assert.deepEqual(storeCore.CONTROLS, localCore.CONTROLS);
    assert.deepEqual(storeCore.PRESETS, localCore.PRESETS);
    const storeControls = await settings.locator('[data-setting]').evaluateAll(nodes => nodes.map(node => node.dataset.setting));
    assert.deepEqual([...storeControls].sort(), [...Object.keys(localCore.DEFAULTS), 'summaryIntent'].sort());
    console.log(`chrome-store: PASS all ${Object.keys(localCore.DEFAULTS).length} local settings, presets, permissions and Gemini engine accounted for`);
    assert.deepEqual(await settings.getByLabel('Video thumbnails').locator('option').allTextContents(), ['Show normally', 'Reveal on hover', 'Always hidden']);
    await capture(settings, 'settings');

    await page.bringToFront();
    await click('Edit intent');
    const [editor] = await Promise.all([context.waitForEvent('page'), click('Custom intent…')]);
    await editor.waitForURL(extensionUrl('options.html#edit-intent'));
    const intent = 'Private practice topic';
    await editor.getByLabel('Your intent', { exact: true }).fill(intent);
    const conflict = await settings.evaluate(async () => {
      const { data } = await chrome.runtime.sendMessage({ type: 'GET' });
      return chrome.runtime.sendMessage({ type: 'EDIT_INTENT', sessionId: data.session.id, expectedIntent: data.session.intent, intent: 'Concurrent edit' });
    });
    assert.equal(conflict.ok, true);
    await editor.getByRole('button', { name: 'Save intent' }).click();
    await editor.getByRole('alert').filter({ hasText: 'Your session changed' }).waitFor();
    assert.equal(await editor.getByLabel('Your intent', { exact: true }).inputValue(), intent);
    await editor.getByRole('button', { name: 'Save intent' }).click();
    await editor.getByRole('status').filter({ hasText: 'Intent saved' }).waitFor();
    await until(() => shadow((root, intent) => root.querySelector('.intent')?.textContent.includes(intent) && !root.querySelector('.veil'), intent), 'new intent applied');
    assert.deepEqual(await page.evaluate(() => window.siteInputs), []);
    assert.equal(await page.locator('[name=search_query]').inputValue(), 'Existing site text');
    console.log('chrome-store: PASS custom text is entered in Settings and stays out of native YouTube search');

    await click('Edit intent');
    const [suggestions] = await Promise.all([context.waitForEvent('page'), editor.getByRole('button', { name: 'Save and get YouTube suggestions' }).click()]);
    await until(() => suggestions.evaluate(expected => document.querySelector('[name=search_query]')?.value === expected, intent), 'explicit intent reaches YouTube search input');
    assert.deepEqual(await suggestions.evaluate(() => window.siteInputs), [intent]);
    assert.equal(new URL(suggestions.url()).pathname, '/');
    await until(() => shadow(root => !root.querySelector('.veil')), 'saving the same intent exits the original editor');
    await suggestions.close();
    console.log('chrome-store: PASS explicit suggestions handoff fills native search without submitting');

    await editor.getByLabel('Name', { exact: true }).fill('Python examples');
    await editor.getByLabel('Search terms').fill('Python list examples');
    await editor.getByRole('button', { name: 'Save search' }).click();
    await editor.getByRole('button', { name: 'Edit Python examples' }).waitFor();
    await settings.getByRole('button', { name: 'Edit Python examples' }).waitFor();
    await editor.getByRole('button', { name: 'Edit Python examples' }).click();
    await editor.getByLabel('Search terms').fill('Python lists & loops');
    await editor.getByRole('button', { name: 'Save search' }).click();
    await settings.getByText('Python lists & loops', { exact: true }).waitFor();
    await settings.getByRole('button', { name: 'Remove Python examples' }).click();
    await editor.getByRole('button', { name: 'Edit Python examples' }).waitFor({ state: 'detached' });
    await editor.getByLabel('Name', { exact: true }).fill('Python examples');
    await editor.getByLabel('Search terms').fill('Python list examples');
    await editor.getByRole('button', { name: 'Save search' }).click();
    await settings.getByRole('button', { name: 'Edit Python examples' }).waitFor();
    const saved = await worker.evaluate(() => chrome.storage.local.get());
    assert.deepEqual(Object.keys(saved), ['sealedData']);
    assert.equal(saved.sealedData.version, 1);
    assert.doesNotMatch(JSON.stringify(saved), /Python examples|Python list examples|Private practice topic/);
    assert.deepEqual(await worker.evaluate(() => CurbStore.get('savedSearches').then(data => data.savedSearches.map(item => item.query))), ['Python list examples']);
    await click('Edit intent');
    const launchName = 'Search YouTube for Python examples';
    await until(() => shadow((root, name) => !!root.querySelector(`[aria-label="${name}"]`), launchName), 'saved search appears');
    await shadow((root, name) => root.querySelector(`[aria-label="${name}"]`).click(), launchName);
    assert.equal(new URL(page.url()).pathname, '/');
    await Promise.all([page.waitForURL(url => url.searchParams.get('search_query') === 'Python list examples'), click('Python examples ↗')]);
    assert.equal(requests.filter(request => new URL(request.url).searchParams.has('search_query')).length, 1);
    assert(requests.every(request => new URL(request.url).origin === youtube && request.type === 'document'), JSON.stringify(requests));
    console.log('chrome-store: PASS saved searches create, edit and remove across Settings tabs, stay encrypted, and open after trusted selection');

    await settings.getByLabel('Video thumbnails').selectOption('hover');
    await until(() => page.locator('html').getAttribute('data-curb-thumbnails').then(value => value === 'hover'), 'hover mode applied');
    await page.bringToFront();
    await page.locator('#video-title').hover();
    await until(() => shadow(root => !root.querySelector('.thumbnail-preview').hidden), 'hover thumbnail shown');
    const imageRequests = requests.filter(({ type }) => type === 'image');
    assert(imageRequests.length);
    assert(imageRequests.every(({ url }) => url === 'https://i.ytimg.com/vi/Js05B8Z1ivE/mqdefault.jpg'));
    console.log('chrome-store: PASS hover preview uses the expected YouTube image URL');

    const key = 'AQ.Test' + 'x'.repeat(48);
    const denied = await settings.evaluate(key => chrome.runtime.sendMessage({ type: 'SUMMARY_KEY_ADD', key }), key);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /Confirm the Gemini terms/);
    await settings.evaluate(() => { chrome.permissions.request = async () => true; });
    await settings.getByLabel('Gemini API key', { exact: true }).fill(key);
    await settings.getByRole('checkbox', { name: /I’m 18 or older/ }).check();
    await settings.getByRole('button', { name: 'Add key' }).click();
    await settings.getByText('AQ.T…xxxx', { exact: true }).waitFor();
    assert.deepEqual(await worker.evaluate(() => CurbStore.get('geminiKeys').then(data => data.geminiKeys)), [key]);
    assert.doesNotMatch(JSON.stringify(await worker.evaluate(() => chrome.storage.local.get())), /AQ\.Test/);
    await worker.evaluate(() => {
      chrome.permissions.contains = async () => true;
      globalThis.geminiCalls = [];
      globalThis.fetch = async (url, options) => {
        geminiCalls.push({ url, key: options.headers['x-goog-api-key'], body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ output_text: JSON.stringify({
          summary: 'Build a list of items, add to it with append(), and use a for loop to print each item.',
          fits_intent: 'yes', verdict: 'Practices creating and iterating over Python lists.',
          key_points: [
            { time: '1:05', point: 'Create a list with square brackets.' },
            { time: '2:18', point: 'Add another item with append().' },
            { time: '3:42', point: 'Loop over the list with for.' }
          ]
        }) }));
      };
    });
    const summarize = async () => {
      await page.bringToFront();
      await page.mouse.move(1000, 500);
      await page.locator('#video-title').hover();
      await click('Summarize');
      await until(() => shadow(root => root.querySelector('.ai-summary [data-complete]') !== null), 'summary rendered');
    };
    await summarize();
    const calls = () => worker.evaluate(() => geminiCalls);
    const [first] = await calls();
    assert.equal(first.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(first.key, key);
    assert.equal(first.body.store, false);
    assert.equal(first.body.input[1].uri, 'https://www.youtube.com/watch?v=Js05B8Z1ivE');
    assert.doesNotMatch(first.body.input[0].text, /Python examples/);
    await page.keyboard.press('Escape');
    await settings.getByLabel('Include my intent in Gemini requests').check();
    await until(() => worker.evaluate(() => CurbStore.get('settings').then(data => data.settings?.summaryIntent)), 'intent-sharing opt-in saved');
    await summarize();
    assert.match((await calls())[1].body.input[0].text, /Python examples/);
    await until(() => shadow(root => root.querySelector('.ai-summary .intent-fit')?.textContent.includes('Fits your intent')), 'summary intent verdict');
    assert.equal(await shadow(root => root.querySelectorAll('.ai-summary li a').length), 3);
    await capture(page, 'gemini-summary');
    console.log('chrome-store: PASS Gemini key consent, encrypted key, scoped requests, and opt-in intent sharing');

    await page.goto(`${youtube}/watch?v=Js05B8Z1ivE`);
    await heading('Does this video fit your intent?');
    await until(() => shadow(root => root.querySelector('[data-video-title]')?.textContent === 'Python lists and loops'), 'watch title shown');
    await capture(page, 'video-intent');

    await settings.getByRole('button', { name: 'Clear local data…' }).click();
    await settings.getByRole('button', { name: 'Clear and reset' }).click();
    await settings.getByRole('status').filter({ hasText: 'Local data cleared' }).waitFor();
    await heading('Enable Curb on YouTube');
    assert.equal(await page.locator('ytd-app').evaluate(app => app.inert), false);
    const reset = await worker.evaluate(() => CurbStore.get(null));
    assert.deepEqual(reset, {});
    assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get()), {});
    assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get()), {});
    assert.deepEqual(errors, []);
    const policy = await context.newPage();
    await policy.goto(extensionUrl('privacy.html'));
    await policy.getByRole('heading', { name: 'Limited Use' }).waitFor();
    assert.equal(await policy.locator('#video-summaries').textContent(), 'Gemini video summaries');
    assert.equal(await policy.getByRole('link', { name: 'Back to settings' }).getAttribute('href'), 'options.html');
    await policy.setViewportSize({ width: 390, height: 800 });
    assert(await policy.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log('chrome-store: PASS reset clears activity and consent, privacy policy opens, and 1280×800 Settings screenshot verified');

    if (process.argv.includes('--live')) {
      await context.unroute('https://**/*');
      await page.goto(youtube, { waitUntil: 'domcontentloaded' });
      await heading('Enable Curb on YouTube');
      await page.locator('ytd-app').waitFor({ state: 'attached', timeout: 20000 });
      await click('Enable Curb');
      await heading('What brings you to YouTube?');
      await capture(page, 'youtube');
      await click('Practice programming');
      await click('Start session');
      await until(() => shadow(root => root.querySelector('.intent')?.textContent.includes('Practice programming')), 'live session started');
      await heading('Search or browse');
      assert.equal(await page.locator('html').getAttribute('data-curb-hide-home'), '');
      await capture(page, 'youtube-home');
      console.log('chrome-store: PASS signed-out live YouTube consent and session start');
    }
    console.log('chrome-store: PASS listing screenshots are 1280×800 RGB PNGs');
  } finally {
    await context?.close();
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
