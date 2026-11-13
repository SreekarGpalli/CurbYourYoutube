// The hover Summarize button: hidden without a Gemini key; with one, hovering a title shows it and
// one click opens Curb's card and starts the summary (no browser menu involved). No real network:
// the fixture profile never grants the Gemini permission, so the request stops with an explanation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const fixture = `<!doctype html><meta charset="utf-8"><title>Results - YouTube</title><style>a{display:inline-block;margin:24px}</style>
<ytd-app><div id="masthead-container"><form action="/results"><input name="search_query"></form></div>
<ytd-video-renderer><a id="video-title" href="/watch?v=Js05B8Z1ivE">Python Tutorial for Beginners</a></ytd-video-renderer>
<ytd-video-renderer><a id="short-title" href="/shorts/abcdefghijk">A Short</a></ytd-video-renderer>
<p id="elsewhere" style="margin:120px 24px">Elsewhere</p></ytd-app>`;
const root = 'document.getElementById("curb-extension-root").shadowRoot';
async function run(name) {
  await fs.mkdir('artifacts/e2e', { recursive: true });
  const d = await launch(name, fixture, await fs.mkdtemp(path.resolve('artifacts/e2e', `${name}-summary-pill-`)));
  try {
    const p = await d.open('https://www.youtube.com/results?search_query=python');
    const click = text => d.click(p, `[...${root}.querySelectorAll('button')].find(n => n.textContent === ${JSON.stringify(text)})`);
    const pillVisible = () => d.evaluate(p, () => !document.getElementById('curb-extension-root').shadowRoot.querySelector('.summarize-pill').hidden);
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'intent prompt');
    await click('Practice programming'); await click('Start session');
    await until(() => d.evaluate(p, () => !document.documentElement.hasAttribute('data-curb-locked')), 'session started');

    await d.hover(p, "document.querySelector('#video-title')"); await delay(400);
    assert.equal(await pillVisible(), false, 'no Gemini key: no button');

    const options = await d.open(d.extensionUrl('options.html'));
    await until(() => d.evaluate(options, () => !!document.querySelector('#gemini-key')), 'settings ready');
    const added = await d.evaluate(options, async () => (globalThis.browser || chrome).runtime.sendMessage({ type: 'SUMMARY_KEY_ADD', key: 'AQ.Ab8RN6' + 'x'.repeat(48) }));
    assert.equal(added.ok, true);
    await d.activate(p);
    await d.hover(p, "document.querySelector('#elsewhere')");
    await delay(600); // the key reaches open tabs through Curb's state broadcast

    // Shorts are normally hidden altogether; show them to check they still get no button.
    const setShorts = value => d.evaluate(options, async value => (globalThis.browser || chrome).runtime.sendMessage({ type: 'SETTINGS', settings: { hideShorts: value } }), value);
    await setShorts(false); await d.activate(p);
    await until(() => d.evaluate(p, () => document.querySelector('#short-title').getClientRects().length > 0), 'Short visible');
    await d.hover(p, "document.querySelector('#short-title')"); await delay(400);
    assert.equal(await pillVisible(), false, 'Shorts get no button');
    await setShorts(true); await d.activate(p);

    await d.hover(p, "document.querySelector('#video-title')");
    await until(pillVisible, 'button appears beside the hovered title');
    const placement = await d.evaluate(p, () => {
      const pill = document.getElementById('curb-extension-root').shadowRoot.querySelector('.summarize-pill').getBoundingClientRect();
      const title = document.querySelector('#video-title').getBoundingClientRect();
      return { besideTitle: pill.left >= title.right && pill.left - title.right < 40 && Math.abs(pill.top - title.top) < 30, inViewport: pill.right <= innerWidth && pill.bottom <= innerHeight };
    });
    assert.deepEqual(placement, { besideTitle: true, inViewport: true });

    await d.click(p, `${root}.querySelector('.summarize-pill')`);
    await until(() => d.evaluate(p, () => {
      const tip = document.getElementById('curb-extension-root').shadowRoot.querySelector('aside.preview');
      return !tip.hidden && tip.querySelector('b')?.textContent === 'Python Tutorial for Beginners' && /Allow Curb to contact Google in Settings/.test(tip.querySelector('.ai-summary [role=alert]')?.textContent || '');
    }), 'one click opens the card and starts the summary');
    assert.equal(await pillVisible(), false, 'button hides after use');
    await d.click(p, `${root}.querySelector('.ai-summary button')`);
    const settings = await until(async () => {
      for (const tab of await d.tabs()) if (await d.url(tab) === d.extensionUrl('options.html#summaries')) return tab;
    }, 'summary setup opens directly');
    await until(() => d.evaluate(settings, () => document.querySelector('.nav a[aria-current]')?.hash === '#summaries'), 'Video summaries section selected');
    await d.closeTab(settings);
    await d.activate(p);

    await d.key(p, 'Escape'); // close the card before moving on, as a viewer would
    await d.hover(p, "document.querySelector('#video-title')"); await until(pillVisible, 'shown again');
    await d.hover(p, "document.querySelector('#elsewhere')");
    await until(async () => !(await pillVisible()), 'hides when the pointer leaves');
    await d.screenshot(p, path.resolve('artifacts/e2e', `${name}-summary-pill.png`));
    console.log(`${name}: PASS hover Summarize button, Shorts exclusion, placement, setup link, and hide on leave`);
  } finally { await d.close(); }
}
(async () => { for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
