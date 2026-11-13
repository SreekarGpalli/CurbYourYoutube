const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness(seed = {}) {
  let now = new Date(2026, 9, 7, 12).getTime(), listener, removed;
  const local = seed.local || {}, memory = seed.memory || {}, broadcasts = [];
  const area = db => ({
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in db).map(k => [k, structuredClone(db[k])])); },
    async set(values) { Object.assign(db, structuredClone(values)); },
    async clear() { Object.keys(db).forEach(k => delete db[k]); },
    async remove(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete db[k]); }
  });
  const api = { runtime: { id: 'test-extension', getURL: p => `chrome-extension://test-extension/${p}`, onMessage: { addListener(fn) { listener = fn; } }, async openOptionsPage() {} },
    storage: { local: area(local), session: area(memory) },
    tabs: { async sendMessage(id, msg) { broadcasts.push({ id, msg: structuredClone(msg) }); }, onRemoved: { addListener(fn) { removed = fn; } } },
    permissions: { async contains() { return seed.granted !== false; } } };
  const context = vm.createContext({ [seed.chrome ? 'chrome' : 'browser']: api, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }, URL, console, Math, setTimeout, clearTimeout, AbortController, TextDecoder, TextEncoder, crypto,
    fetch: seed.fetch || (async () => { throw new Error('Unexpected network request in a test'); }) });
  vm.runInContext(fs.readFileSync('extension/core.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('extension/summary.js', 'utf8'), context);
  if (seed.limits) context.CurbSummary.LIMITS_MS = seed.limits; // shortened time limits for tests
  vm.runInContext(fs.readFileSync('extension/background.js', 'utf8'), context);
  return { local, memory, broadcasts, api, advance(ms) { now += ms; }, remove(id) { removed(id); },
    send(type, args = {}, tab = 1, url = 'https://www.youtube.com/', senderId = 'test-extension', tabInfo = {}) { return new Promise(resolve => { const response = listener({ type, ...args }, { id: senderId, url, ...(tab === null ? {} : { tab: { id: tab, ...tabInfo } }) }, resolve); if (response?.then) response.then(resolve); else if (response === false) resolve(undefined); }); } };
}
test('search handoffs stay private, per-tab, session-bound and scoped to the full destination', async () => {
  const h = harness();
  const sessionId = (await h.send('START', { intent: 'Learn Python', expectedId: null })).data.session.id;
  const handoff = { text: 'Python', sessionId, page: 'old-page', url: 'https://www.youtube.com/results?search_query=old' };
  assert.equal((await h.send('SEARCH_SAVE', handoff)).ok, true);
  assert.equal(h.local.searchRequests, undefined);
  assert.equal(h.memory.searchRequests[1].text, 'Python');
  assert.equal((await h.send('SEARCH_GET', { page: 'new-page' }, 2, handoff.url)).data.searchRequest, null);
  assert.equal((await h.send('SEARCH_GET', { page: 'old-page' }, 1, handoff.url)).data.searchRequest, null);
  const restored = harness({ local: h.local, memory: h.memory });
  assert.equal((await restored.send('SEARCH_GET', { page: 'new-page' }, 1, handoff.url + '&themeRefresh=1')).data.searchRequest.text, 'Python');
  assert.equal((await h.send('SEARCH_GET', { page: 'new-page' }, 1, 'https://www.youtube.com/results?search_query=changed')).data.searchRequest, null);
  assert.deepEqual(h.memory.searchRequests, {});
});

test('search handoffs cross YouTube origins and expire on reset, user edits, stop and timeout', async () => {
  for (const cause of ['RESET', 'SEARCH_CLEAR', 'STOP', 'BROWSE', 'expire']) {
    const h = harness();
    const sessionId = (await h.send('START', { intent: 'Learn Python', expectedId: null })).data.session.id;
    assert.equal((await h.send('SEARCH_SAVE', { text: 'Python', sessionId, page: 'old-page', url: 'https://www.youtube.com/' }, 1, 'https://m.youtube.com/watch?v=one')).ok, true);
    assert.equal((await h.send('SEARCH_GET', { page: 'new-page' })).data.searchRequest.text, 'Python');
    if (cause === 'expire') h.advance(15001);
    else await h.send(cause, { sessionId, expectedId: sessionId });
    assert.equal((await h.send('SEARCH_GET', { page: 'new-page' })).data.searchRequest, null, cause);
    assert.deepEqual(h.memory.searchRequests, {}, cause);
  }
});

test('invalid search handoffs cannot use outside destinations or stale sessions', async () => {
  const h = harness();
  const sessionId = (await h.send('START', { intent: 'Learn Python', expectedId: null })).data.session.id;
  const handoff = { text: 'Python', sessionId, page: 'old-page', url: 'https://www.youtube.com/' };
  assert.equal((await h.send('SEARCH_SAVE', { ...handoff, url: 'https://example.com/' })).ok, false);
  assert.equal((await h.send('SEARCH_SAVE', { ...handoff, sessionId: 'old' })).ok, false);
  assert.equal((await h.send('SEARCH_SAVE', handoff, null)).ok, false);
  assert.equal((await h.send('SEARCH_SAVE', { ...handoff, text: 'a'.repeat(181) })).ok, false);
});
test('native search migration restores header/results once and preserves subsequent choices', async () => {
  const h = harness({ local: { settings: { hideHeader: true, hideSearchClutter: true, thumbnailMode: 'hidden' } } });
  const initial = (await h.send('GET')).data.settings;
  assert.equal(initial.hideHeader, false); assert.equal(initial.hideSearchClutter, false);
  assert.equal(initial.thumbnailMode, 'hidden'); assert.equal(initial.hideShorts, true);
  await h.send('SETTINGS', { settings: { hideHeader: true, hideSearchClutter: true } });
  const restored = (await harness({ local: h.local, memory: h.memory }).send('GET')).data.settings;
  assert.equal(restored.hideHeader, true); assert.equal(restored.hideSearchClutter, true);
});

test('Just browse uses one browse allowance, never tops it up, and refills only after it runs out', async () => {
  const h = harness();
  const start = (await h.send('BROWSE', { expectedId: null, home: true })).data;
  assert.equal(start.session.mode, 'browse'); assert.equal(start.session.casual, true);
  assert.equal(start.browseRemainingMs, 300000);
  assert.equal(start.homeRemainingMs, 0, 'casual browsing does not start a second homepage timer');
  const sessionId = start.session.id;
  await h.send('TICK', { active: true, sessionId }); h.advance(2000);
  const again = (await h.send('BROWSE', { expectedId: sessionId })).data;
  assert.equal(again.browseRemainingMs, 298000, 'running allowance is not topped up'); assert.equal(again.session.id, sessionId);
  assert.equal((await h.send('BROWSE', { expectedId: 'stale' })).ok, false);
  for (let i = 0; i < 160; i++) { await h.send('TICK', { active: true, sessionId }); h.advance(2000); }
  assert.equal((await h.send('GET')).data.browseRemainingMs, 0);
  // Regression: "Browse time is up" -> Just browse previously left the allowance at zero forever.
  const refilled = (await h.send('BROWSE', { expectedId: sessionId })).data;
  assert.equal(refilled.browseRemainingMs, 300000); assert.equal(refilled.session.id, sessionId);
  assert.equal((await h.send('FOCUS', { sessionId })).ok, false, 'a casual session has no intent to resume');
});

test('editing the intent keeps the session clock and break schedule', async () => {
  const h = harness();
  const id = (await h.send('START', { intent: 'Learn rust', expectedId: null })).data.session.id;
  for (let i = 0; i < 870; i++) { await h.send('TICK', { active: true, aligned: true, sessionId: id }); h.advance(2000); }
  const before = (await h.send('GET')).data.session;
  assert.equal((await h.send('EDIT_INTENT', { sessionId: id, expectedIntent: 'Stale intent', intent: 'Overwrite' })).ok, false, 'a stale editor cannot overwrite a newer intent');
  const edited = (await h.send('EDIT_INTENT', { sessionId: id, expectedIntent: 'Learn rust', intent: '  Learn   async rust ' })).data.session;
  assert.equal(edited.id, id); assert.equal(edited.intent, 'Learn async rust');
  assert.equal(edited.totalMs, before.totalMs); assert.equal(edited.intentMs, before.intentMs); assert.equal(edited.nextBreakAt, before.nextBreakAt);
  for (let i = 0; i < 40; i++) { await h.send('TICK', { active: true, aligned: true, sessionId: id }); h.advance(2000); }
  assert.equal((await h.send('GET')).data.session.breakDue, true, 'editing cannot postpone the break');
  assert.equal((await h.send('EDIT_INTENT', { sessionId: id, expectedIntent: 'Learn async rust', intent: 'Something else' })).ok, false, 'no edits while a break is due');
  assert.equal((await h.send('EDIT_INTENT', { sessionId: 'stale', expectedIntent: 'Learn async rust', intent: 'Something else' })).ok, false);
  const casual = harness(); const cid = (await casual.send('BROWSE', { expectedId: null })).data.session.id;
  assert.equal((await casual.send('EDIT_INTENT', { sessionId: cid, expectedIntent: 'Just browsing', intent: 'xy' })).ok, false, 'short intents are rejected');
  const focused = (await casual.send('EDIT_INTENT', { sessionId: cid, expectedIntent: 'Just browsing', intent: 'Study Python' })).data;
  assert.equal(focused.session.mode, 'focus'); assert.equal(focused.session.casual, false); assert.equal(focused.browseRemainingMs, 0);
});

test('closing an untracked tab never ends the session; hidden tabs stay tracked through throttling', async () => {
  const h = harness();
  const id = (await h.send('START', { intent: 'Learn rust', expectedId: null })).data.session.id;
  await h.send('TICK', { active: true, sessionId: id });
  h.advance(61000); h.remove(999); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal((await h.send('GET', {}, null)).data.session?.id, id);
  h.advance(120000); await h.send('TICK', { active: false, sessionId: id }); h.remove(999);
  assert.equal((await h.send('GET', {}, null)).data.session?.id, id);
  h.remove(1);
  assert.equal((await h.send('GET', {}, null)).data.session, null, 'closing the last tracked tab still ends it');
});

test('a due break is broadcast once, not on every heartbeat', async () => {
  const h = harness();
  const id = (await h.send('START', { intent: 'Learn rust', expectedId: null })).data.session.id;
  for (let i = 0; i < 905; i++) { await h.send('TICK', { active: true, sessionId: id }); h.advance(2000); }
  assert.equal((await h.send('GET')).data.session.breakDue, true);
  await new Promise(resolve => setTimeout(resolve, 10));
  const before = h.broadcasts.length;
  for (let i = 0; i < 10; i++) { await h.send('TICK', { active: false, sessionId: id }); h.advance(2000); }
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.broadcasts.length, before);
});

