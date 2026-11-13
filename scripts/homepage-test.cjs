// Real extension UI and a real two-minute homepage countdown, without clock hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const out = path.resolve('artifacts/e2e');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const quick = process.argv.includes('--quick');
const fixture = `<!doctype html><title>Curated homepage - YouTube</title>
<style>ytd-rich-item-renderer{display:block;padding:20px}ytd-thumbnail{display:block;background:coral;width:240px;height:135px}a{color:white}</style>
<ytd-app><ytd-browse page-subtype="home"><div id="contents">
<ytd-rich-item-renderer><ytd-thumbnail><a href="/watch?v=lesson">Thumbnail</a></ytd-thumbnail><a href="/watch?v=lesson">A useful recommendation</a></ytd-rich-item-renderer>
<grid-shelf-view-model><h2>Shorts</h2><ytm-shorts-lockup-view-model><a href="/shorts/test">Short</a></ytm-shorts-lockup-view-model></grid-shelf-view-model>
</div></ytd-browse></ytd-app>`;
async function run(name) {
  const result = { browser: name, steps: [], status: 'running' };
  const profile = await fs.mkdtemp(path.join(out, `${name}-homepage-profile-`));
  let d, main, options;
  const click = text => d.click(main, `[...${root}.querySelectorAll('button')].find(n=>n.textContent===${JSON.stringify(text)})`);
  const hidden = () => d.evaluate(main, () => getComputedStyle(document.querySelector('ytd-browse #contents')).display === 'none');
  const get = async () => (await d.evaluate(options, () => (globalThis.browser || chrome).runtime.sendMessage({ type: 'GET' }))).data;
  const step = async (label, fn) => { await fn(); result.steps.push(label); console.log(`${name}-homepage: PASS ${label}`); };
  try {
    d = await launch(name, fixture, profile);
    main = await d.open('https://www.youtube.com/');
    await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'intent ready');
    await click('Practice programming'); await click('Start session');
    await until(hidden, 'home hidden');
    options = await d.open(d.extensionUrl('options.html'));
    await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting="homeMinutes"]')), 'duration ready');
    await step('Deliberate browse reveals recommendations, retains Shorts/thumbnail restrictions and can be hidden early', async () => {
      await d.activate(main); await click('Browse homepage for 5 min');
      await until(async () => !(await hidden()), 'feed revealed');
      await d.hover(main, `${root}.querySelector('.intent')`);
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.querySelector('ytd-thumbnail')).opacity), '0');
      assert.equal(await d.evaluate(main, () => getComputedStyle(document.querySelector('grid-shelf-view-model')).display), 'none');
      await d.screenshot(main, path.join(out, `${name}-homepage-browsing.png`));
      await click('Hide homepage'); await until(hidden, 'early hide');
    });
    await step('Duration control saves two minutes', async () => {
      await d.activate(options);
      await d.evaluate(options, () => document.querySelector('[data-setting="homeMinutes"]').focus());
      await d.key(options, 'Home'); await d.key(options, 'Enter');
      await until(async () => (await get()).settings.homeMinutes === 2, 'two minutes saved');
      await d.activate(main);
      await until(() => d.evaluate(main, () => [...document.getElementById('curb-extension-root').shadowRoot.querySelectorAll('button')].some(n => n.textContent === 'Browse homepage for 2 min')), 'new duration');
      await click('Browse homepage for 2 min'); await until(async () => !(await hidden()), 'second browse');
    });
    await step('Refresh retains allowance, video navigation pauses it, and another homepage shares it', async () => {
      await until(async () => (await get()).homeRemainingMs < 117000, 'countdown running');
      const before = (await get()).homeRemainingMs;
      await d.navigate(main, 'https://www.youtube.com/'); await until(async () => !(await hidden()), 'reload remains revealed');
      assert((await get()).homeRemainingMs <= before);
      await d.navigate(main, 'https://www.youtube.com/watch?v=lesson');
      await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('h1')?.textContent === 'Does this video fit your intent?'), 'video gate');
      await click('Yes, this fits'); await delay(2500);
      const paused = (await get()).homeRemainingMs;
      await delay(3000); assert.equal((await get()).homeRemainingMs, paused);
      const second = await d.open('https://www.youtube.com/');
      await until(() => d.evaluate(second, () => document.documentElement.hasAttribute('data-curb-ready') && !document.documentElement.hasAttribute('data-curb-hide-home')), 'shared homepage');
      assert((await get()).homeRemainingMs <= paused);
      await d.closeTab(second); await d.navigate(main, 'https://www.youtube.com/'); await d.activate(main);
      await until(async () => !(await hidden()), 'returned home');
    });
    await step('Narrow controls fit and remain above homepage content', async () => {
      await d.resize(main, 390, 844);
      await until(() => d.evaluate(main, () => parseFloat(getComputedStyle(document.body).paddingBottom) >= document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar').getBoundingClientRect().height), 'content clears wrapped bottom bar');
      assert(await d.evaluate(main, () => {
        const bar = document.getElementById('curb-extension-root').shadowRoot.querySelector('.bar');
        return [...bar.querySelectorAll('button,input,[data-home-time]')].filter(n => n.getClientRects().length)
          .every(n => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= bar.getBoundingClientRect().bottom; });
      }));
      await d.screenshot(main, path.join(out, `${name}-homepage-narrow.png`));
      await d.resize(main, 1280, 900);
    });
    if (!quick) console.log(`${name}-homepage: Waiting for the real two-minute browsing allowance to expire`);
    if (!quick) await step('Real countdown expires automatically and a new browse requires an explicit click', async () => {
      await until(hidden, 'automatic home hide', 150000);
      assert.equal((await get()).homeRemainingMs, 0);
      await d.screenshot(main, path.join(out, `${name}-homepage-expired.png`));
      await d.navigate(main, 'https://www.youtube.com/'); await until(hidden, 'refresh cannot replenish expired budget');
      await click('Browse homepage for 2 min'); await until(async () => !(await hidden()), 'explicit new browse');
      await click('Hide homepage'); await until(hidden, 'done browsing');
    });
    result.status = 'passed';
  } catch (e) { result.status = 'failed'; result.error = e.stack; console.error(e); process.exitCode = 1; }
  finally {
    if (main && result.status === 'failed') await d.screenshot(main, path.join(out, `${name}-homepage-failure.png`)).catch(() => {});
    result.pageErrors = d?.errors || []; await d?.close();
    // Retain this isolated profile with the test evidence for debugging.
    await fs.writeFile(path.join(out, `${name}-homepage${quick ? '-quick' : ''}-results.json`), JSON.stringify(result, null, 2));
  }
}
(async () => { await fs.mkdir(out, { recursive: true }); const names = process.argv.slice(2).filter(n => n !== '--quick'); for (const name of names.length ? names : ['chromium', 'firefox']) await run(name); })().catch(e => { console.error(e); process.exitCode = 1; });
