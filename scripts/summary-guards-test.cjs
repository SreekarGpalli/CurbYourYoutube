// 1.0.3 release regressions for the Summarize controls and hover thumbnails, in real browsers:
// - page scripts cannot press Curb's Summarize controls (synthetic clicks are ignored);
// - turning off right-click previews does not close a card opened with the hover Summarize button;
// - the hover button never covers the title it belongs to, even at the right edge;
// - keyboard focus on a title reveals the button and Tab reaches it;
// - a thumbnail that finishes loading after switching to Hidden never appears;
// - (Chromium, mocked Gemini) a verdict for an earlier intent is never shown beside a new intent.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const fixture = `<!doctype html><meta charset="utf-8"><title>Results - YouTube</title>
<style>body{margin:0} a{display:inline-block;margin:24px} #edge-title{position:fixed;right:0;top:60vh;margin:0 !important}</style>
<ytd-app><div id="masthead-container"><form action="/results"><input name="search_query"></form></div>
<ytd-video-renderer id="first"><a id="video-title" href="/watch?v=Js05B8Z1ivE">Python Tutorial for Beginners</a></ytd-video-renderer>
<ytd-video-renderer id="lazy"><ytd-thumbnail><img id="lazy-img" alt=""></ytd-thumbnail><a id="lazy-title" href="/watch?v=lazyvideo01">A lazily loaded thumbnail</a></ytd-video-renderer>
<ytd-video-renderer id="edge"><a id="edge-title" href="/watch?v=edgevideo01">A title that ends at the right edge</a></ytd-video-renderer>
<p id="elsewhere" style="margin:220px 24px">Elsewhere</p></ytd-app>`;
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
async function run(name) {
  await fs.mkdir('artifacts/e2e', { recursive: true });
  const d = await launch(name, fixture, await fs.mkdtemp(path.resolve('artifacts/e2e', `${name}-summary-guards-`)));
  try {
    const p = await d.open('https://www.youtube.com/results?search_query=python');
    const click = text => d.click(p, `[...${root}.querySelectorAll('button')].find(n => n.textContent === ${JSON.stringify(text)})`);
    const pillVisible = () => d.evaluate(p, () => !document.getElementById('curb-extension-root').shadowRoot.querySelector('.summarize-pill').hidden);
    const card = () => d.evaluate(p, () => { const tip = document.getElementById('curb-extension-root').shadowRoot.querySelector('aside.preview'); return { open: !tip.hidden, text: tip.innerText.replace(/\s+/g, ' '), summary: !!tip.querySelector('.ai-summary') }; });
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'intent prompt');
    await click('Practice programming'); await click('Start session');
    await until(() => d.evaluate(p, () => !document.documentElement.hasAttribute('data-curb-locked')), 'session started');
    const options = await d.open(d.extensionUrl('options.html'));
    await until(() => d.evaluate(options, () => !!document.querySelector('#gemini-key')), 'settings ready');
    const send = message => d.evaluate(options, message => (globalThis.browser || chrome).runtime.sendMessage(message), message);
    assert.equal((await send({ type: 'SUMMARY_KEY_ADD', key: 'AQ.Ab8RN6' + 'x'.repeat(48) })).ok, true);
    assert.equal((await send({ type: 'SETTINGS', settings: { thumbnailMode: 'hover', localPreviews: true } })).ok, true);
    await d.activate(p); await d.hover(p, "document.querySelector('#elsewhere')"); await delay(600);

    // 1. Synthetic clicks from the page cannot start a summary.
    await d.hover(p, "document.querySelector('#video-title')");
    await until(pillVisible, 'button beside the title');
    await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.summarize-pill').click());
    await delay(400);
    assert.equal((await card()).open, false, 'a page-script click on the hover button does nothing');
    await d.evaluate(p, () => document.querySelector('#video-title').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await until(async () => (await card()).open, 'right-click preview');
    await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('aside.preview .summarize').click());
    await delay(400);
    assert.equal((await card()).summary, false, 'a page-script click on the card button does nothing');
    await d.key(p, 'Escape');
    console.log(`${name}: PASS synthetic clicks on both Summarize controls are ignored`);

    // 2. A hover-Summarize card survives turning off right-click previews.
    await d.hover(p, "document.querySelector('#elsewhere')"); await delay(500);
    await d.hover(p, "document.querySelector('#video-title')"); await until(pillVisible, 'button again');
    await d.click(p, `${root}.querySelector('.summarize-pill')`);
    await until(async () => (await card()).summary, 'summary card');
    assert.equal((await send({ type: 'SETTINGS', settings: { localPreviews: false } })).ok, true);
    await delay(800);
    assert.equal((await card()).open, true, 'the Summarize card stays open');
    await d.key(p, 'Escape');
    // A right-click card does close when its feature is turned off.
    await send({ type: 'SETTINGS', settings: { localPreviews: true } }); await delay(300);
    await d.evaluate(p, () => document.querySelector('#video-title').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await until(async () => (await card()).open, 'right-click preview again');
    await send({ type: 'SETTINGS', settings: { localPreviews: false } });
    await until(async () => !(await card()).open, 'right-click card closes with its setting');
    await send({ type: 'SETTINGS', settings: { localPreviews: true } });
    console.log(`${name}: PASS right-click toggle closes right-click cards only`);

    // 3. Near the right edge the button never covers its title.
    await d.hover(p, "document.querySelector('#elsewhere')"); await delay(500);
    await d.hover(p, "document.querySelector('#edge-title')"); await delay(500);
    const edge = await d.evaluate(p, () => {
      const pill = document.getElementById('curb-extension-root').shadowRoot.querySelector('.summarize-pill'), a = pill.getBoundingClientRect();
      const b = document.querySelector('#edge-title').getBoundingClientRect();
      return { hidden: pill.hidden, overlap: pill.hidden ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) };
    });
    assert.equal(edge.overlap, 0, `button covers the title (${JSON.stringify(edge)})`);
    console.log(`${name}: PASS right-edge button does not cover its title (${edge.hidden ? 'hidden' : 'placed elsewhere'})`);

    // 4. Keyboard: focusing a title reveals the button; Tab reaches it.
    await d.hover(p, "document.querySelector('#elsewhere')"); await delay(500);
    await d.evaluate(p, () => { document.querySelector('input[name=search_query]').focus(); });
    await d.key(p, 'Tab');
    assert.equal(await d.evaluate(p, () => document.activeElement?.id), 'video-title');
    await until(pillVisible, 'button shown for the focused title');
    await d.key(p, 'Tab');
    const shadowFocus = () => d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.activeElement?.className);
    assert.equal(await shadowFocus(), 'summarize-pill', 'Tab moves onto the button');
    await d.key(p, 'Tab');
    assert.notEqual(await d.evaluate(p, () => document.activeElement?.id), 'video-title', 'Tab then continues past the title');
    await d.evaluate(p, () => document.querySelector('input[name=search_query]').focus());
    await d.key(p, 'Tab'); await until(pillVisible, 'button available for keyboard activation');
    await d.key(p, 'Tab'); await d.key(p, 'Enter');
    await until(async () => (await card()).summary, 'keyboard opens the summary');
    assert.equal(await shadowFocus(), 'preview-close', 'focus enters the card');
    await d.key(p, 'Escape');
    assert.equal((await card()).open, false);
    assert.equal(await d.evaluate(p, () => document.activeElement?.id), 'video-title', 'Escape restores focus to the title');
    console.log(`${name}: PASS keyboard Tab reaches Summarize, Enter opens it, and Escape restores focus`);

    // 5. A thumbnail still loading in Hover mode never appears after switching to Hidden.
    await d.evaluate(p, () => document.activeElement?.blur());
    await d.hover(p, "document.querySelector('#lazy-title')"); await delay(500);
    await send({ type: 'SETTINGS', settings: { thumbnailMode: 'hidden' } }); await delay(400);
    await d.evaluate(p, src => { document.querySelector('#lazy-img').src = src; }, PIXEL);
    await delay(400);
    assert.equal(await d.evaluate(p, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('.thumbnail-preview').hidden), true);
    await send({ type: 'SETTINGS', settings: { thumbnailMode: 'hover' } });
    console.log(`${name}: PASS a late thumbnail stays hidden after switching to Hidden`);

    // 6. Chromium only (mocked Gemini in the worker): an intent edited mid-request drops the old verdict.
    if (name === 'chromium') {
      await d.background(() => {
        chrome.permissions.contains = async () => true;
        globalThis.fetch = () => new Promise(resolve => { globalThis.releaseGemini = answer => {
          delete globalThis.releaseGemini;
          resolve(new Response(JSON.stringify({ output_text: JSON.stringify(answer || {
            verdict: 'Watch it.', fits_intent: 'yes', summary: 'Python basics.', key_points: [] }) }),
          { status: 200, headers: { 'content-type': 'application/json' } }));
        }; });
      });
      await d.activate(p); await d.hover(p, "document.querySelector('#elsewhere')"); await delay(500);
      await d.hover(p, "document.querySelector('#video-title')"); await until(pillVisible, 'button for mocked summary');
      await d.click(p, `${root}.querySelector('.summarize-pill')`);
      await until(() => d.background(() => typeof globalThis.releaseGemini === 'function'), 'request reached the mock');
      const { session } = (await send({ type: 'GET' })).data;
      assert.equal((await send({ type: 'EDIT_INTENT', sessionId: session.id, intent: 'Learn guitar', expectedIntent: session.intent })).ok, true);
      await delay(600);
      await d.background(() => globalThis.releaseGemini());
      await delay(800);
      const after = await card();
      assert.equal(/Fits your intent/.test(after.text), false, `old verdict shown beside the new intent: ${after.text}`);
      assert.match(after.text, /Your intent changed/);
      console.log(`${name}: PASS an intent edited mid-request never shows the earlier verdict`);

      await click('Summarize');
      await until(() => d.background(() => typeof globalThis.releaseGemini === 'function'), 'second request reached the mock');
      await d.background(() => globalThis.releaseGemini({
        verdict: 'Skip if you’re here for guitar.', fits_intent: 'no',
        summary: 'An introduction to Python variables, loops, and lists with short examples.',
        key_points: [{ time: '0:54', point: 'Creates and updates a variable.' }, { time: '2:18', point: 'Loops through a list.' }]
      }));
      await until(async () => (await card()).text.includes('An introduction to Python variables'), 'new summary displayed');
      const summary = await d.evaluate(p, () => {
        const tip = document.getElementById('curb-extension-root').shadowRoot.querySelector('aside.preview');
        return { text: tip.innerText, previewHidden: !tip.querySelector('.preview-detail').getClientRects().length,
          time: tip.querySelector('.ai-summary a')?.href };
      });
      assert(summary.previewHidden);
      assert.match(summary.text, /First 5 minutes/);
      assert.match(summary.text, /Does not fit your intent/);
      assert.doesNotMatch(summary.text, /Gemini 3\.|saved earlier|backup key|Your intent changed/);
      assert.equal(summary.time, 'https://www.youtube.com/watch?v=Js05B8Z1ivE&t=54s');
      await p.locator('#curb-extension-root aside.preview').screenshot({ path: path.resolve('artifacts/e2e/chromium-gemini-summary.png') });
      console.log(`${name}: PASS summary shows intent fit, clip scope, and timestamp links in a compact card`);
    }
    await d.screenshot(p, path.resolve('artifacts/e2e', `${name}-summary-guards.png`));
  } finally { await d.close(); }
}
(async () => { for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
