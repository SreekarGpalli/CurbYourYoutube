// Native search contract: actual unpacked extension; --live uses signed-out YouTube.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until } = require('../tests/e2e-driver.cjs');
const out = path.resolve('artifacts/e2e');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const searchSelector = '[name="search_query"], input#search';
const fixture = `<!doctype html><title>Native YouTube search fixture</title>
<style>
body{margin:0;background:#111;color:white}ytd-app,ytd-browse,ytd-search{display:block}
#masthead-container,ytm-mobile-topbar-renderer{position:fixed;top:0;left:0;right:0;z-index:20;transform:translateZ(0)}
ytm-mobile-topbar-renderer{z-index:4}ytd-masthead,yt-searchbox{display:block}
ytd-masthead{height:56px;background:#333}yt-searchbox{width:min(640px,95vw);margin:auto}
input,textarea,button{padding:10px}textarea{vertical-align:middle}ytd-browse,ytd-search{padding:90px 24px}a{color:white}
#movie_player{position:absolute;top:56px;left:0;width:100%;height:70vh;background:#000}
.ytSearchboxComponentSuggestionsContainer{position:absolute;z-index:2010;top:56px;width:inherit;background:#444}
[role=option]{display:block;width:100%;height:48px;text-align:left}[hidden]{display:none!important}
</style>
<ytd-app><div id="masthead-container"><ytd-masthead><yt-searchbox><form action="/results"><textarea id="search" name="search_query" aria-label="Search" rows="1"></textarea><button>Search</button></form>
<div class="ytSearchboxComponentSuggestionsContainer" role="listbox" hidden>${Array.from({ length: 5 }, (_, index) => `<button type="button" role="option">${index ? `Recent search ${index}` : 'Bollywood songs latest'}</button>`).join('')}</div></yt-searchbox></ytd-masthead></div>
<ytd-browse page-subtype="home"><div id="contents"><a href="/watch?v=one">Curated homepage recommendation</a></div></ytd-browse>
<ytd-search><a id="native-result" href="/watch?v=one">Native result</a></ytd-search><div id="movie_player" hidden></div><ytd-watch-metadata><h1>Native video</h1></ytd-watch-metadata></ytd-app>
<script>
const desktop = document.querySelector('#masthead-container');
if (location.hostname === 'm.youtube.com') {
  const mobile = document.createElement('ytm-mobile-topbar-renderer');
  mobile.append(...desktop.children);
  desktop.replaceWith(mobile);
}
const input = document.querySelector('textarea');
const suggestions = document.querySelector('[role=listbox]');
const first = suggestions.firstElementChild;
input.value = new URL(location.href).searchParams.get('search_query') || '';
for (const event of ['click', 'input']) input.addEventListener(event, () => { suggestions.hidden = false; });
input.addEventListener('keydown', event => {
  if (event.key === 'Escape') suggestions.hidden = true;
  if (event.key === 'ArrowDown' && !suggestions.hidden) {
    event.preventDefault();
    input.value = first.textContent;
    first.setAttribute('aria-selected', 'true');
  }
  if (event.key === 'Enter') { event.preventDefault(); input.form.requestSubmit(); }
});
suggestions.onclick = event => {
  if (!event.isTrusted || event.target.getAttribute('role') !== 'option') return;
  input.value = event.target.textContent;
  input.form.requestSubmit();
};
document.querySelector('ytd-browse').hidden = location.pathname !== '/';
document.querySelector('ytd-search').hidden = location.pathname !== '/results';
document.querySelector('#movie_player').hidden = location.pathname !== '/watch';
document.querySelector('ytd-watch-metadata').hidden = location.pathname !== '/watch';
</script>`;

