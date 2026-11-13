// Real UI navigation journeys; fixture routes simulate YouTube SPA events only.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const out = path.resolve('artifacts/e2e');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const fixture = `<!doctype html><title>Python lesson - YouTube</title>
<style>body{margin:0;color:white}ytd-app,ytd-search,ytd-watch-metadata,ytd-browse{display:block;padding:24px}a{display:block;color:white;margin:20px}</style>
<ytd-app>${require('../tests/native-search-fixture.cjs')}
<a id="native-home" href="/">YouTube Home</a>
<ytd-browse page-subtype="home"><div id="contents"><a href="/watch?v=one">Curated recommendation</a></div></ytd-browse>
<ytd-search><a id="result" href="/watch?v=one">Python lesson</a><a id="next" href="/watch?v=two">Bollywood song</a>
<a id="spa-search" href="/results?search_query=updated+question">Native SPA search</a><a id="spa-back" href="#">Native history back</a></ytd-search>
<ytd-watch-metadata><h1>Python lesson</h1></ytd-watch-metadata>
</ytd-app><script>
document.getElementById('spa-search').onclick=function(e){e.preventDefault();history.pushState({},'',this.href);document.dispatchEvent(new Event('yt-navigate-finish'));};
document.getElementById('spa-back').onclick=function(e){e.preventDefault();history.back();};
</script>`;
async function run(name) {
  const profile = await fs.mkdtemp(path.join(out, `${name}-navigation-`));
  let d, p, options;
  const click = text => d.click(p, `[...${root}.querySelectorAll('button,a')].find(n=>n.textContent===${JSON.stringify(text)})`);
  const heading = text => until(() => d.evaluate(p, text => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.card h1')?.textContent === text, text), text);
  const unlocked = () => until(() => d.evaluate(p, () => document.documentElement.hasAttribute('data-curb-ready') && !document.documentElement.hasAttribute('data-curb-locked') && !document.querySelector('ytd-app').inert), 'visible unlocked native page');
  const get = async () => (await d.evaluate(options, () => (globalThis.browser || chrome).runtime.sendMessage({ type: 'GET' }))).data;
  const step = async (label, fn) => { await fn(); console.log(`${name}-navigation: PASS ${label}`); };
  try {
    d = await launch(name, fixture, profile);
    p = await d.open('https://www.youtube.com/'); await d.activate(p);
    await heading('What brings you to YouTube?');
    options = await d.open(d.extensionUrl('options.html'));
    await d.activate(p);
    await step('Initial prompt has no replacement search and does not create a session', async () => {
      assert.equal(await d.evaluate(p, () => !!document.getElementById('curb-extension-root').shadowRoot.querySelector('input[type=search]')), false);
      assert.equal((await get()).session, null);
    });
    await step('Just browse opens homepage then native search opens usable results', async () => {
      await click('Just browse'); await unlocked();
      assert.equal(new URL(await d.url(p)).pathname, '/');
      assert((await get()).browseRemainingMs > 0);
      await d.fill(p, "document.querySelector('[name=search_query]')", 'Bollywood & music?'); await d.key(p, 'Enter');
      await until(async () => new URL(await d.url(p)).searchParams.get('search_query') === 'Bollywood & music?', 'initial query navigation');
      await unlocked(); assert.equal((await get()).session.mode, 'browse');
      await d.click(p, 'document.querySelector("#result")');
      await until(async () => new URL(await d.url(p)).searchParams.get('v') === 'one', 'result opens'); await unlocked();
    });
    await step('Native Home retains the casual session; its browse time covers the homepage without a second timer', async () => {
      const id = (await get()).session.id; await d.click(p, 'document.querySelector("#native-home")');
      await until(async () => new URL(await d.url(p)).pathname === '/', 'Home route'); await unlocked();
      assert.equal((await get()).session.id, id);
      await until(() => d.evaluate(p, () => getComputedStyle(document.querySelector('ytd-browse #contents')).display !== 'none'), 'homepage revealed');
      assert.equal(await d.evaluate(p, () => !!document.getElementById('curb-extension-root').shadowRoot.querySelector('[data-home-time]')), false, 'no separate homepage countdown');
      assert.equal((await get()).homeRemainingMs, 0);
      assert.equal(await d.evaluate(p, () => [...document.getElementById('curb-extension-root').shadowRoot.querySelectorAll('.bar button')].map(n => n.textContent).join('|')), 'Set intent|Finish', 'dock holds only Set intent and Finish');
      assert.equal(new URL(await d.url(p)).pathname, '/');
    });
    await step('Focused intent accepts unrelated searches and Home from a video gate', async () => {
      await click('Set intent'); await click('Practice programming'); await click('Start session'); await unlocked();
      assert.equal((await get()).session.mode, 'focus');
      await d.fill(p, "document.querySelector('[name=search_query]')", 'song'); await d.key(p, 'Enter'); await unlocked();
      await until(async () => new URL(await d.url(p)).searchParams.get('search_query') === 'song', 'unrelated search destination'); await unlocked();
      await d.click(p, 'document.querySelector("#next")'); await heading('Does this video fit your intent?');
      await click('Search instead'); await until(async () => new URL(await d.url(p)).pathname === '/', 'Search instead returns Home from alignment gate'); await unlocked();
    });
    await step('Just browse from Edit intent preserves main intent and timers; Resume intent restores focus', async () => {
      const before = (await get()).session; await click('Edit intent'); await heading('What brings you to YouTube?'); await click('Just browse');
      await until(async () => (await get()).session.mode === 'browse', 'browse mode');
      const during = (await get()).session; assert.equal(during.id, before.id); assert.equal(during.intent, before.intent); assert(during.totalMs >= before.totalMs);
      await delay(2500); const baseline = (await get()).session.intentMs; await delay(2500);
      assert.equal((await get()).session.intentMs, baseline);
      await click('Resume intent'); await until(async () => (await get()).session.mode === 'focus', 'focus resumed');
      assert.equal((await get()).session.id, before.id);
    });
    await step('One-video detour pauses intent time and next video asks again', async () => {
      await d.navigate(p, 'https://www.youtube.com/watch?v=one'); await heading('Does this video fit your intent?');
      await click('Watch as a detour'); await unlocked();
      await delay(2500); const before = (await get()).session.intentMs; await delay(2500); assert.equal((await get()).session.intentMs, before);
      await d.click(p, 'document.querySelector("#next")'); await heading('Does this video fit your intent?');
      await click('Edit intent'); await click('Keep current intent'); await heading('Does this video fit your intent?');
      await click('Search instead');
      await until(async () => new URL(await d.url(p)).pathname === '/', 'search instead returns Home'); await unlocked();
      await d.fill(p, "document.querySelector('[name=search_query]')", 'original query'); await d.key(p, 'Enter'); await unlocked();
      await until(async () => new URL(await d.url(p)).searchParams.get('search_query') === 'original query', 'search destination'); await unlocked();
    });
    await step('Editing draft survives settings updates without losing typed intent', async () => {
      await click('Edit intent'); await heading('What brings you to YouTube?');
      await d.fill(p, `${root}.querySelector('#curb-intent')`, 'Keep this unfinished custom intention');
      await d.click(options, 'document.querySelector("[data-setting=fullscreenPill]")');
      await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent')?.value === 'Keep this unfinished custom intention'), 'draft retained');
      await d.click(options, 'document.querySelector("[data-setting=fullscreenPill]")');
      await d.activate(p); await click('Keep current intent'); await unlocked();
    });
    await step('Native SPA searches and browser Back synchronize header query', async () => {
      await d.click(p, 'document.querySelector("#spa-search")');
      await until(() => d.evaluate(p, () => document.querySelector('[name=search_query]').value === 'updated question'), 'SPA query sync');
      await d.click(p, 'document.querySelector("#spa-back")');
      await until(() => d.evaluate(p, () => document.querySelector('[name=search_query]').value === 'original query'), 'Back query sync'); await unlocked();
    });
    await step('A conflicting intent change in another tab preserves the draft and allows a deliberate retry', async () => {
      await click('Edit intent'); await heading('What brings you to YouTube?');
      await d.fill(p, `${root}.querySelector('#curb-intent')`, 'Keep my draft after a conflict');
      const other = await d.open('https://www.youtube.com/');
      const otherClick = text => d.click(other, `[...${root}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`);
      await until(() => d.evaluate(other, () => [...document.getElementById('curb-extension-root')?.shadowRoot.querySelectorAll('button') || []].some(n => n.textContent === 'Edit intent')), 'other tab ready');
      await otherClick('Edit intent'); await d.fill(other, `${root}.querySelector('#curb-intent')`, 'Different intention in another tab'); await otherClick('Start session');
      await until(async () => (await get()).session.intent === 'Different intention in another tab', 'other intent saved');
      await d.activate(p); await click('Start session');
      await until(() => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('[role="alert"]')?.textContent.includes('session changed')), 'conflict explained');
      assert.equal(await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').value), 'Keep my draft after a conflict');
      await click('Start session'); await unlocked();
      assert.equal((await get()).session.intent, 'Keep my draft after a conflict');
      await d.closeTab(other);
    });
    await step('Shorts search returns Home; finished session keeps native page locked', async () => {
      await d.navigate(p, 'https://www.youtube.com/shorts/test'); await heading('Shorts are hidden');
      await click('Search YouTube');
      await until(async () => new URL(await d.url(p)).pathname === '/', 'Shorts search returns home'); await unlocked();
      await click('Finish'); await heading('Session finished');
      assert.equal(await d.evaluate(p, () => document.querySelector('ytd-app').inert), true);
      assert.equal(await d.evaluate(p, () => !!document.getElementById('curb-extension-root').shadowRoot.querySelector('input[type=search]')), false);
      await d.screenshot(p, path.join(out, `${name}-navigation-stopped.png`));
    });
    await step('Just browse starts intentionally on the timed homepage', async () => {
      await click('Set intent'); await heading('What brings you to YouTube?'); await click('Just browse'); await unlocked();
      const state = await get(); assert.equal(state.session.mode, 'browse'); assert.equal(state.session.intent, 'Just browsing');
      assert.equal(new URL(await d.url(p)).pathname, '/'); assert(state.browseRemainingMs > 0);
    });
    assert.deepEqual(d.errors, [], 'browser JavaScript errors');
  } finally { await d?.close(); }
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const names = process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox'];
  for (const name of names) { assert(['chromium', 'firefox'].includes(name), `Unknown browser: ${name}`); await run(name); }
})().catch(error => { console.error(error); process.exitCode = 1; });