test('fresh installs keep defaults and record one defaults version', async () => {
  const h = harness();
  assert.deepEqual(JSON.parse(JSON.stringify((await h.send('GET')).data.settings)), { ...require('../extension/core.js').DEFAULTS });
  assert.equal(h.local.settings, undefined, 'defaults are not rewritten on a fresh install');
  assert.equal(h.local.defaultsVersion, 3);
  for (const key of ['distractionDefaultsVersion', 'nativeSearchVersion', 'browseDefaultsVersion']) assert.equal(key in h.local, false);
  const upgraded = harness({ local: { settings: { hideShorts: false, thumbnailMode: 'show' }, distractionDefaultsVersion: 1, nativeSearchVersion: 1, browseDefaultsVersion: 1 } });
  const settings = (await upgraded.send('GET')).data.settings;
  assert.equal(settings.hideShorts, false, 'already-migrated choices are kept'); assert.equal(settings.thumbnailMode, 'show');
  assert.equal(upgraded.local.defaultsVersion, 3); assert.equal('browseDefaultsVersion' in upgraded.local, false);
});

test('casual browse and focus preserve intent/session while excluding browsing from intent time', async () => {
  const h = harness();
  const initial = await h.send('BROWSE', { expectedId: null });
  assert.equal(initial.data.session.mode, 'browse'); assert.equal(initial.data.session.intent, 'Just browsing');
  const sessionId = initial.data.session.id;
  await h.send('HOME_BROWSE', { sessionId });
  await h.send('TICK', { active: true, aligned: true, homeBrowsing: true, sessionId });
  h.advance(2000);
  const elapsed = (await h.send('GET')).data;
  assert.equal(elapsed.session.intentMs, 0); assert.equal(elapsed.session.totalMs, 2000);
  assert.equal(elapsed.homeRemainingMs, 298000, 'casual browsing still consumes homepage allowance');
  await h.send('START', { intent: 'Study Python', expectedId: sessionId });
  const focus = (await h.send('GET')).data.session;
  await h.send('BROWSE', { expectedId: focus.id });
  const detour = (await h.send('GET')).data.session;
  assert.equal(detour.id, focus.id); assert.equal(detour.intent, 'Study Python');
  assert.equal((await h.send('FOCUS', { sessionId: 'stale' })).ok, false);
  const resumed = (await h.send('FOCUS', { sessionId: focus.id })).data.session;
  assert.equal(resumed.mode, 'focus'); assert.equal(resumed.id, focus.id);
  const restored = (await harness({ local: h.local, memory: h.memory }).send('GET')).data.session;
  assert.equal(restored.mode, 'focus');
  await h.send('STOP', { sessionId: focus.id });
  assert.equal((await h.send('FOCUS', { sessionId: focus.id })).ok, false);
  assert.equal((await h.send('BROWSE', { expectedId: 'stale' })).ok, false);
  assert.equal((await h.send('BROWSE', { expectedId: focus.id })).data.session.mode, 'browse');
});

