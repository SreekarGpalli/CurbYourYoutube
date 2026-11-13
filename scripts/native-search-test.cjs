// Native search contract: actual unpacked extension; --live uses signed-out YouTube.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until } = require('../tests/e2e-driver.cjs');
const out = path.resolve('artifacts/e2e');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const searchSelector = 'input[name="search_query"], input#search';
const fixture = `<!doctype html><title>Native YouTube search fixture</title>
<style>body{margin:0;background:#111;color:white}ytd-app,ytd-browse,ytd-search{display:block}#masthead-container{position:fixed;left:0;right:0;z-index:20}ytd-masthead{position:relative;display:block;height:56px;background:#333;z-index:20}input,button{padding:10px}ytd-browse,ytd-search{padding:90px 24px}a{color:white}.suggestions{background:#444;padding:12px} [hidden]{display:none!important}</style>
<ytd-app><div id="masthead-container"><ytd-masthead><ytd-searchbox><form action="/results"><input id="search" name="search_query" aria-label="Search"><button>Search</button></form><div class="suggestions" role="listbox" hidden><div role="option">Bollywood songs latest</div></div></ytd-searchbox></ytd-masthead></div>
<ytd-browse page-subtype="home"><div id="contents"><a href="/watch?v=one">Curated homepage recommendation</a></div></ytd-browse>
<ytd-search><a id="native-result" href="/watch?v=one">Native result</a></ytd-search><ytd-watch-metadata><h1>Native video</h1></ytd-watch-metadata></ytd-app>
<script>const input=document.querySelector('input');const suggestions=document.querySelector('.suggestions');input.value=new URL(location.href).searchParams.get('search_query')||'';input.addEventListener('input',()=>{suggestions.hidden=!input.value;});input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!suggestions.hidden){e.preventDefault();input.value=suggestions.textContent.trim();suggestions.querySelector('[role=option]').setAttribute('aria-selected','true');}});suggestions.onclick=()=>{input.value=suggestions.textContent.trim();document.querySelector('form').requestSubmit();};document.querySelector('ytd-browse').hidden=location.pathname!=='/';document.querySelector('ytd-search').hidden=location.pathname!=='/results';</script>`;

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
