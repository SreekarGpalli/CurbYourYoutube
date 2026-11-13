// Live signed-out desktop journeys. No existing profile, login or account mutations.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const nativeSearch = "document.querySelector('input[name=search_query]')";
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const findButton = (text, content = true) => `[...${content ? root : 'document'}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`;
const out = path.resolve('artifacts/e2e');
async function run(name) {
  const result = { browser: name, scope: 'live signed-out YouTube', startedAt: new Date().toISOString(), steps: [], status: 'running' };
  const profile = await fs.mkdtemp(path.join(out, `${name}-live-profile-`));
  let d, main, options, second, probe;
  const step = async (name, fn) => {
    const s = { name, status: 'running' }; result.steps.push(s);
    try { await fn(s); s.status = 'passed'; console.log(`${result.browser} live: PASS ${name}`); }
    catch (e) { s.status = 'failed'; s.error = e.message; throw e; }
  };
  const heading = (p, text) => until(() => d.evaluate(p, text => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('h1')?.textContent === text, text), text);
  const click = (p, text, content = true) => d.click(p, findButton(text, content));
  const send = async (type, extra = {}) => {
    const r = await d.evaluate(options, message => (globalThis.browser || chrome).runtime.sendMessage(message), { type, ...extra });
    assert.equal(r.ok, true, r.error); return r.data;
  };
  const fillNative = async (page, value) => {
    await until(() => d.evaluate(page, () => { const input = document.querySelector('input[name=search_query]'); return document.readyState === 'complete' && input?.getBoundingClientRect().height > 0 && !document.querySelector('ytd-app').inert; }), 'native search loaded', 30000);
    await until(async () => {
      await d.click(page, nativeSearch);
      await d.fill(page, nativeSearch, value);
      return d.evaluate(page, value => {
        const input = document.querySelector('input[name=search_query]');
        return document.readyState === 'complete' && input === document.activeElement && input.value === value;
      }, value);
    }, 'native query typed', 30000);
  };
  const toggle = async (key, value) => {
    await until(() => d.evaluate(options, key => { const n = document.querySelector(`[data-setting="${key}"]`); return n && !n.disabled; }, key), key);
    if (await d.evaluate(options, key => document.querySelector(`[data-setting="${key}"]`).checked, key) !== value) await d.click(options, `document.querySelector('[data-setting="${key}"]')`);
    await until(async () => (await send('GET')).settings[key] === value, `save ${key}`);
  };
  try {
    d = await launch(name, null, profile); result.version = d.version;
    await step('Just browse then native search exposes usable live results and Home preserves the session', async () => {
      probe = await d.open('https://www.youtube.com/'); await heading(probe, 'What brings you to YouTube?');
      await click(probe, 'Just browse');
      await until(() => d.evaluate(probe, () => !document.documentElement.hasAttribute('data-curb-locked')), 'browsing unlocked');
      await fillNative(probe, 'Bollywood songs'); await d.key(probe, 'Enter');
      await until(async () => new URL(await d.url(probe)).searchParams.get('search_query') === 'Bollywood songs', 'arbitrary search URL');
      await until(() => d.evaluate(probe, () => !!document.querySelector('ytd-video-renderer a[href*="/watch?"],yt-lockup-view-model a[href*="/watch?"]') && !document.documentElement.hasAttribute('data-curb-locked') && !document.querySelector('ytd-app').inert), 'live results unlocked', 30000);
      options = await d.open(d.extensionUrl('options.html'));
      await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'browse settings ready');
      const id = (await send('GET')).session.id;
      assert.equal((await send('GET')).session.mode, 'browse');
      await d.activate(probe); await d.navigate(probe, 'https://www.youtube.com/'); await until(async () => new URL(await d.url(probe)).pathname === '/', 'Home destination');
      await until(() => d.evaluate(probe, () => !document.documentElement.hasAttribute('data-curb-locked')), 'Home unlocked');
      assert.equal(new URL(await d.url(probe)).pathname, '/'); assert.equal((await send('GET')).session.id, id);
      await fillNative(probe, 'लग जा गले'); await d.key(probe, 'Enter');
      await until(async () => new URL(await d.url(probe)).searchParams.get('search_query') === 'लग जा गले', 'Unicode query preserved');
      await until(() => d.evaluate(probe, () => document.documentElement.hasAttribute('data-curb-ready') && !document.documentElement.hasAttribute('data-curb-locked')), 'Unicode results unlocked');
      await until(() => d.evaluate(probe, () => [...document.querySelectorAll('ytd-video-renderer a[href*="/watch?"],yt-lockup-view-model a[href*="/watch?"]')].some(a => a.getBoundingClientRect().height > 0)), 'Unicode result cards visible', 30000);
      await d.screenshot(probe, path.join(out, `${name}-live-casual-search.png`));
      await click(options, 'Clear local data…', false); await click(options, 'Clear and reset', false);
      await heading(probe, 'What brings you to YouTube?'); await d.closeTab(probe); probe = null; await d.closeTab(options); options = null;
    });
    await step('Homepage intent and Settings on real YouTube', async () => {
      main = await d.open('https://www.youtube.com/'); await heading(main, 'What brings you to YouTube?');
      await click(main, 'Practice programming'); await click(main, 'Start session'); await heading(main, 'Search or browse');
      options = await d.open(d.extensionUrl('options.html'));
      await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'settings ready');
      assert.equal((await send('GET')).session.intent, 'Practice programming');
    });
    let videoUrls;
    await step('Intent search, real result titles and local preview', async () => {
      await fillNative(main, 'Python programming functions tutorial');
      await d.key(main, 'Enter');
      await until(async () => new URL(await d.url(main)).pathname === '/results', 'search results URL');
      await until(() => d.evaluate(main, () => !!document.querySelector('ytd-video-renderer a#video-title[href*="/watch?"],yt-lockup-view-model a[href*="/watch?"]')), 'real result card', 25000);
      videoUrls = await d.evaluate(main, () => [...new Set([...document.querySelectorAll('ytd-video-renderer a#video-title[href*="/watch?"],yt-lockup-view-model a[href*="/watch?"]')]
        .filter(a => !a.closest('ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-video-renderer,[is-ad]') && /python|programming|code/i.test(a.textContent || a.getAttribute('title') || ''))
        .map(a => a.href))].slice(0, 2));
      assert(videoUrls.length);
      assert.equal(await d.evaluate(main, () => document.querySelector('ytd-video-renderer a#video-title[href*="/watch?"],yt-lockup-view-model a[href*="/watch?"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), true);
      await until(() => d.evaluate(main, () => !document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview').hidden), 'live preview');
      const preview = await d.evaluate(main, () => { const tip = document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview'); return { title: tip.querySelector('b').textContent, source: tip.querySelector('small').textContent }; });
      assert(preview.title.length > 0 && preview.title.length <= 160); assert.match(preview.source, /^(Description excerpt|Video metadata)$/);
      await d.screenshot(main, path.join(out, `${name}-live-preview.png`)); await d.key(main, 'Escape');
    });
    await step('Real direct video gate, current title and paused player', async () => {
      await d.navigate(main, videoUrls[0]); await heading(main, 'Does this video fit your intent?');
      await until(() => d.evaluate(main, () => !!document.querySelector('video')), 'real player loaded', 25000);
      assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true);
      assert.equal(await d.evaluate(main, () => document.querySelector('ytd-app').inert), true);
      await until(() => d.evaluate(main, () => { const title = document.querySelector('ytd-watch-metadata h1')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 240); const gate = document.getElementById('curb-extension-root').shadowRoot.querySelector('[data-video-title]')?.textContent; return title && gate === title; }), 'gate title matches actual video', 25000);
      await d.screenshot(main, path.join(out, `${name}-live-video-gate.png`));
      await click(main, 'Yes, this fits');
      assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true);
    });
    await step('Real watch-page controls hide and restore loaded elements', async s => {
      s.targets = [];
      for (const [key, selector] of [['hideComments', 'ytd-comments'], ['hideInfo', 'ytd-watch-metadata'], ['hideButtons', 'ytd-watch-metadata #actions'], ['hideChannel', 'ytd-watch-metadata #owner'], ['hideDescription', 'ytd-watch-metadata #description']]) {
        await toggle(key, false);
        const exists = await d.evaluate(main, selector => !!document.querySelector(selector), selector);
        if (!exists) { s.targets.push({ key, status: 'absent in this live layout' }); continue; }
        const baseline = await d.evaluate(main, selector => getComputedStyle(document.querySelector(selector)).display, selector);
        if (baseline === 'none') { s.targets.push({ key, status: 'already hidden by YouTube' }); continue; }
        await toggle(key, true);
        await until(() => d.evaluate(main, selector => getComputedStyle(document.querySelector(selector)).display === 'none', selector), `live hide ${key}`);
        await toggle(key, false);
        await until(() => d.evaluate(main, ({ selector, baseline }) => getComputedStyle(document.querySelector(selector)).display === baseline, { selector, baseline }), `live restore ${key}`);
        s.targets.push({ key, status: 'passed' });
      }
      assert(s.targets.some(t => t.status === 'passed'));
    });
    await step('Deliberate real video playback and timer accumulation', async s => {
      await d.activate(main);
      await until(() => d.evaluate(main, () => document.visibilityState === 'visible' && document.hasFocus()), 'watch tab is foreground and focused');
      await d.evaluate(main, () => { document.querySelector('video').muted = true; });
      if (await d.evaluate(main, () => document.querySelector('video').paused)) {
        // Real ad overlays can cover the small pointer control. Use YouTube's
        // keyboard play command with focus on the player, as a user can.
        await d.evaluate(main, () => document.querySelector('#movie_player').focus());
        await d.key(main, 'k');
      }
      await until(() => d.evaluate(main, () => { const v = document.querySelector('video'); return !v.paused && v.readyState >= 2; }), 'real decoded playback', 25000);
      s.adObserved = await d.evaluate(main, () => !!document.querySelector('.ad-showing'));
      const before = (await send('GET')).session.totalMs; await delay(4100); const after = (await send('GET')).session.totalMs;
      s.timerDeltaMs = after - before;
      s.playbackAfterSample = await d.evaluate(main, () => ({ paused: document.querySelector('video').paused, readyState: document.querySelector('video').readyState, visible: document.visibilityState, focused: document.hasFocus() }));
      assert(after > before);
    });
    await step('Compact intent pill replaces header/search in real player fullscreen', async () => {
      await d.activate(main);
      await d.click(main, 'document.querySelector(".ytp-fullscreen-button")');
      await until(() => d.evaluate(main, () => document.fullscreenElement?.contains(document.getElementById('curb-extension-root'))), 'live fullscreen intent');
      assert.equal(await d.evaluate(main, () => { const s = document.getElementById('curb-extension-root').shadowRoot; const pill = s.querySelector('.fullscreen-pill'); const r = pill.getBoundingClientRect(); return r.height > 0 && r.height <= 36 && r.top >= 0 && r.bottom <= innerHeight && pill.textContent.includes('Practice programming') && getComputedStyle(s.querySelector('.bar')).display === 'none'; }), true);
      await d.screenshot(main, path.join(out, `${name}-live-fullscreen.png`));
      await d.evaluate(main, () => document.exitFullscreen());
      await until(() => d.evaluate(main, () => !document.fullscreenElement && document.getElementById('curb-extension-root').parentNode === document.documentElement), 'intent returns after fullscreen');
      // Native fullscreen exit resizes Firefox asynchronously after fullscreenchange.
      let previousGeometry = '', stableGeometry = 0;
      await until(async () => {
        const geometry = await d.evaluate(main, () => { const r = document.querySelector('input[name=search_query]').getBoundingClientRect(); return JSON.stringify([innerWidth, innerHeight, r.x, r.y, r.width, r.height]); });
        stableGeometry = geometry === previousGeometry ? stableGeometry + 1 : 0; previousGeometry = geometry;
        return stableGeometry >= 5;
      }, 'fullscreen exit geometry settles');
      await d.activate(main);
      await d.click(main, nativeSearch);
      await until(() => d.evaluate(main, () => { return document.activeElement === document.querySelector('input[name=search_query]'); }), 'search focused after fullscreen');
      await fillNative(main, 'next topic');
      assert.equal(await d.evaluate(main, () => document.querySelector('input[name=search_query]').value), 'next topic');
    });
    await step('Second real video remains gated and break pauses live playback across tabs', async () => {
      second = await d.open(videoUrls[1] || videoUrls[0]); await heading(second, 'Does this video fit your intent?');
      await until(() => d.evaluate(second, () => !!document.querySelector('video')), 'second live player');
      assert.equal(await d.evaluate(second, () => document.querySelector('video').paused), true);
      await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1000; await persist(); });
      await heading(main, 'Keep watching?'); await heading(second, 'Keep watching?');
      assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true);
      await click(main, 'Continue for 30 min');
      await until(async () => !(await send('GET')).session.breakDue, 'live break continuation');
      assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true);
    });
    await step('Finish, reload and reset on live pages', async () => {
      await click(main, 'Finish'); await heading(main, 'Session finished'); await heading(second, 'Session finished');
      await d.navigate(main, videoUrls[0]); await heading(main, 'Session finished');
      await click(options, 'Clear local data…', false); await click(options, 'Clear and reset', false);
      await heading(main, 'What brings you to YouTube?'); await heading(second, 'What brings you to YouTube?');
    });
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error.stack; console.error(`${name} live: ${error.stack}`);
    const failedPage = main || probe;
    if (failedPage) result.failureDOM = await d.evaluate(failedPage, () => ({ url: location.href, title: document.title, headings: [...document.querySelectorAll('ytd-watch-metadata h1')].map(n => n.textContent), gate: document.getElementById('curb-extension-root')?.shadowRoot.querySelector('[data-video-title]')?.textContent })).catch(() => null);
    if (failedPage) await d.screenshot(failedPage, path.join(out, `${name}-live-failure.png`)).catch(() => {});
  } finally {
    result.finishedAt = new Date().toISOString(); result.observedPageErrors = d?.errors || [];
    await d?.close().catch(() => {});
    if (path.dirname(path.resolve(profile)) !== out || !path.basename(profile).startsWith(`${name}-live-profile-`)) throw new Error('Unexpected live profile path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.writeFile(path.join(out, `${name}-live-results.json`), JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox'];
  for (const name of names) { if (!['chromium', 'firefox'].includes(name)) throw new Error('Use chromium or firefox'); if ((await run(name)).status !== 'passed') process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
