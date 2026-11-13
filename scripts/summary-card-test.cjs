const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const items = Array.from({ length: 12 }, (_, i) => `<ytd-rich-item-renderer id="c${i}"><a id="video-title" class="t" href="/watch?v=video${String(i).padStart(2, '0')}x">Video ${i} — a reasonably long title to hover</a><p>Channel ${i}</p></ytd-rich-item-renderer>`).join('');
const fixture = `<!doctype html><meta charset="utf-8"><title>Fixture - YouTube</title>
<style>body{margin:0;background:#fff;font:14px sans-serif}#masthead-container{position:fixed;top:0;left:0;right:0;height:56px;background:#e8e8e8;z-index:10}
ytd-app{display:block;padding:72px 20px 20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
ytd-rich-item-renderer{display:block;height:150px;background:#f2f2f2;padding:10px}a.t{font-size:15px}
#movie_player{position:absolute;left:20px;top:72px;width:820px;height:460px;background:#111}</style>
<ytd-app><div id="masthead-container"><input name="search_query"></div><div class="grid">${items}</div></ytd-app>
<script>if (location.pathname === '/watch') { const g = document.querySelector('.grid'); g.style.cssText = 'grid-template-columns:1fr;margin-left:860px';
  document.querySelector('ytd-app').insertAdjacentHTML('afterbegin', '<div id="movie_player"><video></video></div>'); }</script>`;
const root = 'document.getElementById("curb-extension-root").shadowRoot';

