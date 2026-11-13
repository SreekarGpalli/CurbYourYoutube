// Regression coverage for settings focus, concurrent saves, dependent values and accessible layout.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch, until } = require('../tests/e2e-driver.cjs');
const out = path.resolve('artifacts/e2e');
const fixture = '<!doctype html><ytd-app><input name="search_query"></ytd-app>';
async function run(name) {
  const d = await launch(name, fixture, await fs.mkdtemp(path.join(out, name + '-settings-regression-')));
  const selector = key => 'document.querySelector(' + JSON.stringify('[data-setting="' + key + '"]') + ')';
  try {
    await d.open('https://www.youtube.com/');
    const options = await d.open(d.extensionUrl('options.html'));
    await until(() => d.evaluate(options, () => !!document.querySelector('[data-setting]')), 'settings ready');
    const send = (type, extra = {}) => d.evaluate(options, async message => {
      const response = await (globalThis.browser || chrome).runtime.sendMessage(message);
      if (!response.ok) throw new Error(response.error);
      return response.data;
    }, { type, ...extra });
    // Use the browser runtime instead of a test hook to create the longest accepted intent.
    await send('START', { expectedId: null, intent: 'W'.repeat(180) });
    const popup = await d.open(d.extensionUrl('popup.html'));
    for (const [page, label, width, height] of [
      [options, 'settings-wide', 1280, 900],
      [options, 'settings-narrow', 390, 844],
      [popup, 'popup', 390, 600]
    ]) {
      await d.activate(page); await d.resize(page, width, height);
      await until(() => d.evaluate(page, () => document.querySelector('.session-intent')?.textContent.length === 180), 'long intent rendered');
      assert(await d.evaluate(page, () => document.documentElement.scrollWidth <= innerWidth), label + ' fits viewport');
      await d.screenshot(page, path.join(out, name + '-settings-regression-' + label + '.png'));
    }
    console.log(name + ': PASS 180-character intent fits wide/narrow Settings and popup');

    const keySettings = await d.open(d.extensionUrl('options.html#summaries'));
    const keyField = 'document.querySelector("#gemini-key")';
    const masks = page => d.evaluate(page, () => [...document.querySelectorAll('.key-list code')].map(key => key.textContent));
    await until(() => d.evaluate(keySettings, () => !!document.querySelector('#gemini-key')), 'Gemini settings ready');
    await d.evaluate(keySettings, () => {
      const api = globalThis.browser || chrome;
      api.permissions.request = async () => !!window.geminiAllowed;
      api.permissions.contains = async () => !!window.geminiAllowed;
      api.permissions.getAll = async () => ({ data_collection: ['browsingActivity', 'websiteActivity'] });
    });
    const key = 'AQ.Ab8RN6' + 'x'.repeat(48);
    await d.fill(keySettings, keyField, key);
    await d.key(keySettings, 'Enter');
    await until(() => d.evaluate(keySettings, () => document.querySelector('.key-error')?.textContent === 'Allow Google access to use summaries.'), 'permission denial is explained');
    assert.deepEqual((await send('SUMMARY_KEYS')).summaryKeys, [], 'denied permission does not save the key');
    assert.equal(await d.evaluate(keySettings, () => document.querySelector('#gemini-key').value.length), key.length);

    await d.evaluate(keySettings, () => { window.geminiAllowed = true; });
    await d.key(keySettings, 'Enter');
    await until(async () => (await masks(keySettings))[0] === 'AQ.A…xxxx', 'new key shown masked');
    assert.equal(await d.evaluate(keySettings, () => document.querySelector('#gemini-key').value), '');
    assert.equal(await d.evaluate(keySettings, () => document.querySelector('.key-error')), null);
    await until(async () => (await masks(options))[0] === 'AQ.A…xxxx', 'other Settings tab updates');
    await until(() => d.evaluate(options, () => !document.querySelector('.key-permission').hidden), 'permission action shown when missing');
    await d.resize(keySettings, 390, 844);
    assert(await d.evaluate(keySettings, () => document.documentElement.scrollWidth <= innerWidth));
    await d.evaluate(keySettings, () => document.activeElement.blur());
    await d.screenshot(keySettings, path.join(out, name + '-gemini-settings.png'));
    if (name === 'chromium') await keySettings.locator('#summaries').screenshot({ path: path.join(out, 'chromium-gemini-settings-section.png') });
    await d.click(keySettings, 'document.querySelector(".key-list button")');
    await until(async () => !(await masks(keySettings)).length && !(await masks(options)).length, 'key removal reaches both tabs');
    assert.equal(await d.evaluate(keySettings, () => document.activeElement.id), 'gemini-key');
    await d.closeTab(keySettings);
    console.log(name + ': PASS Gemini key form, denial, masking, cross-tab updates, removal focus and narrow layout');

    await d.activate(options); await d.resize(options, 1280, 900);
    await d.evaluate(options, () => {
      const api = globalThis.browser || chrome;
      const original = api.runtime.sendMessage.bind(api.runtime);
      window.settingsAudit = { active: 0, maximum: 0, values: [], failNext: false };
      api.runtime.sendMessage = async message => {
        if (message.type !== 'SETTINGS') return original(message);
        const audit = window.settingsAudit;
        audit.active++;
        audit.maximum = Math.max(audit.maximum, audit.active);
        audit.values.push(message.settings);
        const fail = audit.failNext; audit.failNext = false;
        try {
          await new Promise(resolve => setTimeout(resolve, 150));
          if (fail) throw new Error('Simulated settings save failure');
          return await original(message);
        } finally { audit.active--; }
      };
    });
    const idle = () => until(() => d.evaluate(options, () => !document.querySelector('[aria-busy="true"]') && window.settingsAudit.active === 0), 'settings saves settled');
    await d.evaluate(options, () => document.querySelector('[data-setting="breakMinutes"]').focus());
    await d.key(options, 'Home'); await d.key(options, 'ArrowDown'); await d.key(options, 'Home'); await d.key(options, 'ArrowDown'); await d.key(options, 'Escape');
    assert.equal(await d.evaluate(options, () => document.activeElement.dataset.setting), 'breakMinutes');
    await idle();
    assert.equal((await send('GET')).settings.breakMinutes, 60);
    assert.equal(await d.evaluate(options, () => document.activeElement.dataset.setting), 'breakMinutes');
    assert.equal(await d.evaluate(options, () => window.settingsAudit.maximum), 1);
    console.log(name + ': PASS rapid dropdown changes save in order and preserve keyboard focus');

    const before = (await send('GET')).settings.fullscreenPill;
    await d.evaluate(options, () => {
      window.settingsAudit.failNext = true;
      document.querySelector('[data-setting="fullscreenPill"]').focus();
    });
    for (let i = 0; i < 3; i++) await d.key(options, ' ');
    assert.equal(await d.evaluate(options, () => document.activeElement.dataset.setting), 'fullscreenPill');
    await idle();
    assert.equal((await send('GET')).settings.fullscreenPill, !before);
    assert.equal(await d.evaluate(options, () => document.querySelector('[data-setting="fullscreenPill"]').checked), !before);
    assert.equal(await d.evaluate(options, () => document.activeElement.dataset.setting), 'fullscreenPill');
    console.log(name + ': PASS rapid switch changes retain the latest choice after an earlier failed save');

    const persisted = (await send('GET')).settings.fullscreenPill;
    await d.evaluate(options, () => { window.settingsAudit.failNext = true; });
    await d.key(options, ' '); await idle();
    assert.equal((await send('GET')).settings.fullscreenPill, persisted);
    assert.equal(await d.evaluate(options, () => document.querySelector('[data-setting="fullscreenPill"]').checked), persisted);
    await d.key(options, ' '); await idle();
    assert.equal((await send('GET')).settings.fullscreenPill, !persisted);
    console.log(name + ': PASS failed save restores the stored value and the next save succeeds');

    await send('SETTINGS', { settings: { hideHome: false, homeMinutes: 5 } });
    await until(() => d.evaluate(options, () => document.querySelector('[data-setting="homeMinutes"]').disabled), 'homepage duration disabled');
    await d.evaluate(options, () => {
      const duration = document.querySelector('[data-setting="homeMinutes"]');
      window.firstEnabledDuration = null;
      const observer = new MutationObserver(() => {
        if (!duration.disabled) { window.firstEnabledDuration = duration.value; observer.disconnect(); }
      });
      observer.observe(duration, { attributes: true, attributeFilter: ['disabled'] });
    });
    await send('SETTINGS', { settings: { hideHome: true, homeMinutes: 10 } });
    await until(() => d.evaluate(options, () => window.firstEnabledDuration !== null), 'homepage duration enabled');
    assert.equal(await d.evaluate(options, () => window.firstEnabledDuration), '10');
    console.log(name + ': PASS outside updates set the new homepage duration before enabling it');

    await d.click(options, '[...document.querySelectorAll("button")].find(n=>n.textContent==="Clear local data…")');
    await d.click(options, '[...document.querySelectorAll("button")].find(n=>n.textContent==="Cancel")');
    assert.equal(await d.evaluate(options, () => document.activeElement.textContent), 'Clear local data…');
    console.log(name + ': PASS reset Cancel returns focus to its trigger');

    if (name === 'chromium') {
      await options.emulateMedia({ forcedColors: 'active' });
      const colors = () => d.evaluate(options, () => {
        const toggle = document.querySelector('[data-setting="hideShorts"]');
        return { checked: toggle.checked, track: getComputedStyle(toggle).backgroundColor, border: getComputedStyle(toggle).borderColor,
          thumb: getComputedStyle(toggle, '::before').backgroundColor };
      });
      const checked = await colors();
      assert.notEqual(checked.track, checked.thumb, 'checked thumb contrasts with its track');
      await d.click(options, selector('hideShorts')); await idle();
      const unchecked = await colors();
      assert.notEqual(unchecked.track, unchecked.thumb, 'unchecked thumb contrasts with its track');
      assert.notEqual(unchecked.track, unchecked.border, 'unchecked track remains outlined during hover');
      assert.notEqual(checked.checked, unchecked.checked);
      assert.notDeepEqual([checked.track, checked.thumb], [unchecked.track, unchecked.thumb]);
      await d.screenshot(options, path.join(out, name + '-settings-regression-forced-colors.png'));
      console.log(name + ': PASS forced-colors switches show distinct on/off states and visible thumbs');
    }
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium', 'firefox']) await run(name);
})().catch(error => { console.error(error); process.exitCode = 1; });
