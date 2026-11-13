// Signed-in YouTube uses a <textarea name="search_query"> search box (older layouts use <input>).
// A typed intent must land in it with focus, and nothing may be searched automatically.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until, delay } = require('../tests/e2e-driver.cjs');
const fixture = `<!doctype html><meta charset="utf-8"><title>Home - YouTube</title>
<ytd-app><div id="masthead-container"><yt-searchbox><input type="file" class="ytSearchboxComponentHiddenFileInput" style="display:none">
<form action="/results"><textarea name="search_query" role="combobox" aria-label="Search" rows="1"></textarea></form></yt-searchbox></div>
<ytd-browse page-subtype="home"><div id="contents">Recommendations</div></ytd-browse></ytd-app>`;
const root = 'document.getElementById("curb-extension-root").shadowRoot';
async function run(name) {
  await fs.mkdir('artifacts/e2e', { recursive: true });
  const d = await launch(name, fixture, await fs.mkdtemp(path.resolve('artifacts/e2e', `${name}-textarea-search-`)));
  try {
    const p = await d.open('https://www.youtube.com/');
    await until(() => d.evaluate(p, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'intent prompt');
    const before = d.requests.length;
    await d.fill(p, `${root}.querySelector('#curb-intent')`, 'learn rust ownership');
    await d.click(p, `[...${root}.querySelectorAll('button')].find(n => n.textContent === 'Start session')`);
    await until(() => d.evaluate(p, () => document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.value === 'learn rust ownership'),
      'typed intent fills and focuses the textarea search box');
    await delay(2200);
    assert.equal(new URL(await d.url(p)).pathname, '/', 'no automatic search');
    assert.deepEqual(d.requests.slice(before).filter(url => new URL(url).pathname === '/results'), [], 'no results request');
    console.log(`${name}: PASS typed intent fills the textarea search box without searching`);
  } finally { await d.close(); }
}
(async () => { for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