async function run(name) {
  await fs.mkdir('artifacts/e2e', { recursive: true });
  const d = await launch(name, fixture, await fs.mkdtemp(path.resolve('artifacts/e2e', `${name}-summary-card-`)));
  const p = await d.open('https://www.youtube.com/results?search_query=fixture');
  const click = text => d.click(p, `[...${root}.querySelectorAll('button')].find(n => n.textContent === ${JSON.stringify(text)})`);
  const geometry = () => d.evaluate(p, () => {
    const s = document.getElementById('curb-extension-root').shadowRoot, tip = s.querySelector('aside.preview');
    const box = n => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    return { open: !tip.hidden, card: box(tip), bar: box(s.querySelector('.bar')), head: box(document.querySelector('#masthead-container')),
      player: document.querySelector('#movie_player') ? box(document.querySelector('#movie_player')) : null, viewport: [innerWidth, innerHeight] };
  });
  const overlap = (a, b) => b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
  const source = id => d.evaluate(p, id => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }, id);
  const title = id => d.evaluate(p, id => document.querySelector(`#${id} a.t`).getBoundingClientRect().toJSON(), id);
  const assertNear = async (g, id) => {
    const t = await title(id);
    const distance = Math.hypot(Math.max(t.left - g.card.right, g.card.left - t.right, 0),
      Math.max(t.top - g.card.bottom, g.card.top - t.bottom, 0));
    assert.equal(overlap(g.card, t), 0, `${id}: the title stays visible`);
    assert(distance <= 24, `${id}: card should open within 24px of the title where there is room, got ${distance}px`);
  };
  const pillOpen = () => d.evaluate(p, () => !document.getElementById('curb-extension-root').shadowRoot.querySelector('.summarize-pill').hidden);
  // Hover the title, wait for the button (hover intent), click it: opens the full card.
  const summarize = async id => {
    await d.hover(p, `document.querySelector('#${id} a.t')`);
    await until(pillOpen, `button for ${id}`);
    await d.click(p, `${root}.querySelector('.summarize-pill')`);
    await until(() => d.evaluate(p, () => /contact Google/.test(document.getElementById('curb-extension-root').shadowRoot.querySelector('.ai-summary')?.textContent || '')), `card for ${id}`);
    return geometry();
  };
  const assertPlaced = (g, src, label) => {
    assert.equal(g.open, true, `${label}: card open`);
    assert.equal(overlap(g.card, src), 0, `${label}: card does not cover the video it describes (card ${JSON.stringify(g.card)}, video ${JSON.stringify(src)}, screen ${g.viewport}, bar top ${g.bar.top})`);
    assert(g.card.top >= g.head.bottom && g.card.bottom <= g.bar.top + 0.5 && g.card.left >= 0 && g.card.right <= g.viewport[0],
      `${label}: card between header and bar, inside the screen (${JSON.stringify(g.card)})`);
    if (g.player) assert.equal(overlap(g.card, g.player), 0, `${label}: card does not cover the player`);
  };
  try {
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'prompt');
    await click('Practice programming'); await click('Start session');
    await until(() => d.evaluate(p, () => !document.documentElement.hasAttribute('data-curb-locked')), 'session');
    await d.evaluate(p, () => { document.activeElement?.blur(); });
    const options = await d.open(d.extensionUrl('options.html'));
    await until(() => d.evaluate(options, () => !!document.querySelector('#gemini-key')), 'settings');
    assert.equal((await d.evaluate(options, () => (globalThis.browser || chrome).runtime.sendMessage({ type: 'SUMMARY_KEY_ADD', key: 'AQ.Ab8RN6' + 'x'.repeat(48) }))).ok, true);
    await d.closeTab(options); await d.activate(p); await delay(600);

    // 1. Every corner and the middle: beside the source, never on top of it.
    for (const id of ['c11', 'c9', 'c2', 'c0', 'c4']) {
      await d.key(p, 'Escape'); // close the previous card, as a viewer would
      await d.evaluate(p, id => document.getElementById(id).scrollIntoView({ block: 'nearest' }), id);
      const card = await summarize(id);
      assertPlaced(card, await source(id), id);
      if (id === 'c4') await assertNear(card, id);
    }
    console.log(`${name}: PASS card stays off the source in all corners and opens within 24px of the middle title`);

    await d.evaluate(p, () => {
      document.querySelector('ytd-app').style.paddingBottom = '300px';
      window.scrollTo(0, 0);
    });
    await until(async () => { await assertNear(await geometry(), 'c4'); return true; }, 'card settles after scroll');
    const beforeScroll = await geometry();
    await d.evaluate(p, () => window.scrollBy(0, 60));
    await until(async () => (await geometry()).card.top <= beforeScroll.card.top - 40, 'card follows the title on scroll');
    await assertNear(await geometry(), 'c4');
    await d.evaluate(p, () => {
      document.querySelector('ytd-app').style.removeProperty('padding-bottom');
      window.scrollTo(0, 0);
    });
    console.log(`${name}: PASS open card follows the title as the page scrolls`);

    // A right-click preview opened from a thumbnail still anchors the summary to its title.
    await d.key(p, 'Escape');
    await d.evaluate(p, () => {
      const tile = document.querySelector('#c4');
      tile.style.position = 'relative';
      const holder = document.createElement('ytd-thumbnail');
      holder.style.cssText = 'position:absolute;bottom:0;right:0;width:100px;height:40px';
      const thumbnail = document.createElement('a');
      thumbnail.href = tile.querySelector('a.t').href;
      thumbnail.style.cssText = 'display:block;width:100%;height:100%';
      holder.append(thumbnail); tile.append(holder);
      thumbnail.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    await d.click(p, `${root}.querySelector('aside.preview button.summarize')`);
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root').shadowRoot.querySelector('.ai-summary [role=alert]')), 'summary from right-click preview');
    await assertNear(await geometry(), 'c4');
    console.log(`${name}: PASS a summary opened from a thumbnail preview stays close to the video title`);

    // 2. Hover intent: a quick sweep across titles shows no button or thumbnail; resting does.
    await d.key(p, 'Escape');
    await d.hover(p, "document.querySelector('#c1 p')");
    await until(async () => !(await pillOpen()), 'previous hover button clears');
    const sweep = await d.evaluate(p, ids => ids.map(id => {
      const link = document.querySelector(`#${id} a.t`), rect = link.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2), y = Math.round(rect.top + rect.height / 2);
      if (document.elementFromPoint(x, y) !== link) throw new Error(`${id} title is not visible for the pointer sweep`);
      return { x, y };
    }), ['c0', 'c3', 'c6', 'c7', 'c8', 'c5']);
    await d.evaluate(p, () => { window.__popups = 0; const s = document.getElementById('curb-extension-root').shadowRoot;
      new MutationObserver(() => { if (!s.querySelector('.summarize-pill').hidden || !s.querySelector('.thumbnail-preview').hidden) window.__popups++; })
        .observe(s, { subtree: true, attributes: true, attributeFilter: ['hidden'] }); });
    for (const { x, y } of sweep) await d.movePointer(p, x, y);
    await d.hover(p, "document.querySelector('#c1 p')"); await delay(500);
    assert.equal(await d.evaluate(p, () => window.__popups), 0, 'sweeping across titles opens nothing');
    await d.hover(p, "document.querySelector('#c4 a.t')"); await until(pillOpen, 'resting on a title shows the button');
    console.log(`${name}: PASS hover intent: sweeping shows nothing, resting shows the button`);

    // 3. With the card open, no hover popup appears over it (titles beside or partly under it).
    await summarize('c4');
    const near = await d.evaluate(p, () => [...document.querySelectorAll('a.t')].map(a => a.parentElement.id).filter(id => id !== 'c4'));
    let checked = 0;
    for (const id of near) {
      const point = await d.evaluate(p, id => {
        const title = document.querySelector(`#${id} a.t`), rect = title.getBoundingClientRect();
        const y = Math.round(rect.top + rect.height / 2);
        return [0.5, 0.1, 0.9].map(fraction => ({ x: Math.round(rect.left + rect.width * fraction), y }))
          .find(({ x, y }) => document.elementFromPoint(x, y)?.closest('a.t') === title);
      }, id);
      if (!point) continue;
      await d.movePointer(p, point.x, point.y); await delay(450);
      const popups = await d.evaluate(p, () => { const s = document.getElementById('curb-extension-root').shadowRoot, card = s.querySelector('aside.preview').getBoundingClientRect();
        return [s.querySelector('.summarize-pill'), s.querySelector('.thumbnail-preview')].filter(n => !n.hidden).map(n => n.getBoundingClientRect())
          .filter(r => Math.min(r.right, card.right + 16) > Math.max(r.left, card.left - 16) && Math.min(r.bottom, card.bottom + 16) > Math.max(r.top, card.top - 16)).length; });
      assert.equal(popups, 0, `no popup over the card when hovering ${id}`); checked++;
    }
    assert(checked >= 4, `enough titles around the card were checked (${checked})`);
    assert((await geometry()).open, 'the card stays open while hovering around it');
    console.log(`${name}: PASS no hover popup covers the open card (${checked} neighbouring titles checked)`);

    // 4. Resize and phone width: the card stays fully on screen.
    // 900x700: no spot beside the middle video fits the expanded card, so some overlap is unavoidable;
    // the card must stay on screen and cover at most a quarter of the video.
    await d.resize(p, 900, 700); await delay(300);
    const tight = await geometry(), tightSrc = await source('c4');
    assert(tight.card.top >= tight.head.bottom && tight.card.bottom <= tight.bar.top + 0.5 && tight.card.left >= 0 && tight.card.right <= 900, 'after resize: on screen');
    const srcArea = (tightSrc.right - tightSrc.left) * (tightSrc.bottom - tightSrc.top);
    assert(overlap(tight.card, tightSrc) <= srcArea / 4, `after resize: covers at most a quarter of the video (${Math.round(100 * overlap(tight.card, tightSrc) / srcArea)}%)`);
    await d.resize(p, 390, 844); await delay(300);
    await d.evaluate(p, () => document.getElementById('c5').scrollIntoView({ block: 'center' }));
    const narrow = await summarize('c5');
    assert(narrow.card.right - narrow.card.left <= 390 - 16, 'fits a phone-width screen');
    assert(narrow.card.top >= narrow.head.bottom && narrow.card.bottom <= narrow.bar.top + 0.5, 'phone width: between header and bar');
    await assertNear(narrow, 'c5');
    await d.screenshot(p, path.resolve('artifacts/e2e', `${name}-summary-card-narrow.png`));
    await d.resize(p, 1280, 900); await delay(300);
    console.log(`${name}: PASS card stays on screen after resize and within 24px of the title at phone width`);

    // 5. A prompt takes over: the card and button get out of the way.
    await summarize('c2');
    await d.evaluate(p, () => { history.pushState({}, '', '/shorts/abcdefghijk'); document.dispatchEvent(new Event('yt-navigate-finish')); });
    await until(async () => !(await geometry()).open && !(await pillOpen()), 'prompt hides the card and button');
    await d.evaluate(p, () => { history.pushState({}, '', '/results?search_query=fixture'); document.dispatchEvent(new Event('yt-navigate-finish')); });
    console.log(`${name}: PASS a prompt hides the card and button`);

    // 6. Watch page: summarizing a sidebar video never covers the player.
    await d.navigate(p, 'https://www.youtube.com/watch?v=mainvideo01');
    await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('h1')?.textContent === 'Does this video fit your intent?'), 'video check');
    await click('Yes, this fits');
    await until(() => d.evaluate(p, () => !document.documentElement.hasAttribute('data-curb-locked')), 'watch page');
    for (const id of ['c0', 'c3']) {
      await d.key(p, 'Escape');
      const card = await summarize(id);
      assertPlaced(card, await source(id), `watch page ${id}`);
      if (id === 'c3') await assertNear(card, id);
    }
    await d.screenshot(p, path.resolve('artifacts/e2e', `${name}-summary-card-watch.png`));
    console.log(`${name}: PASS watch-page card stays within 24px of the sidebar title when room allows and avoids the player`);
  } finally { await d.close(); }
}
(async () => { for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