test('homepage browse shares active time across tabs, pauses away, expires, and survives worker restarts', async () => {
  let h = harness();
  assert.equal((await h.send('HOME_BROWSE')).ok, false);
  const start = await h.send('START', { intent: 'Discover useful videos', expectedId: null });
  const sessionId = start.data.session.id;
  await h.send('SETTINGS', { settings: { homeMinutes: 2 } });
  assert.equal((await h.send('HOME_BROWSE', { sessionId: 'old' })).ok, false);
  assert.equal((await h.send('HOME_BROWSE', { sessionId })).data.homeRemainingMs, 120000);
  const activity = { sessionId, active: true, aligned: true, homeBrowsing: true };
  await h.send('TICK', activity); await h.send('TICK', activity, 2);
  h.advance(4000);
  assert.equal((await h.send('GET')).data.homeRemainingMs, 116000);
  assert.equal((await h.send('HOME_BROWSE', { sessionId })).data.homeRemainingMs, 116000, 'duplicate start cannot replenish time');
  await h.send('TICK', activity, 1, 'https://www.youtube.com/watch?v=lesson');
  await h.send('TICK', { ...activity, active: false, homeBrowsing: false }, 2);
  h.advance(4000);
  assert.equal((await h.send('GET')).data.homeRemainingMs, 116000, 'video time and background tabs do not count');
  h = harness({ local: h.local, memory: h.memory });
  assert.equal((await h.send('GET')).data.homeRemainingMs, 116000);
  await h.send('TICK', activity);
  for (let i = 0; i < 58; i++) {
    h.advance(2000); await h.send('TICK', { ...activity, active: false, homeBrowsing: false }, 2); await h.send('TICK', activity);
  }
  assert.equal((await h.send('GET')).data.homeRemainingMs, 0);
  assert(h.broadcasts.some(b => b.id === 2 && b.msg.data.homeRemainingMs === 0));
  await h.send('HOME_BROWSE', { sessionId });
  await h.send('HOME_HIDE', { sessionId });
  assert.equal((await h.send('GET')).data.homeRemainingMs, 0);
  await h.send('HOME_BROWSE', { sessionId });
  await h.send('STOP', { sessionId });
  assert.equal((await h.send('GET')).data.homeRemainingMs, 0);
  assert.equal((await h.send('HOME_BROWSE', { sessionId })).ok, false);
});

test('homepage duration changes apply to next browse and disabling limits clears the allowance', async () => {
  const h = harness();
  const sessionId = (await h.send('START', { intent: 'Discover useful videos', expectedId: null })).data.session.id;
  await h.send('HOME_BROWSE', { sessionId });
  assert.equal((await h.send('SETTINGS', { settings: { homeMinutes: 10 } })).data.homeRemainingMs, 300000);
  await h.send('SETTINGS', { settings: { hideHome: false } });
  assert.equal((await h.send('GET')).data.homeRemainingMs, 0);
  await h.send('SETTINGS', { settings: { hideHome: true } });
  assert.equal((await h.send('HOME_BROWSE', { sessionId })).data.homeRemainingMs, 600000);
});

test('existing installs migrate distraction preferences once and retain later choices', async () => {
  const h = harness({ local: { settings: { thumbnailMode: 'show', hideShorts: false, hideComments: false } } });
  const first = await h.send('GET');
  assert.equal(first.data.settings.thumbnailMode, 'hover');
  assert.equal(first.data.settings.hideShorts, true);
  assert.equal(first.data.settings.hideComments, false);
  await h.send('SETTINGS', { settings: { thumbnailMode: 'show', hideShorts: false } });
  const restarted = harness({ local: h.local });
  const next = await restarted.send('GET');
  assert.equal(next.data.settings.thumbnailMode, 'show');
  assert.equal(next.data.settings.hideShorts, false);
  const hidden = harness({ local: { settings: { thumbnailMode: 'hidden' } } });
  assert.equal((await hidden.send('GET')).data.settings.thumbnailMode, 'hidden');
  await h.send('RESET');
  await h.send('SETTINGS', { settings: { thumbnailMode: 'show', hideShorts: false } });
  assert.equal((await harness({ local: h.local }).send('GET')).data.settings.hideShorts, false);
});

