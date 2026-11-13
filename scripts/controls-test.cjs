// Exercise every settings/popup control through browser clicks and keyboard input.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until } = require('../tests/e2e-driver.cjs');
const C = require('../extension/core.js');
const root = 'document.getElementById("curb-extension-root").shadowRoot';
const out = path.resolve('artifacts/e2e');
const fixture = '<!doctype html><title>Controls fixture</title><ytd-app><ytd-browse page-subtype="home"><div id="contents">Homepage</div></ytd-browse></ytd-app>';
async function run(name) {
  await fs.mkdir(out, { recursive: true });
  const profile = await fs.mkdtemp(path.join(out, `${name}-controls-`));
  let d;
  const click = (p, label, inContent = false) => d.click(p, `[...${inContent ? root : 'document'}.querySelectorAll('button')].find(n => n.textContent === ${JSON.stringify(label)})`);
  const ready = p => until(() => d.evaluate(p, () => !!document.querySelector('[data-setting]')), 'settings view');
  const get = p => d.evaluate(p, async () => {
    const r = await (globalThis.browser || chrome).runtime.sendMessage({ type: 'GET' });
    if (!r.ok) throw new Error(r.error); return r.data;
  });
  const checkSettings = async p => {
    await d.activate(p);
    const more = await d.evaluate(p, () => !!document.querySelector('.popup-more'));
    if (more) await d.click(p, 'document.querySelector(".popup-more summary")');
    const controls = await d.evaluate(p, () => [...document.querySelectorAll('[data-setting]')].map(n => ({ key: n.dataset.setting, type: n.type, values: n.tagName === 'SELECT' ? [...n.options].map(o => o.value) : null })));
    const originals = (await get(p)).settings;
    for (const { key, type, values } of controls) {
      const expression = `document.querySelector('[data-setting="${key}"]')`;
      const set = async value => {
        await until(() => d.evaluate(p, key => !document.querySelector(`[data-setting="${key}"]`).disabled, key), `${key} enabled`);
        if (type === 'checkbox') {
          const checked = await d.evaluate(p, key => document.querySelector(`[data-setting="${key}"]`).checked, key);
          if (checked !== value) await d.click(p, expression);
        } else {
          // Native select keyboard interaction, rather than synthetic change events.
          await d.evaluate(p, key => document.querySelector(`[data-setting="${key}"]`).focus(), key);
          await d.key(p, 'Home');
          await until(async () => String((await get(p)).settings[key]) === values[0], `${key} first option saved`);
          for (let i = 0; i < values.indexOf(String(value)); i++) {
            await until(() => d.evaluate(p, key => !document.querySelector(`[data-setting="${key}"]`).disabled, key), `${key} next option enabled`);
            await d.evaluate(p, key => document.querySelector(`[data-setting="${key}"]`).focus(), key);
            await d.key(p, 'ArrowDown');
            await until(async () => String((await get(p)).settings[key]) === values[i + 1], `${key} next option saved`);
          }
          // Arrow keys commit while the select is closed. Enter would open its
          // native menu and leave the next iteration waiting on an uncommitted item.
          await d.key(p, 'Escape');
        }
        await until(async () => String((await get(p)).settings[key]) === String(value), `${key} saved ${value}`);
        await until(() => d.evaluate(p, ({ key, value }) => {
          const n = document.querySelector(`[data-setting="${key}"]`);
          return !n.disabled && String(n.type === 'checkbox' ? n.checked : n.value) === String(value);
        }, { key, value }), `${key} UI ${value}`);
      };
      if (type === 'checkbox') await set(!originals[key]);
      else for (const value of values) await set(value);
      await set(originals[key]);
    }
    assert.deepEqual((await get(p)).settings, originals);
    return controls.length;
  };
  try {
    d = await launch(name, fixture, profile);
    const main = await d.open('https://www.youtube.com/');
    await until(() => d.evaluate(main, () => !!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')), 'intent ready');
    let options = await d.open(d.extensionUrl('options.html'));
    await ready(options);
    const prefix = (await d.url(options)).replace(/options.html$/, '');
    const count = await checkSettings(options);
    assert.equal(count, Object.keys(C.DEFAULTS).length, 'every setting has a UI control');
    console.log(`${name}: PASS all ${count} settings controls save and restore through UI`);

    for (const id of ['intention', 'distractions', 'privacy']) {
      await d.click(options, `document.querySelector('a[href="#${id}"]')`);
      await until(() => d.evaluate(options, id => document.querySelector('.nav [aria-current]').hash === `#${id}`, id), `settings section ${id}`);
    }
    await d.screenshot(options, path.join(out, `${name}-copy-settings-wide.png`));
    await d.resize(options, 390, 844);
    await d.screenshot(options, path.join(out, `${name}-copy-settings-narrow.png`));
    await d.resize(options, 1280, 900);
    await click(options, 'Clear local data…'); await click(options, 'Cancel');
    assert.equal(await d.evaluate(options, () => [...document.querySelectorAll('button')].find(n => n.textContent === 'Clear and reset').closest('[hidden]') !== null), true);
    const tabs = await d.tabs(); await d.click(options, `document.querySelector('a[href="privacy.html"]')`);
    const policy = await until(async () => (await d.tabs()).find(p => !tabs.includes(p)), 'privacy tab');
    await until(() => d.evaluate(policy, () => document.querySelector('h1')?.textContent === 'Privacy policy'), 'privacy rendered');
    await d.closeTab(policy);
    console.log(`${name}: PASS settings sections, reset cancel and privacy link`);

    await d.fill(main, `${root}.querySelector('#curb-intent')`, 'Listen to Bollywood songs');
    await click(main, 'Start session', true);
    await until(async () => (await get(options)).session?.intent === 'Listen to Bollywood songs', 'session started');
    const popup = await d.open(prefix + 'popup.html'); await ready(popup);
    const popupCount = await checkSettings(popup);
    await d.screenshot(popup, path.join(out, `${name}-copy-popup.png`));
    console.log(`${name}: PASS all ${popupCount} popup settings save and restore through UI`);
    await d.closeTab(options);
    const beforeSettings = await d.tabs(); await click(popup, 'Settings');
    options = await until(async () => {
      for (const p of await d.tabs()) if (!beforeSettings.includes(p) && (await d.url(p)).endsWith('/options.html')) return p;
    }, 'popup settings opens new destination');
    await ready(options);
    const previous = await d.tabs(); await click(popup, 'Open YouTube');
    const opened = await until(async () => (await d.tabs()).find(p => !previous.includes(p)), 'popup YouTube destination');
    await until(async () => (await d.url(opened)) === 'https://www.youtube.com/', 'homepage opened');
    await click(popup, 'Finish this session');
    await until(async () => (await get(options)).session?.stopped, 'popup finish persisted');
    await until(() => d.evaluate(main, () => document.getElementById('curb-extension-root').shadowRoot.querySelector('h1')?.textContent === 'Session finished'), 'finish reaches YouTube');
    await d.closeTab(opened);
    console.log(`${name}: PASS popup Settings, Open YouTube and Finish`);

    await click(options, 'Clear local data…'); await click(options, 'Clear and reset');
    const cleared = await get(options); assert.equal(cleared.session, null); assert.deepEqual(cleared.settings, C.DEFAULTS);
    console.log(`${name}: PASS confirmed reset clears session and restores defaults`);

    // A fresh extension-origin document allows a real runtime failure before pages.js starts.
    for (const pageType of ['options', 'popup']) for (const recovery of ['retry', 'automatic']) {
      const recoveryPage = await d.open(prefix + 'privacy.html'); await d.activate(recoveryPage);
      await d.evaluate(recoveryPage, async pageType => {
        document.body.replaceChildren(); document.body.dataset.page = pageType;
        const app = document.createElement('div'); app.id = 'app'; document.body.append(app);
        const api = globalThis.browser || chrome;
        const original = api.runtime.sendMessage.bind(api.runtime);
        window.failGet = true;
        api.runtime.sendMessage = message => message.type === 'GET' && window.failGet
          ? Promise.reject(new Error('Simulated startup connection failure')) : original(message);
        for (const file of ['core.js', 'pages.js']) await new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = file;
          script.onload = resolve; script.onerror = reject; document.body.append(script);
        });
      }, pageType);
      await until(() => d.evaluate(recoveryPage, () => document.querySelector('[role="alert"]')?.textContent === 'Simulated startup connection failure'), 'startup failure visible');
      await click(recoveryPage, 'Retry');
      assert.equal(await d.evaluate(recoveryPage, () => !!document.querySelector('[role="alert"]')), true);
      await d.evaluate(recoveryPage, () => { window.failGet = false; });
      if (recovery === 'retry') await click(recoveryPage, 'Retry');
      await ready(recoveryPage);
      assert.equal(await d.evaluate(recoveryPage, () => !!document.querySelector('[role="alert"]')), false);
      await d.closeTab(recoveryPage);
      console.log(`${name}: PASS ${pageType} startup failure ${recovery} recovery`);
    }
    assert.deepEqual(d.errors, [], 'no uncaught browser errors');
  } finally {
    await d?.close();
    console.log(`${name}: retained test profile ${profile}`);
  }
}
(async () => { for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name); })().catch(error => { console.error(error); process.exitCode = 1; });
