const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { launch, until } = require('../tests/e2e-driver.cjs');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const fixture = '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:white;color:black}ytd-app{display:block;--yt-spec-text-primary:#171717}a{display:block;margin:12px}ytd-thumbnail{display:block;width:100px;height:60px}</style>' +
  '<ytd-app><form action="/results"><input name="search_query" aria-label="Search"></form><ytd-browse page-subtype="home"><div id="contents">Feed</div></ytd-browse><ytd-watch-metadata><h1>Lesson</h1></ytd-watch-metadata>' +
  '<ytd-video-renderer><ytd-thumbnail><a id="thumb" href="/watch?v=one">Thumbnail</a></ytd-thumbnail><a id="title" href="/watch?v=one">Full lesson</a></ytd-video-renderer>' +
  '<div class="video-thumbnail-container"><a id="mobile-thumb" href="/watch?v=mobile">Mobile thumbnail</a></div>' +
  '<ytd-shelf-renderer id="mixed"><yt-lockup-view-model id="ordinary"><a href="/watch?v=ordinary">Full-length video</a></yt-lockup-view-model><yt-shorts-lockup-view-model id="short">Short</yt-shorts-lockup-view-model></ytd-shelf-renderer>' +
  '<grid-shelf-view-model id="pure"><yt-shorts-lockup-view-model>Short</yt-shorts-lockup-view-model></grid-shelf-view-model>' +
  '<ytd-rich-shelf-renderer id="mixed-live" is-shorts><a href="/live/stream">Full live stream</a><yt-shorts-lockup-view-model>Short</yt-shorts-lockup-view-model></ytd-rich-shelf-renderer>' +
  '<yt-guide-entry-view-model id="subscription"><a href="/feed/subscriptions">Subscriptions</a></yt-guide-entry-view-model><yt-guide-section-view-model id="more"><a href="/premium">Premium</a></yt-guide-section-view-model></ytd-app>' +
  '<script>document.querySelector("input").value=new URL(location.href).searchParams.get("search_query")||"";</script>';
