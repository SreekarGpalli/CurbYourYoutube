/* Optional real Chromium integration test. Set PLAYWRIGHT_MODULE to an installed
   playwright package when it is not on Node's normal module search path. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const C = require('../extension/core.js');
const distractions = require('../tests/distraction-fixtures.cjs');
const fixture = `<!doctype html><html><head><title>Python list comprehensions - YouTube</title></head><body>
<ytd-app><ytd-masthead><form action="/results"><input name="search_query" aria-label="Search"></form></ytd-masthead><ytd-browse page-subtype="home"><div id="contents">Distracting home recommendations</div></ytd-browse>
<ytd-watch-metadata><h1>Python list comprehensions</h1><div id="description">Learn to filter and transform lists.</div></ytd-watch-metadata>
<video controls></video><ytd-comments>Comments distraction</ytd-comments>
<ytd-video-renderer><a id="video-title" href="/watch?v=lesson2">Python functions in 10 minutes</a><div id="channel-name">Programming teacher</div><div class="metadata-snippet-text">Learn how to define a function and return a result.</div></ytd-video-renderer></ytd-app></body></html>`;
async function playLocalVideo(page) {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    canvas.getContext('2d').fillRect(0, 0, 320, 180);
    const video = document.querySelector('video'); video.muted = true;
    video.srcObject = canvas.captureStream(5); await video.play();
  });
  assert.equal(await page.locator('video').evaluate(v => v.paused), false);
}
(async () => {
  const out = path.resolve('artifacts'); await fs.mkdir(out, { recursive: true });
  const extension = path.resolve('dist/chrome');
  const profile = await fs.mkdtemp(path.join(out, 'test-profile-'));
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, headless: true, viewport: { width: 1360, height: 960 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    context.setDefaultTimeout(10000);
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await context.route('https://www.youtube.com/**', route => route.request().resourceType() === 'document'
      ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort());
    const page = await context.newPage(); await page.goto('https://www.youtube.com/');
    await page.getByRole('heading', { name: 'What brings you to YouTube?' }).waitFor();
    await page.screenshot({ path: path.join(out, 'intent-prompt.png') });
    assert.equal(await page.locator('ytd-app').evaluate(n => n.inert), true);
    await page.getByRole('button', { name: 'Practice programming' }).click();
    await page.getByRole('button', { name: 'Start session' }).click();
    await page.getByRole('heading', { name: 'Search or browse' }).waitFor();
    assert.equal(await page.locator('ytd-browse #contents').isVisible(), false);
    await page.goto('https://www.youtube.com/watch?v=lesson1');
    await page.getByRole('heading', { name: 'Does this video fit your intent?' }).waitFor();
    await page.screenshot({ path: path.join(out, 'video-check.png') });
    await page.getByRole('button', { name: 'Yes, this fits' }).click();
    await playLocalVideo(page);
    await worker.evaluate(() => {
      globalThis.originalHandle = handle;
      handle = async (message, sender) => { if (message.type === 'TICK') throw new Error('Simulated connection failure'); return originalHandle(message, sender); };
    });
    await page.getByRole('heading', { name: 'Loading session…' }).waitFor();
    assert.equal(await page.locator('video').evaluate(v => v.paused), true);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('heading', { name: 'Loading session…' }).waitFor();
    await worker.evaluate(() => { handle = globalThis.originalHandle; delete globalThis.originalHandle; });
    await page.getByRole('button', { name: 'Yes, this fits' }).click();
    assert.equal(await page.locator('ytd-app').evaluate(n => n.inert), false);
    await page.locator('#video-title').click({ button: 'right' });
    await page.getByText('Description excerpt').waitFor();
    await page.screenshot({ path: path.join(out, 'local-preview.png') });
    await page.keyboard.press('Escape');
    // Simulate YouTube SPA navigation, including a newly inserted playing video.
    await page.evaluate(() => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=lesson2'); document.dispatchEvent(new Event('yt-navigate-finish')); });
    await page.getByRole('heading', { name: 'Does this video fit your intent?' }).waitFor();
    await page.getByRole('button', { name: 'Yes, this fits' }).click();
    await playLocalVideo(page);
    const second = await context.newPage(); await second.goto('https://www.youtube.com/watch?v=lesson3');
    await second.getByRole('button', { name: 'Yes, this fits' }).click();
    await playLocalVideo(second);
    // Accelerate the break state; clock thresholds are covered by unit tests.
    await worker.evaluate(async () => { state.session.breakDue = true; await persist(); await broadcast(); });
    await page.getByRole('heading', { name: 'Keep watching?' }).waitFor();
    await second.getByRole('heading', { name: 'Keep watching?' }).waitFor();
    assert.equal(await page.locator('video').evaluate(v => v.paused), true);
    assert.equal(await second.locator('video').evaluate(v => v.paused), true);
    await page.screenshot({ path: path.join(out, 'break-prompt.png') });
    await second.getByRole('button', { name: 'Continue for 30 min' }).click();
    await page.getByRole('heading', { name: 'Keep watching?' }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await second.getByRole('heading', { name: 'Session finished' }).waitFor();
    const options = await context.newPage(); await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole('heading', { name: 'Settings' }).waitFor();
    await options.getByLabel('Hide comments', { exact: true }).uncheck();
    await options.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings?.hideComments === false);
    await options.getByLabel('Break interval').selectOption('60');
    await options.evaluate(() => window.scrollTo(0, 0));
    await options.screenshot({ path: path.join(out, 'settings-overview.png') });
    await options.screenshot({ path: path.join(out, 'settings.png'), fullPage: true });
    // Exercise every CSS control through its actual settings UI, in both directions.
    await page.getByRole('button', { name: 'Set intent' }).click();
    await page.getByRole('button', { name: 'Practice programming' }).click();
    await page.getByRole('button', { name: 'Start session' }).click();
    await page.getByRole('button', { name: 'Yes, this fits' }).click();
    const send = async (type, extra = {}) => {
      const response = await options.evaluate(message => chrome.runtime.sendMessage(message), { type, ...extra });
      assert.equal(response.ok, true, response.error); return response.data;
    };
    await send('SETTINGS', { settings: Object.fromEntries(C.CONTROLS.map(([key]) => [key, false])) });
    await options.reload();
    for (const [key, markup] of Object.entries(distractions)) {
      await page.evaluate(markup => {
        document.getElementById('control-fixture')?.remove();
        const node = document.createElement('div'); node.id = 'control-fixture'; node.innerHTML = markup;
        document.querySelector('ytd-app').append(node);
      }, markup);
      const probe = page.locator('#control-fixture [data-probe]');
      await probe.waitFor({ state: 'visible' });
      const label = C.CONTROLS.find(c => c[0] === key)[1];
      await options.getByLabel(label, { exact: true }).check();
      await probe.waitFor({ state: 'hidden' });
      assert.equal((await send('GET')).settings[key], true, key);
      await options.getByLabel(label, { exact: true }).uncheck();
      await probe.waitFor({ state: 'visible' });
      console.log(`Control passed: ${key} hides and restores its fixture`);
    }
    await page.evaluate(() => document.getElementById('control-fixture').remove());
    // Settings changed in another tab must update the open options controls.
    const otherOptions = await context.newPage(); await otherOptions.goto(`chrome-extension://${extensionId}/options.html`);
    await otherOptions.getByLabel('Hide comments', { exact: true }).check();
    await options.waitForFunction(() => document.querySelector('[data-setting="hideComments"]').checked);
    await otherOptions.close();
    // Autoplay is switched off; replay retains approval for the same video.
    await page.evaluate(() => {
      const toggle = document.createElement('button'); toggle.className = 'ytp-autonav-toggle-button'; toggle.setAttribute('aria-checked', 'true');
      toggle.onclick = () => toggle.setAttribute('aria-checked', 'false'); document.querySelector('ytd-app').append(toggle);
    });
    await options.getByLabel('Disable autoplay', { exact: true }).check();
    await page.waitForFunction(() => document.querySelector('.ytp-autonav-toggle-button').getAttribute('aria-checked') === 'false');
    await page.locator('video').dispatchEvent('ended');
    assert.equal(await page.locator('ytd-app').evaluate(n => n.inert), false);
    assert.equal(await page.locator('html').evaluate(n => n.hasAttribute('data-curb-locked')), false);
    // Escape from page focus closes the preview without suppressing the native menu.
    assert.equal(await page.locator('#video-title').evaluate(link => link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), true);
    await page.getByText('Description excerpt').waitFor();
    await page.locator('#video-title').focus(); await page.keyboard.press('Escape');
    await page.getByText('Description excerpt').waitFor({ state: 'hidden' });
    await page.locator('#video-title').dispatchEvent('contextmenu');
    await options.getByLabel('Right-click video previews', { exact: true }).uncheck();
    await page.getByText('Description excerpt').waitFor({ state: 'hidden' });
    await options.getByLabel('Right-click video previews', { exact: true }).check();
    await page.locator('.metadata-snippet-text').evaluate(node => node.remove());
    await page.locator('#video-title').evaluate(node => { node.textContent = '<img src=x onerror=alert(1)>'; });
    await page.locator('#video-title').dispatchEvent('contextmenu');
    await page.getByText('Video metadata').waitFor();
    assert.equal(await page.locator('.preview img').count(), 0);
    assert.equal(await page.locator('.preview b').textContent(), '<img src=x onerror=alert(1)>');
    await page.getByText('Video metadata').waitFor({ state: 'hidden', timeout: 16000 });
    // Direct Shorts are blocked when enabled, then require relevance when enabled for viewing.
    await options.getByLabel('Hide Shorts', { exact: true }).check();
    await page.goto('https://www.youtube.com/shorts/short1');
    await page.getByRole('heading', { name: 'Shorts are hidden' }).waitFor();
    await options.getByLabel('Hide Shorts', { exact: true }).uncheck();
    await page.getByRole('button', { name: 'Yes, this fits' }).click();
    await page.goto('https://www.youtube.com/live/live1');
    await page.getByRole('button', { name: 'Yes, this fits' }).click();
    // Subscription redirection opens the homepage without constructing a query.
    await options.getByLabel('Redirect subscriptions to homepage', { exact: true }).check();
    await page.goto('https://www.youtube.com/feed/subscriptions');
    await page.waitForURL('https://www.youtube.com/');
    assert.equal(new URL(page.url()).searchParams.get('search_query'), null);
    // Edit cancel preserves the session; submitting a new intent invalidates other approvals.
    const oldId = (await send('GET')).session.id;
    await page.getByRole('button', { name: 'Edit intent' }).click();
    await page.getByRole('button', { name: 'Keep current intent' }).click();
    assert.equal((await send('GET')).session.id, oldId);
    await page.getByRole('button', { name: 'Edit intent' }).click();
    await page.getByLabel('Your intent', { exact: true }).fill('Learn geometry');
    await page.getByRole('button', { name: 'Start session' }).click();
    // Typed text is handed to YouTube's own search box (for its suggestions), not submitted.
    await page.waitForFunction(() => document.activeElement?.name === 'search_query' && document.activeElement.value === 'Learn geometry');
    await second.getByRole('heading', { name: 'Does this video fit your intent?' }).waitFor();
    await options.getByRole('button', { name: 'Clear local data…' }).click();
    await options.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await send('GET')).session.intent, 'Learn geometry');
    await options.getByRole('button', { name: 'Clear local data…' }).click();
    await options.getByRole('button', { name: 'Clear and reset', exact: true }).click();
    await page.getByRole('heading', { name: 'What brings you to YouTube?' }).waitFor();
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole('button', { name: 'Settings' }).waitFor();
    await popup.locator('body').screenshot({ path: path.join(out, 'popup.png') });
    const newTab = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Open YouTube', exact: true }).click();
    const opened = await newTab;
    await opened.waitForURL('https://www.youtube.com/');
    await opened.getByRole('button', { name: 'Follow a course' }).click();
    await opened.getByRole('button', { name: 'Start session' }).click();
    await popup.getByRole('button', { name: 'Finish this session' }).click();
    await opened.getByRole('heading', { name: 'Session finished' }).waitFor();
    await send('RESET'); await opened.close();
    const privacy = await context.newPage(); await privacy.goto(`chrome-extension://${extensionId}/privacy.html`);
    await privacy.screenshot({ path: path.join(out, 'privacy.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const presets = page.locator('.preset:not(.saved-search-add):not(.saved-search-launch)');
    assert.equal(await presets.count(), 8);
    await page.getByRole('button', { name: 'Practice programming', exact: true }).focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByRole('button', { name: 'Just browse', exact: true }).evaluate(el => el.getRootNode().activeElement === el), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Practice programming', exact: true }).evaluate(el => el.getRootNode().activeElement === el), true);
    assert.equal(await page.getByLabel('Your intent', { exact: true }).getAttribute('maxlength'), '180');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, 'intent-narrow.png') });
    assert.deepEqual(errors, []);
    console.log(`Chromium ${context.browser()?.version()} passed: all 24 controls, intent/edit, gates, SPA, local previews and expiry, shared breaks, finish, settings sync, reset, popup actions, focus, narrow layout and connection recovery.`);
    console.log(`Screenshots: ${out}`);
  } catch (error) {
    console.error('Page errors:', errors);
    for (const [index, page] of (context?.pages() || []).entries()) {
      console.error('Page', index, page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 1200));
      await page.screenshot({ path: path.join(out, `failure-${index}.png`) }).catch(() => {});
    }
    throw error;
  } finally {
    await context?.close();
    // Only remove the unique profile created by this invocation, inside artifacts.
    if (path.dirname(path.resolve(profile)) !== out || !path.basename(profile).startsWith('test-profile-')) throw new Error('Unexpected test profile path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
