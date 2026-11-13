// Complete repeatable desktop journeys against both real extension runtimes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const C = require('../extension/core.js');
const distractions = require('../tests/distraction-fixtures.cjs');
const fixture = `<!doctype html><html><head><title>Python lesson - YouTube</title><style>button,a,video{display:block;margin:8px}video{width:min(400px,calc(100% - 16px));height:225px}ytd-app{display:block}</style></head><body>
<ytd-app>${require('../tests/native-search-fixture.cjs')}<ytd-browse page-subtype="home"><div id="contents">Recommendations</div></ytd-browse>
<ytd-watch-metadata><h1>Python lesson</h1></ytd-watch-metadata><video controls muted></video>
<button id="play">Play test video</button><button id="fullscreen">Fullscreen test video</button><button id="pip">Picture in picture test video</button>
<ytd-video-renderer><a id="video-title" href="/watch?v=lesson2">Python functions</a><div id="channel-name">Teacher</div><div class="metadata-snippet-text">A local visible description.</div></ytd-video-renderer>
</ytd-app></body></html>`;
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const button = (text, extension = true) => `[...${extension ? root : 'document'}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`;
const setting = key => `document.querySelector('[data-setting="${key}"]')`;
const out = path.resolve('artifacts/e2e');
async function run(name) {
  const result = { browser: name, startedAt: new Date().toISOString(), steps: [], pageErrors: [], status: 'running' };
  const profile = await fs.mkdtemp(path.join(out, `${name}-profile-`));
  let d, main, options, second, prefix;
  const step = async (name, fn) => {
    const entry = { name, status: 'running', startedAt: new Date().toISOString() }; result.steps.push(entry);
    try { await fn(); entry.status = 'passed'; console.log(`${result.browser}: PASS ${name}`); }
    catch (error) { entry.status = 'failed'; entry.error = error.stack; throw error; }
    finally { entry.finishedAt = new Date().toISOString(); }
  };
  const heading = (p, text) => until(() => d.evaluate(p, text => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('h1')?.textContent === text, text), text);
  const click = async (p, text, extension = true) => {
    const expression = button(text, extension);
    await until(() => d.evaluate(p, ({ text, extension }) => [...(extension ? document.getElementById('curb-extension-root')?.shadowRoot : document)?.querySelectorAll('button') || []].some(n => n.textContent === text && !n.disabled), { text, extension }), `button ${text}`);
    await d.click(p, expression);
  };
  const send = async (type, extra = {}) => {
    const r = await d.evaluate(options, message => (globalThis.browser || chrome).runtime.sendMessage(message), { type, ...extra });
    assert.equal(r.ok, true, r.error); return r.data;
  };
  const toggle = async (key, value) => {
    await until(() => d.evaluate(options, key => { const n = document.querySelector(`[data-setting="${key}"]`); return n && !n.disabled; }, key), key);
    if (await d.evaluate(options, key => document.querySelector(`[data-setting="${key}"]`).checked, key) !== value) await d.click(options, setting(key));
    await until(async () => (await send('GET')).settings[key] === value, `saved ${key}`);
  };
  const start = async (p, intent = 'Learn Python') => {
    await heading(p, 'What brings you to YouTube?');
    await d.fill(p, `${root}.querySelector('#curb-intent')`, intent);
    await click(p, 'Start session');
  };
  // Presets start a session without a search, so the current page (and its video gate) stays.
  const startPreset = async (p, preset = 'Practice programming') => {
    await heading(p, 'What brings you to YouTube?');
    await click(p, preset); await click(p, 'Start session');
  };
  const approved = async p => {
    await heading(p, 'Does this video fit your intent?'); await click(p, 'Yes, this fits');
    await until(() => d.evaluate(p, () => !document.documentElement.hasAttribute('data-curb-locked')), 'unlocked video');
    assert.equal(await d.evaluate(p, () => document.querySelector('video').paused), true);
  };
  const media = async p => {
    await d.evaluate(p, () => {
      const v = document.querySelector('video');
      if (!v.srcObject) {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        v.srcObject = canvas.captureStream(10);
        let frame = 0;
        window.fixturePaintInterval = setInterval(() => { const ctx = canvas.getContext('2d'); ctx.fillStyle = frame++ % 2 ? '#444' : '#555'; ctx.fillRect(0, 0, 320, 180); }, 100);
      }
      v.muted = true; window.fixtureMediaError = null;
      const failed = e => { window.fixtureMediaError = `${e.name}: ${e.message}`; };
      document.querySelector('#play').onclick = () => v.play().catch(failed);
      document.querySelector('#fullscreen').onclick = () => v.parentElement.requestFullscreen().catch(failed);
      document.querySelector('#pip').onclick = () => v.requestPictureInPicture().catch(failed);
    });
    await d.click(p, 'document.querySelector("#play")');
    await until(() => d.evaluate(p, () => { if (window.fixtureMediaError) throw new Error(window.fixtureMediaError); const v = document.querySelector('video'); return !v.paused && v.readyState >= 2 && v.videoWidth > 0; }), 'decoded video plays after deliberate click');
  };
  const reset = async () => {
    await click(options, 'Clear local data…', false); await click(options, 'Clear and reset', false);
    await heading(main, 'What brings you to YouTube?');
  };
  try {
    d = await launch(name, fixture, profile); result.version = d.version;
    await step('Install, initial intent, input validation and all presets', async () => {
      main = await d.open('https://www.youtube.com/');
      await heading(main, 'What brings you to YouTube?');
      assert.equal(await d.evaluate(main, () => document.querySelector('ytd-app').inert), true);
      await d.fill(main, `${root}.querySelector('#curb-intent')`, 'ab'); await click(main, 'Start session');
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').checkValidity()), false);
      for (const p of C.PRESETS) {
        await click(main, p);
        assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').value), 'ab');
      }
      await d.fill(main, `${root}.querySelector('#curb-intent')`, 'x'.repeat(200));
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').value.length), 180);
      const typedFrom = await d.url(main);
      await d.fill(main, `${root}.querySelector('#curb-intent')`, 'Learn Python & geometry?'); await click(main, 'Start session');
      await until(() => d.evaluate(main, () => document.activeElement?.name === 'search_query' && document.activeElement.value === 'Learn Python & geometry?'), 'typed intent waits in the native search box');
      assert.equal(await d.url(main), typedFrom, 'starting a session does not submit a search');
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.querySelector('#contents')).display), 'none');
      options = await d.open(d.extensionUrl('options.html')); await d.activate(main);
      prefix = (await d.url(options)).replace(/options.html$/, '');
      await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'settings loaded');
      assert.equal((await send('GET')).session.intent, 'Learn Python & geometry?');
    });
    await step('Search intent encoding and direct/reload relevance gates', async () => {
      assert.equal(await d.evaluate(main, () => [...document.getElementById('curb-extension-root').shadowRoot.querySelectorAll('.bar button')].some(n => n.textContent === 'Search YouTube')), false, 'no duplicate search button while YouTube shows its own');
      await d.click(main, "document.querySelector('[name=search_query]')");
      // The page may already show this exact results URL, so wait for the new navigation itself.
      const searchRequests = d.requests.length;
      await d.fill(main, "document.querySelector('[name=search_query]')", 'Learn Python & geometry?'); await d.key(main, 'Enter');
      await until(() => d.requests.slice(searchRequests).some(url => new URL(url).pathname === '/results'), 'native search navigation sent');
      await until(async () => new URL(await d.url(main)).pathname === '/results' && await d.evaluate(main, () => document.readyState !== 'loading'), 'intent search');
      assert.equal(new URL(await d.url(main)).searchParams.get('search_query'), 'Learn Python & geometry?');
      await d.navigate(main, 'https://www.youtube.com/watch?v=lesson1'); await approved(main);
      await d.navigate(main, 'https://www.youtube.com/watch?v=lesson1'); await heading(main, 'Does this video fit your intent?');
      await click(main, 'Search instead');
      await heading(main, 'Search or browse');
      await d.fill(main, "document.querySelector('[name=search_query]')", 'Different topic & examples?');
      await d.key(main, 'Enter');
      await until(async () => new URL(await d.url(main)).pathname === '/results', 'relevance search instead');
      assert.equal(new URL(await d.url(main)).searchParams.get('search_query'), 'Different topic & examples?');
      assert.equal((await send('GET')).session.intent, 'Learn Python & geometry?');
      await d.navigate(main, 'https://www.youtube.com/watch?v=lesson1'); await approved(main);
    });
    await step('Search YouTube reveals a hidden header without changing the saved preference', async () => {
      await toggle('hideHeader', true);
      await click(main, 'Search YouTube');
      await until(() => d.evaluate(main, () => !document.documentElement.hasAttribute('data-curb-hide-header')), 'native header revealed');
      assert.equal((await send('GET')).settings.hideHeader, true, 'preference unchanged');
      await d.fill(main, "document.querySelector('[name=search_query]')", 'math & music'); await d.key(main, 'Enter');
      await until(async () => new URL(await d.url(main)).searchParams.get('search_query') === 'math & music', 'native search after revealing hidden header');
      await until(() => d.evaluate(main, () => document.documentElement.hasAttribute('data-curb-hide-header')), 'header hidden again after navigation');
      await toggle('hideHeader', false);
      await d.navigate(main, 'https://www.youtube.com/watch?v=lesson1'); await approved(main);
    });
    await step('Declared YouTube origins are gated; unrelated websites are untouched', async () => {
      for (const host of ['youtube.com', 'm.youtube.com']) {
        const p = await d.open(`https://${host}/watch?v=origin1`); await heading(p, 'Does this video fit your intent?'); await d.closeTab(p);
      }
      const p = await d.open('https://example.test/watch?v=unrelated');
      assert.equal(await d.evaluate(p, () => !!document.getElementById('curb-extension-root')), false);
      assert.equal(await d.evaluate(p, () => document.documentElement.hasAttribute('data-curb-ready')), false); await d.closeTab(p);
    });
    await step('Explicit playback, SPA playlist advancement and history back', async () => {
      await media(main);
      await d.evaluate(main, () => { document.dispatchEvent(new Event('yt-navigate-start')); history.replaceState({}, '', '/watch?v=lesson1&t=30'); document.dispatchEvent(new Event('yt-navigate-finish')); });
      assert.equal(await d.evaluate(main, () => document.documentElement.hasAttribute('data-curb-locked')), false);
      await d.evaluate(main, () => { document.dispatchEvent(new Event('yt-navigate-start')); history.pushState({}, '', '/watch?v=lesson2&list=PLcourse&index=2'); document.dispatchEvent(new Event('yt-navigate-finish')); });
      await heading(main, 'Does this video fit your intent?');
      assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true); await approved(main);
      await d.evaluate(main, () => history.back()); await heading(main, 'Does this video fit your intent?'); await approved(main);
    });
    await step('Every visual control hides and restores through Settings UI', async () => {
      for (const [key] of C.CONTROLS) await toggle(key, false);
      for (const [key, markup] of Object.entries(distractions)) {
        await d.evaluate(main, markup => { document.getElementById('probe-box')?.remove(); const box = document.createElement('div'); box.id = 'probe-box'; box.innerHTML = markup; document.querySelector('ytd-app').append(box); }, markup);
        await until(() => d.evaluate(main, () => getComputedStyle(document.querySelector('[data-probe]')).display !== 'none'), `initial ${key}`);
        await toggle(key, true);
        await until(() => d.evaluate(main, () => getComputedStyle(document.querySelector('[data-probe]')).display === 'none'), `hide ${key}`);
        await toggle(key, false);
        await until(() => d.evaluate(main, () => getComputedStyle(document.querySelector('[data-probe]')).display !== 'none'), `restore ${key}`);
      }
      await d.evaluate(main, () => document.getElementById('probe-box').remove());
    });
    await step('Autoplay, replay without reconfirmation, Shorts and live URL gates', async () => {
      await toggle('disableAutoplay', true);
      await d.evaluate(main, () => { const b = document.createElement('button'); b.className = 'ytp-autonav-toggle-button'; b.setAttribute('aria-checked', 'true'); b.onclick = () => b.setAttribute('aria-checked', 'false'); document.querySelector('ytd-app').append(b); });
      await until(() => d.evaluate(main, () => document.querySelector('.ytp-autonav-toggle-button').getAttribute('aria-checked') === 'false'), 'autoplay off');
      await d.evaluate(main, () => document.querySelector('video').dispatchEvent(new Event('ended')));
      assert.equal(await d.evaluate(main, () => document.documentElement.hasAttribute('data-curb-locked')), false);
      await toggle('hideShorts', true); await d.navigate(main, 'https://www.youtube.com/shorts/short1'); await heading(main, 'Shorts are hidden');
      await toggle('hideShorts', false); await approved(main);
      await d.navigate(main, 'https://www.youtube.com/live/stream1'); await approved(main);
      await toggle('redirectSubscriptions', true); await d.navigate(main, 'https://www.youtube.com/feed/subscriptions');
      await until(async () => new URL(await d.url(main)).pathname === '/', 'subscription redirect');
      assert.equal(new URL(await d.url(main)).searchParams.get('search_query'), null);
      await toggle('redirectSubscriptions', false); await d.navigate(main, 'https://www.youtube.com/watch?v=lesson1'); await approved(main);
    });
    await step('Local preview content, escaping, native menu event, dismiss/disable/expiry', async () => {
      await toggle('localPreviews', true);
      const preview = async () => {
        assert.equal(await d.evaluate(main, () => document.querySelector('#video-title').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))), true);
        await until(() => d.evaluate(main, () => !document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview').hidden), 'preview visible');
      };
      await preview();
      assert.match(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview small').textContent), /^Description excerpt$/);
      await d.evaluate(main, () => document.querySelector('#video-title').focus()); await d.key(main, 'Escape');
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview').hidden), true);
      await preview(); await d.click(main, `${root}.querySelector('.preview button')`);
      await preview(); await toggle('localPreviews', false);
      await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview').hidden), 'disabled preview closes');
      await toggle('localPreviews', true);
      await d.evaluate(main, () => { document.querySelector('.metadata-snippet-text').remove(); document.querySelector('#video-title').textContent = '<img src=x onerror=alert(1)>'; });
      await preview();
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview img')), null);
      assert.match(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview small').textContent), /^Video metadata$/);
      // While the pointer rests on the card it stays open for reading; once the pointer leaves, it closes on its own.
      await d.hover(main, `${root}.querySelector('.preview b')`); await delay(15000);
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview').hidden), false, 'reading keeps the card open');
      await d.hover(main, "document.querySelector('#video-title')");
      await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preview').hidden), '14-second expiry after the pointer leaves', 16000);
    });
    await step('Shared media session, deduplicated timers and 30-minute break threshold', async () => {
      second = await d.open('https://www.youtube.com/watch?v=lesson3'); await approved(second);
      await media(main); await media(second);
      const before = await send('GET'), time = Date.now(); await delay(4200); const after = await send('GET');
      assert(after.session.totalMs > before.session.totalMs);
      assert(after.session.totalMs - before.session.totalMs <= Date.now() - time + 500, 'two playing tabs must count once');
      await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1200; await persist(); });
      await heading(main, 'Keep watching?'); await heading(second, 'Keep watching?');
      assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true);
      assert.equal(await d.evaluate(second, () => document.querySelector('video').paused), true);
      await click(second, 'Continue for 30 min');
      await until(async () => !(await send('GET')).session.breakDue, 'continue clears break');
      assert.equal(await d.evaluate(second, () => document.querySelector('video').paused), true);
    });
    await step('60-minute interval, due break preservation, finish and frozen summary', async () => {
      await d.evaluate(options, () => { const s = document.querySelector('select'); s.value = '60'; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await until(async () => (await send('GET')).settings.breakMinutes === 60, '60-minute saved');
      const s = (await send('GET')).session; assert(Math.abs(s.nextBreakAt - s.totalMs - 3600000) < 3000);
      await media(main); await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1000; await persist(); });
      await heading(main, 'Keep watching?');
      await d.evaluate(options, () => { const s = document.querySelector('select'); s.value = '30'; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await until(async () => (await send('GET')).settings.breakMinutes === 30, 'interval changed while break due');
      assert.equal((await send('GET')).session.breakDue, true);
      await click(main, 'Finish for now'); await heading(second, 'Session finished');
      const total = (await send('GET')).session.totalMs; await delay(2100); assert.equal((await send('GET')).session.totalMs, total);
      await click(main, 'Set intent'); await startPreset(main); await approved(main);
    });
    await step('Edit cancel and new intent invalidate all video approvals', async () => {
      await approved(second); const id = (await send('GET')).session.id;
      await click(main, 'Edit intent'); await click(main, 'Keep current intent'); assert.equal((await send('GET')).session.id, id);
      const before = (await send('GET')).session;
      await click(main, 'Edit intent'); await startPreset(main, 'Learn a language'); await approved(main);
      await heading(second, 'Does this video fit your intent?');
      const after = (await send('GET')).session;
      assert.equal(after.id, id, 'editing keeps the session'); assert.equal(after.intent, 'Learn a language');
      assert(after.totalMs >= before.totalMs && after.nextBreakAt === before.nextBreakAt, 'editing keeps the session clock and break');
    });
    await step('Separate browser windows share breaks and finish', async () => {
      let windowPage;
      if (name === 'firefox') windowPage = await d.open('https://www.youtube.com/watch?v=window1', 'window');
      else {
        const before = await d.tabs(); await d.evaluate(options, () => chrome.windows.create({ url: 'about:blank' }));
        windowPage = await until(async () => (await d.tabs()).find(p => !before.includes(p)), 'new browser window');
        await d.navigate(windowPage, 'https://www.youtube.com/watch?v=window1');
      }
      await approved(windowPage); await media(windowPage);
      await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1000; await persist(); });
      await heading(windowPage, 'Keep watching?'); await heading(main, 'Keep watching?');
      await click(windowPage, 'Continue for 30 min');
      await until(async () => !(await send('GET')).session.breakDue, 'window continuation');
      await click(main, 'Finish'); await heading(windowPage, 'Session finished'); await d.closeTab(windowPage);
      await click(main, 'Set intent'); await startPreset(main); await approved(main);
    });
    await step('Fullscreen exits on break and playback remains paused', async () => {
      await d.activate(main); await media(main); await d.click(main, 'document.querySelector("#fullscreen")');
      await until(() => d.evaluate(main, () => !!document.fullscreenElement), 'native fullscreen entered');
      await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').hasAttribute('data-fullscreen')), 'fullscreen mode applied');
      assert.equal(await d.evaluate(main, () => { const s = document.getElementById('curb-extension-root').shadowRoot; return getComputedStyle(s.querySelector('.bar')).display === 'none' && !s.querySelector('input[type=search]'); }), true, 'fullscreen must hide the entire extension header and search');
      const fullscreenIntent = (await send('GET')).session.intent;
      assert.equal(await d.evaluate(main, intent => { const p = document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill'); return p.getBoundingClientRect().height <= 36 && p.getClientRects().length > 0 && p.textContent.includes(intent); }, fullscreenIntent), true, 'fullscreen retains only the compact intent/time pill');
      await d.screenshot(main, path.join(out, `${name}-fullscreen-video.png`));
      await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1000; await persist(); });
      await heading(main, 'Keep watching?');
      await until(() => d.evaluate(main, () => !document.fullscreenElement && document.querySelector('video').paused), 'fullscreen exited and paused');
      await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar').getClientRects().length > 0), 'header restored after fullscreen break');
      await click(main, 'Continue for 30 min');
    });
    await step('Picture-in-picture exits on prompt where the DOM API is supported', async () => {
      if (!await d.evaluate(main, () => document.pictureInPictureEnabled === true)) { result.steps.at(-1).note = 'Browser does not expose the DOM PiP API; browser-owned PiP requires manual verification.'; return; }
      await media(main); await d.click(main, 'document.querySelector("#pip")');
      await until(() => d.evaluate(main, () => !!document.pictureInPictureElement), 'PiP entered');
      await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1000; await persist(); });
      await heading(main, 'Keep watching?');
      await until(() => d.evaluate(main, () => !document.pictureInPictureElement && document.querySelector('video').paused), 'PiP exited and paused');
      await click(main, 'Continue for 30 min');
    });
    if (d.suspendBackground) await step('Session survives background service-worker suspension', async () => {
      const id = (await send('GET')).session.id; await d.suspendBackground();
      assert.equal((await send('GET')).session.id, id); assert.equal(await d.evaluate(main, () => document.querySelector('video').paused), true);
    });
    await step('Settings sync, navigation, reset cancel and privacy link', async () => {
      const other = await d.open(prefix + 'options.html');
      await until(() => d.evaluate(other, () => !!document.querySelector('[data-setting]')), 'second settings ready');
      await toggle('hideComments', true);
      await until(() => d.evaluate(other, () => document.querySelector('[data-setting="hideComments"]').checked), 'settings tab synchronization');
      for (const hash of ['#intention', '#distractions', '#privacy']) {
        await d.click(options, `document.querySelector('a[href="${hash}"]')`);
        await until(() => d.evaluate(options, hash => document.querySelector(`a[href="${hash}"]`).getAttribute('aria-current') === 'location', hash), 'settings navigation active state');
      }
      await click(options, 'Clear local data…', false); await click(options, 'Cancel', false); assert((await send('GET')).session);
      const tabs = await d.tabs(); await d.click(options, `document.querySelector('a[href="privacy.html"]')`);
      const policy = await until(async () => (await d.tabs()).find(p => !tabs.includes(p)), 'privacy policy opens');
      await until(() => d.evaluate(policy, () => document.querySelector('h1')?.textContent === 'Privacy policy'), 'privacy content');
      await d.closeTab(policy); await d.closeTab(other);
    });
    await step('Popup opens YouTube, reflects session and finishes across tabs', async () => {
      const popup = await d.open(prefix + 'popup.html');
      await until(() => d.evaluate(popup, () => !!document.querySelector('button')), 'popup ready');
      const tabs = await d.tabs(); await click(popup, 'Open YouTube', false);
      const opened = await until(async () => (await d.tabs()).find(p => !tabs.includes(p)), 'popup opens YouTube');
      await until(async () => (await d.url(opened)).startsWith('https://www.youtube.com/'), 'opened YouTube URL');
      await click(popup, 'Finish this session', false); await heading(main, 'Session finished'); await heading(opened, 'Session finished');
      await d.closeTab(opened); await d.closeTab(popup);
    });
    await step('Last YouTube tab closure ends session; browser reset restores defaults', async () => {
      await d.closeTab(second); await d.closeTab(main);
      await until(async () => (await send('GET')).session === null, 'last tracked tab closure');
      main = await d.open('https://www.youtube.com/'); await start(main); await reset();
      assert.deepEqual((await send('GET')).settings, C.DEFAULTS);
    });
    await step('Keyboard focus wrap, narrow layout, reduced motion and YouTube theme untouched', async () => {
      await d.resize(main, 390, 844); await d.activate(main);
      await d.evaluate(main, first => [...document.getElementById('curb-extension-root').shadowRoot.querySelectorAll('.card button')].find(n => n.textContent === first).focus(), C.PRESETS[0]);
      await d.key(main, 'Shift+Tab');
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.activeElement.textContent), 'Just browse');
      await d.key(main, 'Tab'); assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.activeElement.textContent), C.PRESETS[0], 'focus wraps to the first prompt control');
      assert.equal(await d.evaluate(main, () => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await d.evaluate(main, () => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.getElementById('curb-extension-root').shadowRoot.querySelector('.card')).scrollBehavior), 'auto');
      await d.evaluate(main, () => document.documentElement.removeAttribute('dark'));
      await delay(500);
      assert.equal(await d.evaluate(main, () => document.documentElement.hasAttribute('dark')), false, "YouTube's own theme is not forced");
      assert.equal(await d.evaluate(main, () => {
        const s = document.getElementById('curb-extension-root').shadowRoot;
        return s.querySelector('.veil').getBoundingClientRect().bottom <= s.querySelector('.bar').getBoundingClientRect().top;
      }), true, 'prompt must not cover narrow search controls');
      await d.screenshot(main, path.join(out, `${name}-narrow.png`));
    });
    await step('Cold browser restart keeps settings/today and clears transient intent', async () => {
      await toggle('hideComments', false); await start(main, 'Session before restart');
      const before = await send('GET'); assert(before.session);
      result.pageErrors.push(...d.errors);
      assert.deepEqual(result.pageErrors, [], 'Unexpected page errors before cold restart');
      await d.close(); d = await launch(name, fixture, profile);
      options = await d.open(prefix + 'options.html');
      await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'options after restart');
      const after = await send('GET'); assert.equal(after.session, null); assert.equal(after.settings.hideComments, false);
      assert(after.total.ms >= before.total.ms - 16000, 'checkpointed daily total persists');
      main = await d.open('https://www.youtube.com/'); await heading(main, 'What brings you to YouTube?');
    });
    await step('Extension reload boundary and recovery after page reload', async () => {
      await d.navigate(main, 'https://www.youtube.com/watch?v=reload1');
      if (!(await send('GET')).session) await startPreset(main);
      await approved(main); await media(main);
      await d.evaluate(options, () => { const api = globalThis.browser || chrome; setTimeout(() => api.runtime.reload(), 50); });
      // An orphaned Chromium script releases the page instead of locking it, and asks for a reload.
      if (name === 'chromium') await until(() => d.evaluate(main, () => !document.documentElement.hasAttribute('data-curb-locked') &&
        !!document.getElementById('curb-extension-root').shadowRoot.querySelector('[role="alert"]')?.textContent.includes('Reload this tab')), 'invalidated Chromium script releases the page with a reload notice', 15000);
      else {
        await delay(2500);
        result.steps.at(-1).playbackPausedDuringReload = await d.evaluate(main, () => document.querySelector('video').paused);
        result.steps.at(-1).note = 'Firefox terminates old content scripts on extension reload. Existing media can continue until its YouTube tab is reloaded; the extension cannot enforce prompts while unloaded.';
      }
      const openTabs = await d.tabs(); if (!openTabs.includes(options)) options = await d.open('about:blank');
      await until(async () => { await d.navigate(options, prefix + 'options.html'); return true; }, 'extension pages available after reload', 20000);
      await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'options reconnect after reload');
      await d.navigate(main, 'https://www.youtube.com/watch?v=reload1');
      if (!(await send('GET')).session) await startPreset(main);
      await approved(main);
    });
    assert.deepEqual([...result.pageErrors, ...d.errors], [], 'Unexpected page JavaScript errors');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error.stack;
    for (const [index, p] of (await d?.tabs().catch(() => []) || []).entries()) await d.screenshot(p, path.join(out, `${name}-failure-${index}.png`)).catch(() => {});
    console.error(`${name}: ${error.stack}`);
  } finally {
    result.pageErrors.push(...(d?.errors || [])); result.finishedAt = new Date().toISOString();
    await d?.close().catch(() => {});
    if (path.dirname(path.resolve(profile)) !== out || !path.basename(profile).startsWith(`${name}-profile-`)) throw new Error('Unexpected E2E profile path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.writeFile(path.join(out, `${name}-results.json`), JSON.stringify(result, null, 2) + '\n');
  }
  return result;
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox'];
  for (const name of names) { if (!['chromium', 'firefox'].includes(name)) throw new Error('Use chromium or firefox'); const r = await run(name); if (r.status !== 'passed') process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