async function run(name) {
  const d = await launch(name, fixture, await fs.mkdtemp('artifacts/e2e/' + name + '-regressions-'));
  let p;
  try {
    const options = await d.open(d.extensionUrl('options.html'));
    const send = async (type, extra = {}) => {
      const response = await d.evaluate(options, m => (globalThis.browser || chrome).runtime.sendMessage(m), { type, ...extra });
      assert.equal(response.ok, true, response.error);
      return response.data;
    };
    const click = text => d.click(p, '[...' + root + '.querySelectorAll("button")].find(n=>n.textContent===' + JSON.stringify(text) + ')');
    const heading = text => until(() => d.evaluate(p, text => document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.card h1')?.textContent === text, text), text);
    const start = async text => {
      await d.fill(p, root + '.querySelector("#curb-intent")', text);
      await click('Start session');
    };
    const native = text => until(() => d.evaluate(p, text => document.activeElement?.name === 'search_query' && document.activeElement.value === text, text), 'native handoff ' + text);
    const searches = () => d.requests.filter(url => new URL(url).pathname === '/results');
    const visible = id => d.evaluate(p, id => {
      for (let n = document.getElementById(id); n; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false;
      return true;
    }, id);
    for (const host of ['www.youtube.com', 'youtube.com', 'm.youtube.com']) {
      await send('RESET');
      p = await d.open('https://' + host + '/watch?v=one');
      await heading('What brings you to YouTube?');
      const before = searches().length;
      await start('Cross origin Python');
      await native('Cross origin Python');
      assert.equal(searches().length, before);
      assert.equal(await d.evaluate(p, () => sessionStorage.getItem('curb-focus-search')), null);
      await d.closeTab(p);
    }
    console.log(name + ': PASS typed intent handoff from all three origins, zero implicit searches or page storage');

    await send('RESET');
    p = await d.open('https://www.youtube.com/results?search_query=original');
    await heading('What brings you to YouTube?');
    await start('Staged intent'); await native('Staged intent');
    await d.fill(p, 'document.querySelector("input[name=search_query]")', 'Changed native query'); await d.key(p, 'Enter');
    await until(async () => new URL(await d.url(p)).searchParams.get('search_query') === 'Changed native query', 'changed query URL');
    await until(() => d.evaluate(p, () => document.querySelector('input[name=search_query]')?.value === 'Changed native query'), 'changed native field');
    await d.navigate(p, await d.url(p));
    await until(() => d.evaluate(p, () => document.querySelector('input[name=search_query]')?.value === 'Changed native query'), 'reloaded native field');
    await click('Edit intent'); await click('Practice programming'); await click('Start session'); await native('');
    console.log(name + ': PASS edited native query survives navigation and reload, preset-only clears old text');

    await click('Edit intent'); await start('Delete this intent'); await native('Delete this intent');
    await send('RESET'); await heading('What brings you to YouTube?');
    await d.navigate(p, 'https://www.youtube.com/'); await heading('What brings you to YouTube?');
    await click('Follow a course'); await click('Start session'); await native('');
    assert.equal(await d.evaluate(p, () => sessionStorage.getItem('curb-focus-search')), null);
    console.log(name + ': PASS reset prevents deleted intent restoration');

    await d.evaluate(p, () => document.querySelector('form').remove());
    const beforeMissing = searches().length;
    await click('Edit intent'); await start('Wait for native search');
    await d.evaluate(p, () => new Promise(resolve => setTimeout(resolve, 400)));
    assert.equal(searches().length, beforeMissing);
    assert.equal(new URL(await d.url(p)).pathname, '/');
    await d.evaluate(p, () => {
      const form = document.createElement('form'); form.action = '/results';
      const input = document.createElement('input'); input.name = 'search_query';
      form.append(input); document.querySelector('ytd-app').prepend(form);
    });
    await native('Wait for native search');
    assert.equal(searches().length, beforeMissing);
    console.log(name + ': PASS missing native search waits and resumes without issuing results');

    await send('SETTINGS', { settings: { hideShorts: true, hideSubscriptions: true, hideMore: true, thumbnailMode: 'hidden' } });
    await until(async () => !await visible('short') && !await visible('pure'), 'Shorts hidden');
    assert(await visible('ordinary')); assert(await visible('mixed'));
    assert(await visible('mixed-live'));
    await until(async () => !await visible('subscription') && !await visible('more'), 'modern navigation hidden');
    await until(() => d.evaluate(p, () => document.getElementById('thumb').tabIndex === -1), 'hidden thumbnail excluded');
    assert.equal(await d.evaluate(p, () => document.getElementById('mobile-thumb').tabIndex), -1);
    await d.evaluate(p, () => document.querySelector('input[name=search_query]').focus());
    await d.key(p, 'Tab');
    assert.equal(await d.evaluate(p, () => document.activeElement.id), 'title');
    await send('SETTINGS', { settings: { thumbnailMode: 'show' } });
    await until(() => d.evaluate(p, () => !document.getElementById('thumb').hasAttribute('tabindex')), 'thumbnail tab stop restored');
    const color = await d.evaluate(p, () => getComputedStyle(document.getElementById('curb-extension-root').shadowRoot.querySelector('.home h1')).color);
    assert.equal(color, 'rgb(23, 23, 23)');
    // Regression: in YouTube's dark theme the panel text was the same near-black and unreadable.
    await d.evaluate(p, () => { document.documentElement.setAttribute('dark', ''); document.body.style.background = '#0f0f0f'; });
    await until(() => d.evaluate(p, () => getComputedStyle(document.getElementById('curb-extension-root').shadowRoot.querySelector('.home h1')).color === 'rgb(241, 241, 241)'), 'dark-theme panel text is light');
    await d.evaluate(p, () => document.documentElement.removeAttribute('dark'));
    await until(() => d.evaluate(p, () => getComputedStyle(document.getElementById('curb-extension-root').shadowRoot.querySelector('.home h1')).color === 'rgb(23, 23, 23)'), 'light-theme panel text is dark again');
    console.log(name + ': PASS mixed Shorts shelves, modern navigation, keyboard tab order, thumbnail restoration and light/dark-theme text');

    await click('Edit intent'); await heading('What brings you to YouTube?');
    await d.fill(p, root + '.querySelector("#curb-intent")', 'An unfinished draft');
    const session = (await send('GET')).session;
    await send('STOP', { sessionId: session.id }); await heading('Session finished');
    await click('Set intent'); await heading('What brings you to YouTube?');
    console.log(name + ': PASS cross-tab finish replaces an open intent draft');

    await send('RESET'); await send('SETTINGS', { settings: { redirectSubscriptions: false } });
    await d.navigate(p, 'https://www.youtube.com/feed/subscriptions'); await heading('What brings you to YouTube?');
    await start('Python'); await native('Python'); await d.key(p, 'Escape');
    await send('SETTINGS', { settings: { redirectSubscriptions: true } });
    await until(async () => new URL(await d.url(p)).pathname === '/', 'dismissed search releases subscription redirect');
    console.log(name + ': PASS Escape releases the pending subscriptions redirect');
    await d.settleRequests();
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
}
(async () => {
  await fs.mkdir('artifacts/e2e', { recursive: true });
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name);
})().catch(error => { console.error(error); process.exitCode = 1; });
