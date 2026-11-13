// Actual unpacked extensions, pointer/keyboard input, and live signed-out YouTube.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const out = path.resolve('artifacts/e2e');
const shadow = 'document.getElementById("curb-extension-root").shadowRoot';
const tags = ['ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-rich-item-renderer', 'ytd-compact-video-renderer', 'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'yt-lockup-view-model'];
const cards = tags.map((tag, i) => `<${tag} class="fixture-card"><${i === 6 ? 'yt-thumbnail-view-model' : 'ytd-thumbnail'}><a href="/watch?v=fixture${i}"><img alt="Lesson thumbnail" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='135'%3E%3Crect width='240' height='135' fill='coral'/%3E%3C/svg%3E"></a></${i === 6 ? 'yt-thumbnail-view-model' : 'ytd-thumbnail'}><a class="fixture-title" href="/watch?v=fixture${i}">Python lesson ${i}</a></${tag}>`).join('');
const fixture = `<!doctype html><title>Thumbnail fixtures - YouTube</title><style>.fixture-card{display:flex;gap:20px;padding:20px;align-items:center}ytd-thumbnail,yt-thumbnail-view-model{display:block;width:240px;height:135px}a{color:white}ytd-video-preview{display:block;background:coral}</style><body><ytd-app>${cards}<ytd-video-preview>Floating animated preview</ytd-video-preview><video id="main-player" controls></video></ytd-app></body>`;
async function run(name, live) {
  const label = `${name}-thumbnails-${live ? 'live' : 'fixture'}`;
  const result = { browser: name, live, startedAt: new Date().toISOString(), steps: [], status: 'running' };
  const profile = await fs.mkdtemp(path.join(out, `${label}-profile-`));
  let d, main, options;
  const step = async (title, fn) => { await fn(); result.steps.push(title); console.log(`${label}: PASS ${title}`); };
  const button = text => `${shadow}.querySelector('button') && [...${shadow}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`;
  const mode = async value => {
    await d.activate(options);
    await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting="thumbnailMode"]') && !document.querySelector('[data-setting="thumbnailMode"]').disabled), 'thumbnail setting ready');
    await d.evaluate(options, () => document.querySelector('[data-setting="thumbnailMode"]').focus());
    await d.key(options, 'Home');
    await until(() => d.evaluate(options, () => !document.querySelector('[data-setting="thumbnailMode"]').disabled), 'first option saved');
    for (let i = 0; i < ['show', 'hover', 'hidden'].indexOf(value); i++) {
      // Each native selection autosaves and briefly disables the control.
      await d.evaluate(options, () => document.querySelector('[data-setting="thumbnailMode"]').focus());
      await d.key(options, 'ArrowDown');
      await until(() => d.evaluate(options, () => !document.querySelector('[data-setting="thumbnailMode"]').disabled), 'selection saved');
    }
    await d.key(options, 'Escape');
    await until(() => d.evaluate(main, value => document.documentElement.getAttribute('data-curb-thumbnails') === value, value), `mode ${value} propagated`);
    await d.activate(main);
  };
  const leave = async () => {
    await d.evaluate(main, () => document.activeElement?.blur());
    await d.hover(main, `${shadow}.querySelector('.intent')`);
  };
  const opacity = () => d.evaluate(main, () => document.querySelector('[data-test-thumb]').getBoundingClientRect().width > 1 ? '1' : '0');
  const preview = value => until(() => d.evaluate(main, value => !document.getElementById('curb-extension-root').shadowRoot.querySelector('.thumbnail-preview').hidden === value, value), 'floating thumbnail');
  const visible = value => until(async () => (await opacity()) === value, `thumbnail opacity ${value}`);
  try {
    d = await launch(name, live ? null : fixture, profile); result.version = d.version;
    main = await d.open('https://www.youtube.com/results?search_query=python+programming');
    if (live) await until(() => d.evaluate(main, () =>
      !!document.querySelector('ytd-video-renderer a#video-title[href*="/watch?"],yt-lockup-view-model h3 a[href*="/watch?"]') &&
      document.querySelector('input[name=search_query]')?.value === 'python programming'), 'native results loaded', 30000);
    await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('h1')?.textContent === 'What brings you to YouTube?'), 'initial intent');
    await d.click(main, button('Practice programming'));
    await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.preset[aria-pressed="true"]')?.textContent === 'Practice programming'), 'preset selected');
    await d.click(main, button('Start session'));
    await until(() => d.evaluate(main, () => !document.documentElement.hasAttribute('data-curb-locked')), 'session unlocked');
    options = await d.open(d.extensionUrl('options.html')); await d.activate(main);
    await until(() => d.evaluate(main, () => {
      const thumb = [...document.querySelectorAll('ytd-video-renderer ytd-thumbnail, yt-lockup-view-model yt-thumbnail-view-model')].find(node => {
        const card = node.closest('ytd-video-renderer,yt-lockup-view-model');
        const title = card.querySelector('a#video-title,.fixture-title,h3 a');
        return title?.href.includes('/watch?') && !card.closest('ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,[is-ad]') &&
          node.querySelector('img')?.complete && node.querySelector('img')?.naturalWidth > 0;
      });
      if (!thumb) return false;
      const card = thumb.closest('ytd-video-renderer,yt-lockup-view-model');
      const title = card.querySelector('a#video-title,.fixture-title,h3 a');
      if (!title) return false;
      thumb.setAttribute('data-test-thumb', ''); title.setAttribute('data-test-title', ''); card.setAttribute('data-test-card', ''); return true;
    }), 'loaded thumbnail and title', 30000);
    await step('Thumbnails default to hover and Shorts are blocked', async () => {
      await leave(); await visible('0');
      assert.equal(await d.evaluate(main, () => document.documentElement.getAttribute('data-curb-thumbnails')), 'hover');
      assert(await d.evaluate(main, () => document.documentElement.hasAttribute('data-curb-hide-shorts')));
    });
    if (live) await step('Live Shorts cards and complete shelves are invisible', async () => {
      const probes = await d.evaluate(main, () => {
        const hidden = n => { for (let a = n; a; a = a.parentElement) if (getComputedStyle(a).display === 'none') return true; return false; };
        return [...document.querySelectorAll('[data-curb-shorts-control], ytm-shorts-lockup-view-model, yt-shorts-lockup-view-model, grid-shelf-view-model:has(ytm-shorts-lockup-view-model), yt-grid-shelf-view-model:has(ytm-shorts-lockup-view-model)')].map(hidden);
      });
      assert(probes.length > 0, 'Live results must contain Shorts to validate filtering');
      assert(probes.every(Boolean), 'Shorts cards and their shelf headings must be hidden');
    });
    if (!live) await step('Shorts layouts and dynamically inserted cards are hidden without hiding regular videos', async () => {
      const probes = await d.evaluate(main, () => {
        const area = document.createElement('section');
        area.innerHTML = `
          <yt-shorts-lockup-view-model data-short>Short</yt-shorts-lockup-view-model>
          <ytm-shorts-lockup-view-model data-short>Short</ytm-shorts-lockup-view-model>
          <ytm-shorts-lockup-view-model-v2 data-short>Short</ytm-shorts-lockup-view-model-v2>
          <ytd-reel-item-renderer data-short>Short</ytd-reel-item-renderer>
          <yt-lockup-view-model data-short><a href="/shorts/abc">Short</a></yt-lockup-view-model>
          <ytd-compact-video-renderer data-short><a href="https://www.youtube.com/shorts/abc">Short</a></ytd-compact-video-renderer>
          <ytd-rich-shelf-renderer data-short><h2>Shorts</h2><ytm-shorts-lockup-view-model>Short</ytm-shorts-lockup-view-model></ytd-rich-shelf-renderer>
          <grid-shelf-view-model data-short><h2>Shorts</h2><ytm-shorts-lockup-view-model-v2>Short</ytm-shorts-lockup-view-model-v2></grid-shelf-view-model>
          <ytd-guide-entry-renderer data-short><a href="/shorts">Shorts</a></ytd-guide-entry-renderer>
          <yt-tab-shape data-short><a href="/@creator/shorts">Shorts</a></yt-tab-shape>
          <a data-short href="/shorts/abc">Standalone Short</a>
          <yt-lockup-view-model data-regular><a href="/watch?v=regular">Regular video</a></yt-lockup-view-model>`;
        document.querySelector('ytd-app').append(area);
        return { hidden: [...area.querySelectorAll('[data-short]')].map(n => getComputedStyle(n).display), regular: getComputedStyle(area.querySelector('[data-regular]')).display };
      });
      assert(probes.hidden.length >= 10); assert(probes.hidden.every(display => display === 'none'));
      assert.notEqual(probes.regular, 'none');
      for (const route of ['/shorts', '/shorts/abc']) {
        await d.evaluate(main, route => { history.pushState({}, '', route); document.dispatchEvent(new Event('yt-navigate-finish')); }, route);
        await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('h1')?.textContent === 'Shorts are hidden'), 'Shorts route blocked');
      }
      await d.evaluate(main, () => { history.pushState({}, '', '/results?search_query=python'); document.dispatchEvent(new Event('yt-navigate-finish')); });
      await until(() => d.evaluate(main, () => !document.documentElement.hasAttribute('data-curb-locked')), 'search unlocked');
    });
    await step('Normal thumbnails are visible when explicitly enabled', async () => { await mode('show'); await leave(); await visible('1'); });
    await step('Always hidden survives thumbnail hover, title hover and keyboard focus', async () => {
      await mode('hidden'); await leave(); await visible('0');
      if (live) assert(await d.evaluate(main, () => [...document.querySelectorAll('ytd-expandable-metadata-renderer #thumbnail')].every(n => n.getBoundingClientRect().width <= 1)));
      for (const selector of ['[data-test-title]']) { await d.hover(main, `document.querySelector('${selector}')`); await visible('0'); }
      await d.evaluate(main, () => document.querySelector('[data-test-title]').focus()); await visible('0');
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.querySelector('[data-test-title]')).opacity), '1');
      await d.screenshot(main, path.join(out, `${label}-hidden.png`));
    });
    await step('Title hover floats one bounded preview without opening a blank slot', async () => {
      await mode('hover'); await leave(); await visible('0');
      const before = await d.evaluate(main, () => document.querySelector('[data-test-title]').getBoundingClientRect().width);
      await d.hover(main, "document.querySelector('[data-test-title]')"); await preview(true); await visible('0');
      assert(await d.evaluate(main, before => {
        const tip = document.getElementById('curb-extension-root').shadowRoot.querySelector('.thumbnail-preview');
        const r = tip.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && tip.querySelectorAll('img').length === 1 && document.querySelector('[data-test-title]').getBoundingClientRect().width === before;
      }, before));
      if (name === 'chromium') await main.screenshot({ path: path.join(out, `${label}-hover.png`), fullPage: false });
      else await d.screenshot(main, path.join(out, `${label}-hover.png`));
      await d.key(main, 'Escape'); await preview(false);
      await leave();
    });
    await step('Keyboard focus reveals the thumbnail and blur hides it', async () => {
      await d.evaluate(main, () => document.querySelector('[data-test-title]').focus()); await preview(true); await visible('0');
      await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar button').focus());
      await preview(false); await visible('0');
      await leave();
    });
    if (!live) await step('All card layouts, lazy insertion, preview bypass and main player', async () => {
      for (const tag of tags) {
        await leave();
        await d.hover(main, `document.querySelector('${tag} .fixture-title')`);
        await preview(true);
        assert.equal(await d.evaluate(main, tag => document.querySelector(`${tag} :is(ytd-thumbnail,yt-thumbnail-view-model)`).getBoundingClientRect().width, tag), 1);
      }
      // Regression: YouTube lazy-loads thumbnails. Hovering a title before its image loads must still
      // show the preview once the image arrives, without moving the pointer again.
      await leave();
      await d.evaluate(main, () => {
        const card = document.querySelector('ytd-video-renderer').cloneNode(true); card.id = 'lazy-card';
        card.querySelectorAll('a[href]').forEach(a => { a.href = '/watch?v=lazyload1'; });
        const img = card.querySelector('img'); window.lazySrc = document.querySelector('ytd-video-renderer img').currentSrc || document.querySelector('ytd-video-renderer img').src;
        img.removeAttribute('src'); img.removeAttribute('srcset');
        document.querySelector('ytd-app').prepend(card);
      });
      await d.hover(main, "document.querySelector('#lazy-card .fixture-title')");
      await delay(400);
      assert.equal(await d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.thumbnail-preview').hidden), true, 'no preview before the image loads');
      await d.evaluate(main, () => { document.querySelector('#lazy-card img').src = window.lazySrc; });
      await preview(true);
      await leave(); await preview(false);
      await d.evaluate(main, () => document.getElementById('lazy-card').remove());
      await mode('hidden');
      await d.evaluate(main, () => document.querySelector('ytd-app').append(document.querySelector('yt-lockup-view-model').cloneNode(true)));
      assert(await d.evaluate(main, () => [...document.querySelectorAll('ytd-thumbnail,yt-thumbnail-view-model')].every(n => n.getBoundingClientRect().width <= 1)));
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.querySelector('ytd-video-preview')).display), 'none');
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.querySelector('#main-player')).opacity), '1');
    });
    await step('Saved mode survives reload and syncs to popup; normal mode restores visuals', async () => {
      await mode('hidden');
      await d.navigate(main, await d.url(main));
      await until(() => d.evaluate(main, () => document.documentElement.getAttribute('data-curb-thumbnails') === 'hidden' && !!document.querySelector('ytd-thumbnail,yt-thumbnail-view-model')), 'persist after reload');
      assert(await d.evaluate(main, () => [...document.querySelectorAll('ytd-thumbnail,yt-thumbnail-view-model')].every(n => n.getBoundingClientRect().width <= 1)));
      const popup = await d.open((await d.url(options)).replace('options.html', 'popup.html'));
      await until(() => d.evaluate(popup, () => document.querySelector('[data-setting="thumbnailMode"]')?.value === 'hidden'), 'popup preference synced');
      await d.screenshot(popup, path.join(out, `${label}-popup.png`)); await d.closeTab(popup);
      await mode('show');
      assert(await d.evaluate(main, () => [...document.querySelectorAll('ytd-thumbnail,yt-thumbnail-view-model')].every(n => getComputedStyle(n).opacity === '1')));
    });
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = error.stack; console.error(label, error); if (main) await d.screenshot(main, path.join(out, `${label}-failure.png`)).catch(() => {}); }
  finally {
    result.finishedAt = new Date().toISOString(); result.pageErrors = d?.errors || [];
    await d?.close().catch(() => {});
    if (path.dirname(path.resolve(profile)) !== out || !path.basename(profile).startsWith(`${label}-profile-`)) throw new Error('Unexpected profile path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    await fs.writeFile(path.join(out, `${label}-results.json`), JSON.stringify(result, null, 2) + '\n');
  }
  if (result.status !== 'passed') process.exitCode = 1;
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const names = process.argv.slice(2).filter(v => v !== '--live');
  for (const name of names.length ? names : ['chromium', 'firefox']) {
    if (!['chromium', 'firefox'].includes(name)) throw new Error('Use chromium or firefox');
    await run(name, process.argv.includes('--live'));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