test('worker serializes sessions, rejects stale starts, and broadcasts breaks across tabs', async () => {
  const h = harness();
  const started = await h.send('START', { intent: 'Study Python', expectedId: null });
  assert.equal(started.ok, true); const id = started.data.session.id;
  assert.equal((await h.send('START', { intent: 'Stale second tab', expectedId: null }, 2)).ok, false);
  await h.send('TICK', { active: true, aligned: true, sessionId: id });
  await h.send('TICK', { active: true, aligned: true, sessionId: id }, 2);
  for (let i = 0; i < 300; i++) { h.advance(6000); await h.send('TICK', { active: true, aligned: true, sessionId: id }); if (i % 5 === 0) await h.send('TICK', { active: false }, 2); }
  let result = await h.send('GET');
  assert.equal(result.data.session.breakDue, true); assert.equal(result.data.total.ms, 1800000);
  assert(h.broadcasts.some(b => b.id === 2 && b.msg.data.session.breakDue));
  await h.send('CONTINUE', { sessionId: 'stale' });
  assert.equal((await h.send('GET')).data.session.breakDue, true);
  result = await h.send('CONTINUE', { sessionId: id });
  assert.equal(result.data.session.nextBreakAt, 3600000); assert.equal(result.data.session.breakDue, false);
});
test('settings preserve unrelated values and interval changes reschedule from active time', async () => {
  const h = harness(); await h.send('START', { intent: 'Learn anatomy', expectedId: null });
  await Promise.all([h.send('SETTINGS', { settings: { hideComments: false } }, null), h.send('SETTINGS', { settings: { breakMinutes: 60 } }, null)]);
  const result = await h.send('GET');
  assert.equal(result.data.settings.hideComments, false); assert.equal(result.data.settings.breakMinutes, 60);
  assert.equal(result.data.session.nextBreakAt, 3600000);
  assert.equal(h.local.settings.hideComments, false);
});
test('an extension settings tab can query state but cannot report YouTube activity', async () => {
  const h = harness();
  assert.equal((await h.send('GET', {}, 5, 'chrome-extension://test-extension/options.html')).ok, true);
  assert.equal((await h.send('TICK', { active: true }, 5, 'chrome-extension://test-extension/options.html')).ok, false);
});
test('last tracked tab closure ends session; reset clears stored intent and totals', async () => {
  const h = harness(); await h.send('START', { intent: 'Learn anatomy', expectedId: null });
  await h.send('TICK', { active: true }); h.advance(2000); await h.send('TICK', { active: true });
  h.remove(1);
  assert.equal((await h.send('GET', {}, null)).data.session, null);
  await h.send('RESET', {}, null);
  assert.equal(h.local.total.ms, 0); assert.equal(h.memory.runtime.session, null); assert.equal(h.local.settings, undefined);
});

test('Chrome callback transport handles both successful and failed requests', async () => {
  const h = harness({ chrome: true });
  assert.equal((await h.send('GET')).ok, true);
  assert.equal((await h.send('UNKNOWN')).ok, false);
  assert.equal((await h.send('START', { intent: 'Study Python', expectedId: null })).ok, true);
});

test('rejects foreign senders and unsupported activity surfaces without mutating state', async () => {
  const h = harness();
  assert.equal(await h.send('RESET', {}, 1, 'https://www.youtube.com/', 'another-extension'), undefined);
  for (const url of ['http://www.youtube.com/', 'https://youtube.com.evil.test/', 'https://example.com/']) assert.equal(await h.send('TICK', { active: true }, 1, url), undefined);
  assert.equal((await h.send('TICK', { active: true }, null)).ok, false);
  assert.equal((await h.send('GET')).data.total.ms, 0);
});

test('reset clears active leases immediately; string booleans cannot report activity', async () => {
  const h = harness();
  await h.send('TICK', { active: true }); await h.send('RESET');
  h.advance(2000); assert.equal((await h.send('GET')).data.total.ms, 0);
  await h.send('TICK', { active: 'false', aligned: 'true' });
  h.advance(2000); assert.equal((await h.send('GET')).data.total.ms, 0);
});

test('stored runtime survives worker suspension and corrupt state recovers', async () => {
  const h = harness(); const start = await h.send('START', { intent: 'Study Python', expectedId: null });
  const resumed = harness({ local: h.local, memory: h.memory });
  assert.equal((await resumed.send('GET')).data.session.id, start.data.session.id);
  const corrupt = harness({ local: { settings: null, total: { day: 'bad', ms: 'invalid' } }, memory: { runtime: { session: {}, tabs: null } } });
  const result = await corrupt.send('GET'); assert.equal(result.ok, true); assert.equal(result.data.session, null); assert.equal(result.data.total.ms, 0);
});

test('a storage failure does not poison subsequent queued requests', async () => {
  const h = harness(); const set = h.api.storage.session.set;
  h.api.storage.session.set = async () => { throw new Error('Storage unavailable'); };
  assert.equal((await h.send('GET')).ok, false);
  h.api.storage.session.set = set;
  assert.equal((await h.send('GET')).ok, true);
});

test('failed settings writes preserve the previously saved preferences', async () => {
  const h = harness(); await h.send('GET');
  const set = h.api.storage.local.set;
  h.api.storage.local.set = async () => { throw new Error('Storage unavailable'); };
  assert.equal((await h.send('SETTINGS', { settings: { hideHome: false } })).ok, false);
  h.api.storage.local.set = set;
  assert.equal((await h.send('GET')).data.settings.hideHome, true);
});

test('stale stop and continue cannot change a newer or finished session', async () => {
  const h = harness(); const id = (await h.send('START', { intent: 'Study Python', expectedId: null })).data.session.id;
  assert.equal((await h.send('STOP', { sessionId: 'stale' })).data.session.stopped, false);
  await h.send('TICK', { active: true });
  for (let i = 0; i < 300; i++) { h.advance(6000); await h.send('TICK', { active: true }); }
  await h.send('STOP', { sessionId: id });
  const result = await h.send('CONTINUE', { sessionId: id });
  assert.equal(result.data.session.stopped, true); assert.equal(result.data.session.breakDue, true);
});

test('changing intervals cannot dismiss a due break', async () => {
  const h = harness(); await h.send('START', { intent: 'Study Python', expectedId: null });
  await h.send('TICK', { active: true });
  for (let i = 0; i < 300; i++) { h.advance(6000); await h.send('TICK', { active: true }); }
  const result = await h.send('SETTINGS', { settings: { breakMinutes: 60 } });
  assert.equal(result.data.session.breakDue, true); assert.equal(result.data.session.nextBreakAt, 1800000);
});

