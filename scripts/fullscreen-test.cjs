const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until } = require('../tests/e2e-driver.cjs');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const fixture = `<!doctype html><title>Fullscreen lesson - YouTube</title>
<style>#player{background:#243342;width:640px;max-width:100%;height:360px}#player:fullscreen{width:100%;height:100%}video{width:100%;height:100%}</style>
<ytd-app><div id="player"><video muted controls></video></div><button id="enter">Enter fullscreen</button></ytd-app>`;
(async () => {
  const out = path.resolve('artifacts/e2e'); await fs.mkdir(out, { recursive: true });
  for (const name of ['chromium', 'firefox']) {
    const profile = await fs.mkdtemp(path.join(out, `${name}-fullscreen-profile-`));
    let d;
    try {
      d = await launch(name, fixture, profile);
      const p = await d.open('https://www.youtube.com/watch?v=lesson');
      const click = text => d.click(p, `[...${root}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`);
      const heading = text => until(() => d.evaluate(p, text => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('h1')?.textContent === text, text), text);
      await heading('What brings you to YouTube?'); await click('Practice programming'); await click('Start session');
      await heading('Does this video fit your intent?'); await click('Yes, this fits');
      const options = await d.open(d.extensionUrl('options.html'));
      await d.activate(p);
      await d.evaluate(p, () => {
        const video = document.querySelector('video');
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        video.srcObject = canvas.captureStream(10);
        setInterval(() => { const c = canvas.getContext('2d'); c.fillStyle = '#243342'; c.fillRect(0, 0, 640, 360); c.fillStyle = '#fff'; c.font = '28px sans-serif'; c.fillText('Unobstructed video', 190, 180); }, 100);
        document.querySelector('#enter').onclick = () => { video.play(); document.querySelector('#player').requestFullscreen(); };
      });
      await d.evaluate(p, () => document.querySelector('video').play());
      await until(() => d.evaluate(p, () => !document.querySelector('video').paused && document.querySelector('video').videoWidth > 0), 'normal decoded playback');
      for (const theater of [false, true]) {
        await d.evaluate(p, theater => {
          document.querySelector('#player').style.width = theater ? '100%' : '640px';
          document.body.style.minHeight = '1800px';
        }, theater);
        await until(() => d.evaluate(p, () => {
          const s = document.getElementById('curb-extension-root').shadowRoot;
          const pill = s.querySelector('.fullscreen-pill'), r = pill.getBoundingClientRect();
          const video = document.querySelector('video').getBoundingClientRect();
          return r.width > 0 && r.height <= 36 && Math.abs((r.left + r.right) / 2 - (video.left + video.right) / 2) < 1 &&
            getComputedStyle(pill).backgroundColor === 'rgba(15, 15, 15, 0.35)' &&
            r.left >= video.left && r.right <= video.right && r.top >= video.top && r.bottom <= video.bottom &&
            pill.textContent.includes('Practice programming') && pill.querySelectorAll('[data-time]').length === 1 && pill.querySelector('[data-time="session-short"]') &&
            getComputedStyle(pill).pointerEvents === 'none' && document.elementFromPoint(r.x + r.width/2, r.y + r.height/2) !== document.getElementById('curb-extension-root');
        }), 'playback intent and single session timer inside player, without intercepting clicks');
        const before = await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill [data-time="session-short"]').textContent);
        const intentBefore = await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar [data-time="intent"]').textContent);
        await d.evaluate(p, () => {
          window.sessionTimerMutations = 0;
          new MutationObserver(records => { window.sessionTimerMutations += records.length; }).observe(document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill [data-time="session-short"]'), {childList:true,characterData:true,subtree:true});
        });
        await until(() => d.evaluate(p, before => document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar [data-time="intent"]').textContent !== before, intentBefore), 'detailed intent timer advances');
        assert.equal(await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill [data-time="session-short"]').textContent), before);
        assert.equal(await d.evaluate(p, () => window.sessionTimerMutations), 0, 'no session text rewrites between minute boundaries');
        await d.screenshot(p, path.join(out, `${name}-playback-${theater ? 'theater' : 'normal'}.png`));
        console.log(`${name}: PASS ${theater ? 'theater' : 'normal'} playback shows one quiet session timer; intent seconds advance without rewriting the pill; click-through`);
      }
      await d.resize(p, 320, 900);
      await until(() => d.evaluate(p, () => {
        const pill = document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill');
        const r = pill.getBoundingClientRect(), session = pill.querySelector('[data-time="session-short"]').getBoundingClientRect();
        return r.height <= 36 && r.left >= 0 && r.right <= innerWidth && session.width > 0 && session.right < r.right;
      }), 'narrow playback pill stays on one line with readable session timer');
      await d.screenshot(p, path.join(out, `${name}-playback-narrow.png`));
      await d.resize(p, 1280, 900);
      await d.evaluate(p, () => scrollTo(0, 120));
      await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill').getBoundingClientRect().top === 8), 'indicator follows partially scrolled player');
      await d.evaluate(p, () => scrollTo(0, 800));
      await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill').getClientRects().length === 0), 'indicator hides with offscreen video');
      await d.evaluate(p, () => scrollTo(0, 0));
      const enter = async () => {
        await d.click(p, 'document.querySelector("#enter")');
        await until(() => d.evaluate(p, () => !!document.fullscreenElement && document.getElementById('curb-extension-root').hasAttribute('data-fullscreen') && !document.querySelector('video').paused), 'fullscreen playback');
        assert(await d.evaluate(p, () => {
          const s = document.getElementById('curb-extension-root').shadowRoot;
          return getComputedStyle(s.querySelector('.bar')).display === 'none' && [...s.querySelectorAll('.bar button,.bar input')].every(n => n.getClientRects().length === 0);
        }), 'all header controls must be invisible in fullscreen');
        await until(() => d.evaluate(p, () => parseFloat(getComputedStyle(document.body).paddingTop) === 0), 'no header space reserved');
      };
      for (const width of [1280, 390]) {
        await d.resize(p, width, 900); await enter();
        assert(await d.evaluate(p, () => {
          const s = document.getElementById('curb-extension-root').shadowRoot;
          const pill = s.querySelector('.fullscreen-pill'), r = pill.getBoundingClientRect();
          const style = getComputedStyle(pill);
          return r.width > 0 && r.width <= 580 && r.height <= 36 && r.left >= 0 && r.right <= innerWidth && r.top === 12 &&
            style.pointerEvents === 'none' && style.backgroundColor === 'rgba(15, 15, 15, 0.35)' &&
            pill.textContent.includes('Practice programming') && pill.querySelectorAll('[data-time]').length === 1 && /^\d+h \d{2}m$/.test(pill.querySelector('[data-time="session-short"]').textContent) &&
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== document.getElementById('curb-extension-root');
        }), 'pill must be compact, translucent, click-through, and show the correct intent/time');
        await d.background(async () => { state.session.totalMs = 59900; await persist(); });
        await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill [data-time]').textContent === '0h 01m'), 'session display changes at minute boundary');
        await d.screenshot(p, path.join(out, `${name}-fullscreen-pill-${width}.png`));
        await d.evaluate(p, () => document.exitFullscreen());
        await until(() => d.evaluate(p, () => !document.fullscreenElement && document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar').getClientRects().length > 0), 'header restored');
        await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill').getClientRects().length > 0), 'playback indicator returns inside normal player');
        console.log(`${name}: PASS compact translucent pill at ${width}px, live timer, click-through and normal header on exit`);
      }
      await enter();
      // Change the actual settings control without switching away from fullscreen.
      await d.evaluate(options, () => document.querySelector('[data-setting="fullscreenPill"]').click());
      await until(() => d.evaluate(p, () => !!document.fullscreenElement && !document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill')), 'setting hides pill immediately');
      await d.navigate(options, await d.url(options));
      await until(() => d.evaluate(options, () => document.querySelector('[data-setting="fullscreenPill"]')?.checked === false), 'preference persists after settings reload');
      await d.activate(p);
      if (!await d.evaluate(p, () => !!document.fullscreenElement)) await enter();
      await d.evaluate(options, () => document.querySelector('[data-setting="fullscreenPill"]').click());
      await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.fullscreen-pill')?.getClientRects().length > 0), 'setting restores pill immediately');
      console.log(`${name}: PASS settings toggle applies live and persists`);
      await d.background(async () => { state.session.nextBreakAt = state.session.totalMs + 1000; await persist(); });
      await heading('Keep watching?');
      await until(() => d.evaluate(p, () => !document.fullscreenElement && document.querySelector('video').paused), 'break pauses and exits fullscreen');
      // fullscreenchange is dispatched after fullscreenElement clears; wait for the re-render it triggers.
      await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar').getClientRects().length > 0), 'dock restored after fullscreen exit', 5000);
      console.log(`${name}: PASS break exits fullscreen, pauses video and restores header`);
      assert.deepEqual(d.errors, []);
    } finally { await d?.close(); }
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