async function run(name, live) {
  const label = `${name}-native-search${live ? '-live' : ''}`;
  const profile = await fs.mkdtemp(path.join(out, `${label}-`));
  let d, p, options;
  const click = (text, page = p, scope = root) => d.click(page, `[...${scope}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`);
  const heading = text => until(() => d.evaluate(p, text => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.card h1')?.textContent === text, text), text, 30000);
  const unlocked = () => until(() => d.evaluate(p, () => document.documentElement.hasAttribute('data-curb-ready') && !document.documentElement.hasAttribute('data-curb-locked') && !document.querySelector('ytd-app')?.inert), 'native app unlocked', 30000);
  const get = async () => (await d.evaluate(options, () => (globalThis.browser || chrome).runtime.sendMessage({ type: 'GET' }))).data;
  const step = async (title, fn) => { await fn(); console.log(`${label}: PASS ${title}`); };
  const home = async () => {
    await until(async () => { const u = new URL(await d.url(p)); return u.pathname === '/' && !u.search; }, 'bare homepage, no generated query', 30000);
    await unlocked();
    await until(() => d.evaluate(p, () => !document.documentElement.hasAttribute('data-curb-hide-home')), 'timed homepage revealed');
    const state = await get(); assert.equal(state.session.mode, 'browse'); assert(state.browseRemainingMs > 0 && state.browseRemainingMs <= 300000); assert.equal(state.homeRemainingMs, 0);
  };
  try {
    d = await launch(name, live ? null : fixture, profile);
    p = await d.open('https://www.youtube.com/'); await heading('What brings you to YouTube?');
    await step('Initial intent gate has no replacement search and native app is inaccessible', async () => {
      assert.equal(await d.evaluate(p, () => !!document.getElementById('curb-extension-root').shadowRoot.querySelector('input[type=search],form[role=search],#curb-search')), false);
      await until(() => d.evaluate(p, () => { const app = document.querySelector('ytd-app'); return app?.inert && getComputedStyle(app).visibility === 'hidden'; }), 'native app hidden and inert');
      options = await d.open(d.extensionUrl('options.html'));
      await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'settings loaded'); await d.activate(p);
    });
    await step('Just browse opens timed actual homepage without an intent search', async () => {
      await click('Just browse'); await home();
      assert.equal((await get()).session.intent, 'Just browsing');
      await until(() => d.evaluate(p, () => { const feed = document.querySelector('ytd-browse[page-subtype="home"]'); return feed && getComputedStyle(feed).visibility !== 'hidden' && getComputedStyle(feed).display !== 'none'; }), 'native homepage visible', 30000);
      await d.screenshot(p, path.join(out, `${label}-home.png`));
    });
    await step('Native autocomplete remains interactive and selected query opens usable results', async () => {
      await until(() => d.evaluate(p, selector => { const n = document.querySelector(selector); return n && n.getBoundingClientRect().height > 0; }, searchSelector), 'native search input', 30000);
      assert(await d.evaluate(p, selector => {
        const n = document.querySelector(selector), r = n.getBoundingClientRect();
        const bar = document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.top >= 0 && r.bottom <= bar.top && (hit === n || n.contains(hit));
      }, searchSelector), 'native search is above session dock, inside viewport, and unobstructed');
      await d.click(p, `document.querySelector(${JSON.stringify(searchSelector)})`);
      await d.fill(p, `document.querySelector(${JSON.stringify(searchSelector)})`, 'Bollywood songs');
      await until(() => d.evaluate(p, () => [...document.querySelectorAll('[role="option"],.sbsb_c,.ytSuggestionComponentSuggestion,.ytSearchboxComponentSuggestion')].some(n => n.getBoundingClientRect().height > 0 && getComputedStyle(n).visibility !== 'hidden')), 'native suggestions visible', 30000);
      await d.screenshot(p, path.join(out, `${label}-suggestions.png`));
      await d.key(p, 'ArrowDown');
      const selected = await d.evaluate(p, selector => document.querySelector(selector).value, searchSelector);
      assert(selected.toLowerCase().includes('bollywood'), 'native selected query retains typed topic');
      if (!live) assert.equal(selected, 'Bollywood songs latest');
      await d.key(p, 'Enter');
      await until(async () => { const u = new URL(await d.url(p)); return u.pathname === '/results' && u.searchParams.get('search_query') === selected; }, 'selected native query navigation', 30000);
      await unlocked();
      await until(() => d.evaluate(p, () => [...document.querySelectorAll('ytd-search a[href*="/watch?"]')].some(n => n.getBoundingClientRect().height > 0)), 'visible usable result links', 30000);
      assert.equal((await get()).session.intent, 'Just browsing');
    });
    for (const url of ['https://www.youtube.com/results?search_query=unrelated+question', 'https://www.youtube.com/watch?v=jfKfPfyJRdk']) {
      await step(`Just browse from ${new URL(url).pathname} returns to bare timed homepage`, async () => {
        await click('Finish'); await heading('Session finished'); await d.navigate(p, url); await heading('Session finished');
        await click('Set intent'); await heading('What brings you to YouTube?');
        await click('Just browse'); await home();
      });
    }
    if (!live) await step('Native search history paints above the homepage controls and watch pill', async () => {
      await click('Set intent');
      await heading('What brings you to YouTube?');
      await click('Practice programming');
      await click('Start session');
      await unlocked();
      for (const scenario of [
        { url: 'https://www.youtube.com/', overlay: '.home button', shot: 'home' },
        { url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', overlay: '.fullscreen-pill', shot: 'watch' },
        { url: 'https://m.youtube.com/', overlay: '.home button', shot: 'mobile', width: 390 }
      ]) {
        if (scenario.width) await d.resize(p, scenario.width, 844);
        await d.navigate(p, scenario.url);
        if (scenario.shot === 'watch') {
          await heading('Does this video fit your intent?');
          await click('Yes, this fits');
        }
        await unlocked();
        await until(() => d.evaluate(p, selector => document.querySelector('#curb-extension-root').shadowRoot.querySelector(selector)?.getClientRects().length, scenario.overlay), 'overlay visible');
        const headerLayer = () => d.evaluate(p, () => getComputedStyle(document.querySelector('#masthead-container, ytm-mobile-topbar-renderer')).zIndex);
        const idleLayer = await headerLayer();
        await d.click(p, 'document.querySelector("[name=search_query]")');
        const option = await d.evaluate(p, selector => {
          const overlay = document.querySelector('#curb-extension-root').shadowRoot.querySelector(selector);
          const r = overlay.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          const rows = [...document.querySelectorAll('[role=option]')];
          const index = rows.findIndex(row => {
            const rect = row.getBoundingClientRect();
            return rect.left < x && x < rect.right && rect.top < y && y < rect.bottom;
          });
          // Include the noninteractive watch pill in hit-testing to check its paint order.
          overlay.style.pointerEvents = 'auto';
          const hit = document.elementFromPoint(x, y);
          overlay.style.removeProperty('pointer-events');
          return { index, query: rows[index]?.textContent, onTop: rows[index]?.contains(hit), emptyQuery: !document.querySelector('textarea').value };
        }, scenario.overlay);
        assert(option.index >= 0 && option.emptyQuery, `${scenario.shot}: empty history overlaps the Curb overlay`);
        assert(option.onTop, `${scenario.shot}: native history is above the Curb overlay`);
        await d.screenshot(p, path.join(out, `${label}-${scenario.shot}-history.png`));
        await d.key(p, 'Escape');
        assert(await d.evaluate(p, () => document.querySelector('[role=listbox]').hidden));
        assert.equal(await headerLayer(), idleLayer, `${scenario.shot}: closing native history restores the header layer`);
        await d.click(p, 'document.querySelector("[name=search_query]")');
        await d.click(p, `document.querySelectorAll('[role=option]')[${option.index}]`);
        await until(async () => {
          const url = new URL(await d.url(p));
          return url.pathname === '/results' && url.searchParams.get('search_query') === option.query;
        }, 'native history click opens the selected results');
      }
    });
    if (!live) assert.deepEqual(d.errors, [], 'fixture JavaScript errors');
  } catch (error) {
    if (d && p) await d.screenshot(p, path.join(out, `${label}-failure.png`)).catch(() => {});
    throw error;
  } finally { await d?.close(); }
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const args = process.argv.slice(2), live = args.includes('--live');
  const names = args.filter(arg => arg !== '--live');
  for (const name of names.length ? names : ['chromium', 'firefox']) { assert(['chromium', 'firefox'].includes(name), `Unknown browser: ${name}`); await run(name, live); }
})().catch(error => { console.error(error); process.exitCode = 1; });