test('concurrent starts allow only one winner and suspended receivers cannot block requests', async () => {
  const h = harness(); await h.send('TICK', { active: false });
  h.api.tabs.sendMessage = () => new Promise(() => {});
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => h.send('START', { intent: `Study topic ${i}`, expectedId: null })));
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal((await h.send('GET')).ok, true);
});

test('saved searches persist, edit, reject stale edits, and clear on reset', async () => {
  const h = harness();
  const saved = await h.send('SAVE_SEARCH', { search: { label: 'My music', query: 'Hindi songs & live + 2026' } });
  assert.equal(saved.ok, true);
  const item = saved.data.savedSearches[0];
  assert.equal(item.query, 'Hindi songs & live + 2026');
  assert.equal((await harness({ local: h.local }).send('GET')).data.savedSearches[0].id, item.id);
  assert.equal((await h.send('SAVE_SEARCH', { search: { ...item, query: 'Other music' } })).data.savedSearches[0].query, 'Other music');
  assert.equal((await h.send('DELETE_SEARCH', { id: item.id })).data.savedSearches.length, 0);
  assert.equal((await h.send('SAVE_SEARCH', { search: item })).ok, false);
  for (let i = 0; i < 6; i++) assert.equal((await h.send('SAVE_SEARCH', { search: { label: 'Card ' + i, query: 'query ' + i } })).ok, true);
  assert.equal((await h.send('SAVE_SEARCH', { search: { label: 'Seventh', query: 'query' } })).ok, false);
  await h.send('RESET');
  assert.equal((await h.send('GET')).data.savedSearches.length, 0);
  assert.equal(h.local.savedSearches, undefined);
});

// ---- Video summaries (Gemini). A fake Gemini records every request; no real network.
const KEY_A = 'AIzaSyA' + 'a'.repeat(32), KEY_B = 'AIzaSyB' + 'b'.repeat(32);
const SETTINGS_PAGE = 'chrome-extension://test-extension/options.html';
function fakeGemini(replies) {
  const calls = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, key: init.headers['x-goog-api-key'], revision: init.headers['Api-Revision'], body });
    const reply = typeof replies === 'function' ? replies(calls.at(-1), calls.length) : replies[calls.length - 1];
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  };
  return { calls, fetch };
}
const goodSummary = { output_text: JSON.stringify({ summary: 'Covers Python basics: variables, strings, lists and loops.', key_points: [{ time: '4:39', point: 'Variables explained' }, { time: '14:37', point: 'For loops' }], fits_intent: 'yes', verdict: 'Watch it: a fast, practical start.' }) };

test('Gemini keys are kept out of snapshots and can only be changed from Settings', async () => {
  const h = harness();
  assert.equal(await h.send('SUMMARY_KEY_ADD', { key: KEY_A }), undefined, 'a YouTube tab cannot add keys');
  assert.equal(await h.send('SUMMARY_KEYS', {}, 1), undefined, 'a YouTube tab cannot read keys');
  assert.equal((await h.send('SUMMARY_KEY_ADD', { key: 'not-a-key' }, null, SETTINGS_PAGE)).ok, false);
  const added = (await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE)).data;
  assert.equal(JSON.stringify(added.summaryKeys), JSON.stringify(['AIza…aaaa']));
  assert.equal((await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE)).ok, false, 'no duplicates');
  const second = (await h.send('SUMMARY_KEY_ADD', { key: KEY_B }, null, SETTINGS_PAGE)).data;
  const snapshot = (await h.send('GET')).data;
  assert.equal(JSON.stringify(snapshot).includes('AIzaSy'), false, 'pages never receive key material');
  assert.equal(snapshot.summaries.ready, true);
  assert.equal(JSON.stringify(h.broadcasts).includes('AIzaSy'), false);
  assert.equal(JSON.stringify(h.local.geminiKeys), JSON.stringify([KEY_A, KEY_B]));
  assert.equal((await h.send('SUMMARY_KEY_REMOVE', { index: 0 }, null, SETTINGS_PAGE)).ok, false, 'removal must name the key shown');
  assert.equal(JSON.stringify((await h.send('SUMMARY_KEY_REMOVE', { index: 0, revision: second.summaryKeyRevision }, null, SETTINGS_PAGE)).data.summaryKeys), JSON.stringify(['AIza…bbbb']));
  // A second Settings tab still showing the old list removes the same primary key: nothing else is removed.
  const stale = await h.send('SUMMARY_KEY_REMOVE', { index: 0, revision: second.summaryKeyRevision }, null, SETTINGS_PAGE);
  assert.equal(stale.ok, false); assert.match(stale.error, /key list changed/);
  assert.equal(JSON.stringify(h.local.geminiKeys), JSON.stringify([KEY_B]));
  await h.send('RESET', {}, null, SETTINGS_PAGE);
  assert.equal(h.local.geminiKeys, undefined, 'reset deletes keys');
});

test('matching key masks never allow a stale list to remove another key after a worker restart', async () => {
  const h = harness();
  const other = KEY_A.replace('SyA', 'SyB');
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const { summaryKeys, summaryKeyRevision } = (await h.send('SUMMARY_KEY_ADD', { key: other }, null, SETTINGS_PAGE)).data;
  assert.equal(summaryKeys[0], summaryKeys[1]);
  const restarted = harness({ local: h.local, memory: h.memory });
  const remove = () => restarted.send('SUMMARY_KEY_REMOVE', { index: 0, revision: summaryKeyRevision }, null, SETTINGS_PAGE);
  assert.equal((await remove()).ok, true, 'a current list still works after the worker restarts');
  assert.equal((await remove()).ok, false, 'a stale list cannot remove the key with the same mask');
  assert.deepEqual(h.local.geminiKeys, [other]);
});

