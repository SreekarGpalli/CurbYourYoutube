const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { launch, until } = require('../tests/e2e-driver.cjs');
const fixture = '<!doctype html><meta charset="utf-8"><ytd-app><form action="/results"><input name="search_query"></form></ytd-app>';
const root = 'document.getElementById("curb-extension-root").shadowRoot';
(async () => {
 for (const browser of ['chromium', 'firefox']) {
  const d = await launch(browser, fixture, await fs.mkdtemp(`artifacts/e2e/${browser}-submission-`));
  try {
   let options;
   const send = (type, extra = {}) => d.evaluate(options, message => (globalThis.browser || chrome).runtime.sendMessage(message), {type,...extra});
   const searches = () => d.requests.filter(url => new URL(url).hostname.endsWith('youtube.com') && new URL(url).pathname === '/results');
   for (const path of ['/', '/feed/subscriptions', '/watch?v=lesson', '/results?search_query=existing']) {
    if (options) { assert((await send('RESET')).ok); }
    const entryStart = searches().length;
    const p = await d.open('https://www.youtube.com' + path);
    const click = text => d.click(p, `[...${root}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`);
    const input = `${root}.querySelector('#curb-intent')`;
    const ready = () => until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'intent form');
    await ready();
    if (!options) {
     options = await d.open(d.extensionUrl('options.html'));
     await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'settings ready');
    }
    await send('SETTINGS', {settings:{redirectSubscriptions:true}});
    await d.activate(p);
    await d.navigate(p, await d.url(p)); await ready();
    let before = searches().length;
    await click('Follow a course'); await click('Practice programming');
    await d.evaluate(p, () => new Promise(resolve => setTimeout(resolve, 2200)));
    assert.deepEqual(searches().slice(entryStart).map(url => new URL(url).searchParams.get('search_query')),
     path.startsWith('/results') ? ['existing', 'existing'] : [], 'record from before opening: only explicitly opened results URLs may search');
    assert.equal(searches().length, before, 'opening/reloading/selecting presets must not request search results');
    assert.equal(await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').value), '');
    await d.fill(p, input, 'Python'); await click('Start session');
    // Typed text goes into YouTube's own search box so YouTube can suggest searches; nothing is submitted.
    // From a video page the session's video check covers the page, so the search box opens on the homepage.
    await until(() => d.evaluate(p, () => document.activeElement?.name === 'search_query' && document.activeElement.value === 'Python'), 'typed text handed to native search');
    await d.evaluate(p, () => new Promise(resolve => setTimeout(resolve, 2200)));
    assert.deepEqual(searches().slice(before), [], 'starting a session never submits a search by itself');
    await d.key(p, 'Enter');
    await until(async () => new URL(await d.url(p)).searchParams.get('search_query') === 'Python', 'user-submitted query');
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.bar')), 'search ready');
    assert.deepEqual(searches().slice(before).map(url => new URL(url).searchParams.get('search_query')), ['Python'], 'exactly one request, only when the user submits, never a preset query first');
    const current = (await send('GET')).data.session;
    assert((await send('START', {intent:'Work through my course, lectures and study material', expectedId:current.id})).ok);
    await d.activate(p); await click('Edit intent'); await ready();
    assert.equal(await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').value), '', 'previous session text is not a new search query');
    before = searches().length;
    await click('Practice programming'); await click('Start session');
    await until(async () => (await send('GET')).data.session.intent === 'Practice programming', 'preset-only session');
    await d.evaluate(p, () => new Promise(resolve => setTimeout(resolve, 2200)));
    assert.equal(searches().length, before, 'starting an intent without typing never searches the previous session');
    const presetSession = (await send('GET')).data.session;
    assert((await send('START', {intent:'Work through my course, lectures and study material', expectedId:presetSession.id})).ok);
    before = searches().length;
    await d.navigate(p, 'https://www.youtube.com/feed/subscriptions');
    await until(async () => await d.url(p) === 'https://www.youtube.com/', 'legacy session subscription redirect goes only Home');
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.bar')), 'redirected Home loaded before reload');
    await d.navigate(p, 'https://www.youtube.com/');
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.bar')), 'home reload ready');
    await d.evaluate(p, () => new Promise(resolve => setTimeout(resolve, 2200)));
    assert.equal(searches().length, before, 'Home, reload and restored legacy intent must never request results');
    await d.closeTab(p);
    console.log(`${browser}: PASS ${path}: recorded before open; submit = Python only; restored course + subscriptions + Home + reload = zero searches`);
   }
   const before = searches().length;
   const popup = await d.open(new URL('popup.html', await d.url(options)).href);
   await until(() => d.evaluate(popup, () => [...document.querySelectorAll('button')].some(n => n.textContent === 'Open YouTube')), 'popup ready');
   const previousTabs = await d.tabs();
   await d.click(popup, "[...document.querySelectorAll('button')].find(n=>n.textContent==='Open YouTube')");
   const home = await until(async () => (await d.tabs()).find(tab => !previousTabs.includes(tab)), 'popup opened Home');
   await until(async () => await d.url(home) === 'https://www.youtube.com/', 'popup Home URL');
   await d.evaluate(home, () => new Promise(resolve => setTimeout(resolve, 2200)));
   assert.equal(searches().length, before, 'popup Open YouTube never searches an intent');
   console.log(`${browser}: PASS popup Open YouTube = bare homepage, zero searches`);
   const current = (await send('GET')).data.session;
   assert((await send('START', {intent:'Follow a course', expectedId:current?.id || null})).ok);
   await d.background(async () => { state.session.breakDue = true; await persist(); });
   await d.navigate(home, 'https://www.youtube.com/feed/subscriptions');
   await until(() => d.evaluate(home, () => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.card h1')?.textContent === 'Keep watching?'), 'break gate on subscriptions');
   assert.equal(new URL(await d.url(home)).pathname, '/feed/subscriptions', 'break gate waits before redirect');
   await d.click(home, `[...${root}.querySelectorAll('button')].find(n=>n.textContent==='Continue for 30 min')`);
   await until(async () => await d.url(home) === 'https://www.youtube.com/', 'resuming break releases subscription route to Home');
   await until(() => d.evaluate(home, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.bar')), 'resumed Home loaded');
   assert.equal(searches().length, before, 'resuming a break never searches an intent');
   console.log(`${browser}: PASS break resume on subscriptions = Home, zero searches`);
   await d.settleRequests();
   assert.deepEqual(d.errors, []);
   if (d.cancelledRequests.length) console.log(`${browser}: confirmed browser cancellations: ${JSON.stringify(d.cancelledRequests)}`);
  } finally { await d.close(); }
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