test('Summarize sends one small, fast request (Flash-Lite, minimal thinking, first 5 minutes) and caches the result', async () => {
  const gemini = fakeGemini(() => ({ status: 200, body: goodSummary }));
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  await h.send('START', { intent: 'Learn Python', expectedId: null });
  const result = (await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE', durationSeconds: 1179 })).data;
  assert.equal(result.summary, 'Covers Python basics: variables, strings, lists and loops.');
  assert.equal(result.fitsIntent, 'yes'); assert.equal(result.keyPoints.length, 2); assert.equal(result.clipped, true);
  assert.equal(gemini.calls.length, 1);
  const [call] = gemini.calls;
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(call.key, KEY_A); assert.equal(call.body.model, 'gemini-3.5-flash-lite');
  assert.equal(call.body.generation_config.thinking_level, 'minimal', 'least thinking for speed');
  assert.equal(result.model, 'Gemini 3.5 Flash-Lite'); assert(Number.isFinite(result.seconds), 'time taken is reported');
  const video = call.body.input.find(part => part.type === 'video');
  assert.equal(video.uri, 'https://www.youtube.com/watch?v=Js05B8Z1ivE');
  assert.equal(JSON.stringify(video.processing), JSON.stringify({ type: 'static', fps: 0.1, start_offset: '0s', end_offset: '300s' }));
  assert.match(call.body.input[0].text, /Learn Python/);
  assert.equal(call.body.response_format.mime_type, 'application/json');
  assert.equal((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE', durationSeconds: 1179 })).data.cached, true);
  assert.equal(gemini.calls.length, 1, 'cached: no second request');
  // Short videos are sent whole.
  await h.send('SUMMARIZE', { videoId: 'shortvid01', durationSeconds: 240 });
  assert.equal(gemini.calls.at(-1).body.input[1].processing.end_offset, undefined);
});

test('a quota-limited key falls back to the other model, then to the backup key', async () => {
  const quota = { status: 429, body: { error: { message: 'Resource has been exhausted (e.g. check quota).' } } };
  const gemini = fakeGemini(call => call.key === KEY_A ? quota : { status: 200, body: goodSummary });
  const h = harness({ fetch: gemini.fetch });
  for (const key of [KEY_A, KEY_B]) await h.send('SUMMARY_KEY_ADD', { key }, null, SETTINGS_PAGE);
  const result = (await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).data;
  // Quickest and most generous first: both Flash-Lite models (500/day), then the Flash models (20/day).
  assert.deepEqual(JSON.parse(JSON.stringify(gemini.calls.map(call => [call.key === KEY_A ? 'A' : 'B', call.body.model]))),
    [['A', 'gemini-3.5-flash-lite'], ['A', 'gemini-3.1-flash-lite'], ['A', 'gemini-3.8-flash'], ['A', 'gemini-3.6-flash'], ['B', 'gemini-3.5-flash-lite']]);
  assert.deepEqual(gemini.calls.map(call => call.body.generation_config.thinking_level), ['minimal', 'minimal', 'low', 'low', 'minimal'], 'Flash models have no minimal level');
  assert.equal(result.backupKey, true);
});

test('summary errors are explained: no key, no permission, rejected key, all quotas used, bad video', async () => {
  let h = harness();
  assert.match((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).error, /Add a Gemini API key/);
  h = harness({ granted: false, fetch: fakeGemini(() => ({ status: 200, body: goodSummary })).fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  assert.match((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).error, /Allow Curb to contact Google in Settings/);
  h = harness({ fetch: fakeGemini(() => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } })).fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  assert.match((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).error, /rejected your primary key/);
  h = harness({ fetch: fakeGemini(() => ({ status: 429, body: { error: { message: 'quota' } } })).fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  assert.equal((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).error, 'Your Gemini project hit its usage limit. Try again later.');
  assert.match((await h.send('SUMMARIZE', { videoId: '<script>' })).error, /not a YouTube video/);
  assert.match((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' }, 5, SETTINGS_PAGE)).error, /YouTube pages only/);
});

test('new AQ. auth keys are accepted, and Google error lists are explained, not shown as a bare status', async () => {
  const AQ_KEY = 'AQ.Ab8RN6' + 'x'.repeat(48);
  // Exact shapes Google returned to Curb's request with invalid keys.
  const invalidStandard = { status: 400, body: [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }] };
  const invalidAuth = { status: 401, body: [{ error: { code: 401, message: 'API key not valid. Please pass a valid API key.', status: 'UNAUTHENTICATED', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } }] };
  const badRequest = { status: 400, body: [{ error: { code: 400, message: 'Invalid value at input[1].processing', status: 'INVALID_ARGUMENT' } }] };
  for (const [reply, expected] of [[invalidStandard, 'Gemini rejected your primary key. Check it in Settings.'], [invalidAuth, 'Gemini rejected your primary key. Check it in Settings.'], [badRequest, 'Gemini has no supported model available for this key.']]) {
    const gemini = fakeGemini(() => reply);
    const h = harness({ fetch: gemini.fetch });
    const added = await h.send('SUMMARY_KEY_ADD', { key: `  ${AQ_KEY}  ` }, null, SETTINGS_PAGE);
    assert.equal(added.ok, true, 'AQ. keys are accepted and trimmed');
    assert.equal(JSON.stringify(added.data.summaryKeys), JSON.stringify(['AQ.A…xxxx']));
    assert.equal(h.local.geminiKeys[0], AQ_KEY, 'the full key is stored unchanged');
    const result = await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
    assert.equal(result.error, expected);
    assert.equal(gemini.calls[0].key, AQ_KEY, 'the full key is sent in x-goog-api-key');
  }
});

test('provider failures have short explanations specific to each failure', async () => {
  const cases = [
    [{ status: 503, body: [{ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }] }, 'Gemini is busy. Try again shortly.'],
    [{ status: 404, body: [{ error: { code: 404, message: 'models/gemini-3.5-flash-lite is not found for API version v1beta', status: 'NOT_FOUND' } }] }, 'Gemini has no supported model available for this key.'],
    [{ status: 400, body: [{ error: { code: 400, message: 'Video is private or unavailable.', status: 'INVALID_ARGUMENT' } }] }, 'Gemini can only summarize available public videos.'],
    [{ status: 500, body: null }, 'Gemini is busy. Try again shortly.'],
  ];
  for (const [reply, expected] of cases) {
    const gemini = fakeGemini(() => reply);
    const h = harness({ fetch: gemini.fetch });
    await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
    const { error } = await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
    assert.equal(error, expected);
  }
  // A video problem stops at once instead of burning the other model and backup keys.
  const gemini = fakeGemini(() => ({ status: 400, body: [{ error: { code: 400, message: 'Video is private or unavailable.' } }] }));
  const h = harness({ fetch: gemini.fetch });
  for (const key of [KEY_A, KEY_B]) await h.send('SUMMARY_KEY_ADD', { key }, null, SETTINGS_PAGE);
  await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
  assert.equal(gemini.calls.length, 1);
  // If one model is busy and others are over quota, report the quota.
  const mixed = fakeGemini(call => call.body.model === 'gemini-3.5-flash-lite'
    ? { status: 503, body: [{ error: { message: 'overloaded', status: 'UNAVAILABLE' } }] }
    : { status: 429, body: [{ error: { message: 'You exceeded your current quota. Please retry in 41s.', status: 'RESOURCE_EXHAUSTED' } }] });
  const m = harness({ fetch: mixed.fetch });
  await m.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  assert.equal((await m.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).error, 'Your Gemini project hit its usage limit. Try again later.');
});

test('a stalled Gemini never leaves the viewer waiting: each attempt is cut off and the reason is given', async () => {
  const calls = [];
  // Never answers; only gives up when Curb aborts the request.
  const fetch = (url, init) => new Promise((resolve, reject) => {
    calls.push(JSON.parse(init.body).model);
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const h = harness({ fetch, limits: { attempt: 60, total: 1000, wholeAttempt: 60, wholeTotal: 1000 } });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const started = performance.now();
  const { error } = await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
  const elapsed = performance.now() - started;
  assert.equal(error, 'Gemini took too long. Try again.');
  assert.deepEqual([...calls], ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'], 'each model gets one short chance');
  assert(elapsed < 1000, `gave up quickly (${Math.round(elapsed)} ms)`);
});

test('streamed answers reach the tab as they are written, verdict first, and end in the full result', async () => {
  const answer = JSON.stringify({ verdict: 'Watch it: a clear start.', fits_intent: 'yes', summary: 'Installs Python and VS Code.', key_points: [{ time: '0:22', point: 'Install' }, { time: '1:04', point: 'VS Code' }] });
  const pieces = [answer.slice(0, 14), answer.slice(14, 40), answer.slice(40, 90), answer.slice(90)];
  const sse = ['event: interaction.created\ndata: {"id":"i1"}\n\n',
    'event: step.delta\ndata: {"index":0,"delta":{"type":"thought_summary","content":{"text":"thinking"}}}\n\n',
    ...pieces.map(piece => `event: step.delta\ndata: ${JSON.stringify({ index: 1, delta: { type: 'text', text: piece }, event_type: 'step.delta' })}\n\n`),
    'event: done\ndata: [DONE]\n\n'].join('');
  // Delivered in awkward chunks: mid-event and mid-word.
  const bytes = new TextEncoder().encode(sse), chunks = [];
  for (let at = 0; at < bytes.length; at += 37) chunks.push(bytes.slice(at, at + 37));
  const sent = [];
  const fetch = async (url, init) => { sent.push(JSON.parse(init.body)); let i = 0; return { ok: true, status: 200,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'text/event-stream' : null },
    body: { getReader: () => ({ read: async () => { await new Promise(resolve => setTimeout(resolve, 2)); return i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }; } }) } }; };
  const h = harness({ fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const result = (await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE', requestId: 'r-1' })).data;
  assert.equal(sent[0].stream, require('../extension/summary.js').STREAM_ANSWERS ? true : undefined, 'asks for a stream only when enabled');
  assert.equal(result.verdict, 'Watch it: a clear start.'); assert.equal(result.keyPoints.length, 2);
  const updates = h.broadcasts.filter(b => b.msg.type === 'SUMMARY_PROGRESS');
  assert(updates.length >= 2, `several live updates (${updates.length})`);
  assert(updates.every(b => b.id === 1 && b.msg.requestId === 'r-1'), 'only the asking tab, tagged with its request');
  assert(updates[0].msg.partial.verdict && !updates[0].msg.partial.summary, 'the verdict shows before the summary');
  assert.equal(updates.at(-1).msg.partial.keyPoints.length, 2);
  assert(!JSON.stringify(updates).includes('thinking'), 'thinking text is never shown');
});

test('a model that rejects one of Curb\'s settings passes to the next model instead of ending the summary', async () => {
  const gemini = fakeGemini(call => call.body.model === 'gemini-3.5-flash-lite'
    ? { status: 400, body: [{ error: { code: 400, message: 'thinking_level "minimal" is not supported for this model.', status: 'INVALID_ARGUMENT' } }] }
    : { status: 200, body: goodSummary });
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const result = (await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).data;
  assert.equal(result.model, 'Gemini 3.1 Flash-Lite');
  assert.equal(gemini.calls.length, 2);
});

// ---- 1.0.3 release-blocker regressions ----
const YT = 'https://www.youtube.com/';
// A fetch that answers only when the test says so; records each call.
function heldGemini() {
  const calls = [], waiting = [];
  const fetch = (url, init) => new Promise((resolve, reject) => {
    const call = { key: init.headers['x-goog-api-key'], body: JSON.parse(init.body) };
    calls.push(call);
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    waiting.push(reply => resolve({ ok: reply.status === 200, status: reply.status, json: async () => reply.body }));
  });
  const until = async n => { for (let i = 0; i < 200 && waiting.length < n; i++) await new Promise(r => setTimeout(r, 5)); assert(waiting.length >= n, `expected ${n} outbound calls`); };
  return { calls, waiting, fetch, until };
}

test('Clear local data stops a running summary: no further request, no old result written back', async () => {
  const gemini = heldGemini();
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  await h.send('START', { intent: 'Learn Python', expectedId: null });
  const pending = h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE', durationSeconds: 1179 });
  await gemini.until(1);
  let releaseClear;
  const clear = h.api.storage.session.clear;
  h.api.storage.session.clear = () => new Promise(resolve => { releaseClear = () => resolve(clear()); });
  const reset = h.send('RESET', {}, null, SETTINGS_PAGE);
  while (!releaseClear) await new Promise(resolve => setImmediate(resolve));
  gemini.waiting[0]({ status: 429, body: { error: { message: 'quota exhausted' } } });
  const result = await pending;
  releaseClear();
  await reset;
  assert.equal(result.ok, false); assert.match(result.error, /Local data was cleared/);
  assert.equal(gemini.calls.length, 1, 'no request with the deleted key after reset');
  assert.equal(h.memory.summaryCache, undefined, 'the old result is never written back');
  assert.equal(h.local.geminiKeys, undefined);
});

test('a reply that arrives after Clear local data is discarded', async () => {
  const gemini = heldGemini();
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const pending = h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
  await gemini.until(1);
  // Reset lands while the (already received) reply is being handled.
  const reset = h.send('RESET', {}, null, SETTINGS_PAGE);
  gemini.waiting[0]({ status: 200, body: goodSummary });
  await reset;
  assert.equal((await pending).ok, false);
  assert.equal(h.memory.summaryCache, undefined);
});

test('a key removed in Settings while a summary runs is not used for later attempts', async () => {
  const gemini = heldGemini();
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const { summaryKeyRevision } = (await h.send('SUMMARY_KEY_ADD', { key: KEY_B }, null, SETTINGS_PAGE)).data;
  const pending = h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
  await gemini.until(1);
  assert.equal((await h.send('SUMMARY_KEY_REMOVE', { index: 1, revision: summaryKeyRevision }, null, SETTINGS_PAGE)).ok, true);
  // Every model is over quota on the primary key; the removed backup must not be tried.
  for (let i = 0; i < 4; i++) { await gemini.until(i + 1); gemini.waiting[i]({ status: 429, body: { error: { message: 'quota exhausted' } } }); }
  assert.equal((await pending).ok, false);
  assert.equal(gemini.calls.filter(call => call.key === KEY_B).length, 0);
});

test('requests opt out of Gemini storage and no attempt outlives Chrome\'s 30 s fetch limit', () => {
  const summary = require('../extension/summary.js');
  const body = summary.request({ videoId: 'Js05B8Z1ivE', intent: '', clip: true, durationSeconds: 0 }, summary.MODELS[0]);
  assert.equal(body.store, false);
  assert(summary.LIMITS_MS.attempt < 30000 && summary.LIMITS_MS.wholeAttempt < 30000);
});

test('private-window summaries never enter or read the shared cache', async () => {
  const gemini = fakeGemini(() => ({ status: 200, body: goodSummary }));
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const priv = await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' }, 2, YT, 'test-extension', { incognito: true });
  assert.equal(priv.ok, true);
  assert.equal(Object.keys(h.memory.summaryCache || {}).length, 0, 'nothing cached from a private tab');
  const regular = await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
  assert.equal(regular.data.cached, undefined, 'a regular tab cannot reuse a private result');
  assert.equal(gemini.calls.length, 2);
  // And a private tab does not read the regular cache either.
  await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' }, 2, YT, 'test-extension', { incognito: true });
  assert.equal(gemini.calls.length, 3);
});

test('simultaneous requests for the same video and intent make one Gemini call', async () => {
  const gemini = heldGemini();
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const first = h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' }, 1);
  const second = h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' }, 2);
  await gemini.until(1);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(gemini.calls.length, 1);
  gemini.waiting[0]({ status: 200, body: goodSummary });
  assert.equal((await first).data.summary, (await second).data.summary);
  assert.equal(gemini.calls.length, 1);
});

test('the cache is keyed by the window actually analysed, not just the clip setting', async () => {
  const gemini = fakeGemini(() => ({ status: 200, body: goodSummary }));
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  assert.equal((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).data.clipped, true, 'unknown length: clipped');
  const whole = (await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE', durationSeconds: 240 })).data;
  assert.equal(whole.clipped, false); assert.equal(whole.cached, undefined, 'a short whole video is not served the clipped result');
  assert.equal(gemini.calls.length, 2);
  assert.equal(gemini.calls[1].body.input[1].processing.end_offset, undefined);
});

test('an empty or unreadable 200 reply passes to the next model', async () => {
  const gemini = fakeGemini([{ status: 200, body: {} }, { status: 200, body: goodSummary }]);
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const result = await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' });
  assert.equal(result.ok, true, result.error);
  assert.equal(gemini.calls.length, 2);
  assert.equal(result.data.model, 'Gemini 3.1 Flash-Lite');
});

test('timestamps outside the analysed window are not linked', async () => {
  const gemini = fakeGemini(() => ({ status: 200, body: goodSummary }));
  const h = harness({ fetch: gemini.fetch });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  const clipped = (await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE', durationSeconds: 1179 })).data;
  assert.equal(JSON.stringify(clipped.keyPoints.map(item => item.time)), JSON.stringify(['4:39', '']), '14:37 is outside a five-minute clip');
  assert.equal(JSON.stringify(clipped.keyPoints.map(item => item.point)), JSON.stringify(['Variables explained', 'For loops']), 'the point itself is kept');
  const short = (await h.send('SUMMARIZE', { videoId: 'shortvid01', durationSeconds: 200 })).data;
  assert.equal(JSON.stringify(short.keyPoints.map(item => item.time)), JSON.stringify(['', '']), 'beyond a known length');
});

test('Firefox summaries require the optional data-collection consent', async () => {
  const gemini = fakeGemini(() => ({ status: 200, body: goodSummary }));
  const h = harness({ fetch: gemini.fetch });
  let granted = [];
  h.api.permissions.getAll = async () => ({ origins: [], permissions: [], data_collection: granted });
  await h.send('SUMMARY_KEY_ADD', { key: KEY_A }, null, SETTINGS_PAGE);
  assert.match((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).error, /Allow Curb to contact Google in Settings/);
  assert.equal(gemini.calls.length, 0);
  granted = ['browsingActivity', 'websiteActivity'];
  assert.equal((await h.send('SUMMARIZE', { videoId: 'Js05B8Z1ivE' })).ok, true);
});
