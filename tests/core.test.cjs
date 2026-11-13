const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');
const base = new Date(2026, 9, 7, 12).getTime();
test('settings only accept known booleans and supported intervals', () => {
  const s = C.settings({ breakMinutes: 1, hideHome: 'false', secret: 'key', hideRelated: false });
  assert.equal(s.breakMinutes, 30); assert.equal(s.hideHome, true); assert.equal(s.hideRelated, false); assert(!('secret' in s));
  assert.equal(C.settings({ breakMinutes: 60 }).breakMinutes, 60);
});
test('timers format minutes and hours with stable precision', () => {
  assert.equal(C.format(0), '0:00'); assert.equal(C.format(65001), '1:05'); assert.equal(C.format(3661000), '1:01:01'); assert.equal(C.format(-500), '0:00');
});

test('session display changes only at whole minutes and rolls into hours', () => {
  for (const [ms, expected] of [[0, '0h 00m'], [59999, '0h 00m'], [60000, '0h 01m'], [3599999, '0h 59m'], [3600000, '1h 00m'], [3900999, '1h 05m'], [-10, '0h 00m'], [Infinity, '0h 00m']]) assert.equal(C.formatSession(ms), expected);
});

test('fullscreen pill defaults on and accepts only explicit boolean preferences', () => {
  assert.equal(C.settings().fullscreenPill, true);
  assert.equal(C.settings({ fullscreenPill: false }).fullscreenPill, false);
  assert.equal(C.settings({ fullscreenPill: 'false' }).fullscreenPill, true);
});

test('homepage allowance validates settings, restores safely and pauses during session breaks', () => {
  for (const homeMinutes of [2, 5, 10]) assert.equal(C.settings({ homeMinutes }).homeMinutes, homeMinutes);
  for (const homeMinutes of [0, -1, '5', null, 60]) assert.equal(C.settings({ homeMinutes }).homeMinutes, 5);
  const s = C.freshState(base); C.startSession(s, 'Curated discovery', 30, base);
  s.homeRemainingMs = 300000;
  s.tabs[1] = { at: base, active: true, aligned: true, homeBrowsing: true, sessionId: s.session.id };
  s.session.breakDue = true;
  C.advance(s, base + 2000, C.DEFAULTS);
  assert.equal(s.homeRemainingMs, 300000);
  assert.equal(C.restore(s, null, base + 2000).homeRemainingMs, 300000);
  assert.equal(C.restore({ ...s, homeRemainingMs: 9999999 }, null, base + 2000).homeRemainingMs, 0);
  C.startSession(s, 'A new intention', 30, base + 2000);
  assert.equal(s.homeRemainingMs, 0);
});

test('thumbnail modes validate and missing settings default to hover', () => {
  assert.equal(C.settings({ hideHome: false }).thumbnailMode, 'hover');
  for (const thumbnailMode of ['show', 'hover', 'hidden']) assert.equal(C.settings({ thumbnailMode }).thumbnailMode, thumbnailMode);
  for (const thumbnailMode of [true, false, null, 'invalid', 1, {}]) assert.equal(C.settings({ thumbnailMode }).thumbnailMode, 'hover');
});
test('video navigation normalizes watch, live and shorts without trusting other sites', () => {
  assert.equal(C.videoKey('https://www.youtube.com/watch?v=abc&t=20'), 'abc');
  assert.equal(C.videoKey('https://m.youtube.com/shorts/abc'), 'abc');
  assert.equal(C.videoKey('https://youtube.com/live/abc'), 'abc');
  assert.equal(C.videoKey('https://evil.test/watch?v=abc'), '');
  assert.equal(C.videoKey('garbage'), '');
});
test('multiple overlapping tabs count once; intent requires same-session confirmation', () => {
  const s = C.freshState(base); C.startSession(s, 'Study Python', 30, base);
  s.tabs = { 1: { at: base, active: true, aligned: true, sessionId: s.session.id }, 2: { at: base, active: true, aligned: true, sessionId: s.session.id } };
  C.advance(s, base + 2000, C.DEFAULTS);
  assert.equal(s.total.ms, 2000); assert.equal(s.session.intentMs, 2000); assert.equal(s.session.totalMs, 2000);
  s.tabs[1].sessionId = 'old'; s.tabs[2].aligned = false;
  C.advance(s, base + 4000, C.DEFAULTS);
  assert.equal(s.total.ms, 4000); assert.equal(s.session.intentMs, 2000);
});
test('unattended tabs and suspended computers do not accrue unlimited time', () => {
  const s = C.freshState(base); C.startSession(s, 'Read science', 30, base);
  s.tabs = { 1: { at: base, active: true, aligned: true, sessionId: s.session.id } };
  C.advance(s, base + 3600000, C.DEFAULTS);
  assert.equal(s.total.ms, 0); assert.equal(s.session, null);
});
test('breaks trigger at threshold and stop intent time until resumed', () => {
  const s = C.freshState(base); C.startSession(s, 'Study biology', 30, base);
  s.session.totalMs = 1799000;
  s.tabs[1] = { at: base, active: true, aligned: true, sessionId: s.session.id };
  C.advance(s, base + 2000, C.DEFAULTS);
  assert.equal(s.session.breakDue, true);
  C.advance(s, base + 4000, C.DEFAULTS);
  assert.equal(s.session.intentMs, 1000); assert.equal(s.session.totalMs, 1803000);
});
test('finished sessions retain their summary but today total continues', () => {
  const s = C.freshState(base); C.startSession(s, 'Study biology', 30, base); s.session.stopped = true;
  s.tabs[1] = { at: base, active: true, aligned: true, sessionId: s.session.id };
  C.advance(s, base + 2000, C.DEFAULTS);
  assert.equal(s.total.ms, 2000); assert.equal(s.session.totalMs, 0); assert.equal(s.session.intentMs, 0);
});
test('daily totals roll over without retaining historical records', () => {
  const s = C.freshState(base); s.total.ms = 300000;
  C.advance(s, base + 86400000, C.DEFAULTS);
  assert.equal(s.total.ms, 0); assert.equal(s.total.day, C.dayKey(base + 86400000));
});
test('a heartbeat crossing midnight credits only the new day portion to today', () => {
  const before = new Date(2026, 9, 7, 23, 59, 59).getTime();
  const s = C.freshState(before); C.startSession(s, 'Study biology', 30, before);
  s.tabs[1] = { at: before, active: true, aligned: true, sessionId: s.session.id };
  C.advance(s, before + 2000, C.DEFAULTS);
  assert.equal(s.total.ms, 1000); assert.equal(s.session.totalMs, 2000);
});
test('previews accurately label metadata rather than inventing summaries', () => {
  assert.match(C.preview({ title: 'Python', channel: 'Teacher' }).source, /^Video metadata$/);
  assert.match(C.preview({ description: 'An introduction to Python.' }).source, /^Description excerpt$/);
});
test('intent input is bounded and cannot be empty', () => {
  const s = C.freshState(base);
  assert.throws(() => C.startSession(s, '  ', 30, base));
  C.startSession(s, 'x'.repeat(300), 60, base); assert.equal(s.session.intent.length, 180); assert.equal(s.session.nextBreakAt, 3600000);
});

test('all controls have unique keys and round-trip both boolean values', () => {
  assert.equal(C.CONTROLS.length, 24);
  assert.equal(new Set(C.CONTROLS.map(c => c[0])).size, 24);
  for (const [key] of C.CONTROLS) for (const value of [true, false]) assert.equal(C.settings({ [key]: value })[key], value);
  for (const value of [null, false, 'settings', [], 42]) assert.deepEqual(C.settings(value), C.DEFAULTS);
});

test('every preset can start a session; non-text intent and unsupported intervals are bounded', () => {
  for (const preset of C.PRESETS) {
    const s = C.freshState(base); C.startSession(s, preset, 60, base);
    assert.equal(s.session.intent, preset); assert.equal(s.session.casual, false);
  }
  for (const value of [null, undefined, {}, ['abc'], 123]) assert.throws(() => C.startSession(C.freshState(base), value, 30, base));
  for (const interval of [0, -1, Infinity, '60', 100000]) {
    const s = C.freshState(base); C.startSession(s, 'A purpose', interval, base);
    assert.equal(s.session.nextBreakAt, 1800000);
  }
});

test('previews cap every field and handle missing metadata and literal markup', () => {
  const p = C.preview({ title: '<script>' + 'x'.repeat(1000), description: 'y'.repeat(1000) });
  assert.equal(p.title.length, 160); assert.equal(p.text.length, 210);
  const m = C.preview({ channel: 'c'.repeat(1000), duration: 'd'.repeat(1000) });
  assert.equal(m.text.length, 103);
  assert.match(C.preview().text, /No description/);
  assert.equal(C.clean({ toString() { throw new Error('Must not coerce objects'); } }), '');
  for (const n of [Infinity, -Infinity, NaN, '123']) assert.equal(C.format(n), '0:00');
});

test('video keys reject unsupported origins and schemes', () => {
  for (const url of ['http://youtube.com/watch?v=a', 'https://youtube.com.evil.test/watch?v=a', 'https://evil.test@youtube.com.evil.test/watch?v=a', 'https://www.youtube.com/embed/a', 'https://www.youtube.com/watch']) assert.equal(C.videoKey(url), '');
});

test('stale leases expire at six seconds and idle sessions at twenty minutes', () => {
  const s = C.freshState(base); C.startSession(s, 'Study Python', 30, base);
  s.tabs[1] = { at: base, active: true, aligned: true, sessionId: s.session.id };
  C.advance(s, base + 6000); assert.equal(s.total.ms, 6000);
  C.advance(s, base + 8000); assert.equal(s.total.ms, 6000);
  C.advance(s, base + 6000 + C.LIMITS.idleMs); assert.equal(s.session, null); assert.deepEqual(s.tabs, {});
});

test('backward clock jumps discard activity leases without subtracting or double counting', () => {
  const s = C.freshState(base); C.startSession(s, 'Study Python', 30, base);
  s.tabs[1] = { at: base, active: true, aligned: true, sessionId: s.session.id };
  C.advance(s, base + 2000); C.advance(s, base - 1000); C.advance(s, base + 2000);
  assert.equal(s.total.ms, 2000); assert.equal(s.session.intentMs, 2000); assert.deepEqual(s.tabs, {});
});

test('sixty-minute breaks trigger exactly at their threshold', () => {
  const s = C.freshState(base); C.startSession(s, 'Study Python', 60, base);
  s.session.totalMs = 3598000;
  s.tabs[1] = { at: base, active: true, aligned: true, sessionId: s.session.id };
  C.advance(s, base + 1999); assert.equal(s.session.breakDue, false);
  C.advance(s, base + 2000); assert.equal(s.session.breakDue, true); assert.equal(s.session.intentMs, 2000);
});

test('stored state is sanitized and corrupt state recovers without retaining unknown data', () => {
  for (const runtime of [null, {}, { total: { day: C.dayKey(base), ms: -1 } }, { lastTick: 'bad', session: {} }]) {
    const restored = C.restore(runtime, null, base);
    assert.equal(restored.session, null); assert.equal(restored.total.ms, 0);
  }
  const s = C.freshState(base); C.startSession(s, 'Study Python', 30, base);
  s.secret = 'discard'; s.session.secret = 'discard';
  s.tabs = { 1: { at: base, active: true, aligned: true, sessionId: s.session.id }, 2: { at: base - C.LIMITS.tabRetentionMs - 1 }, 3: { at: base + 1 }, bad: { at: base } };
  const restored = C.restore(s, null, base);
  assert.equal(restored.secret, undefined); assert.equal(restored.session.secret, undefined);
  assert.deepEqual(Object.keys(restored.tabs), ['1']);
  assert.equal(C.restore(null, { day: C.dayKey(base), ms: Infinity }, base).total.ms, 0);
  assert.equal(C.restore(null, { day: C.dayKey(base), ms: 1e10 }, base).total.ms, C.LIMITS.dayMs);
});

test('long multi-tab activity preserves timer invariants through breaks and pauses', () => {
  const s = C.freshState(base); C.startSession(s, 'Study Python', 30, base);
  let now = base;
  for (let i = 0; i < 5000; i++) {
    const before = s.total.ms;
    const delta = (i % 7 + 1) * 250;
    s.tabs[i % 11] = { at: now, active: i % 3 !== 0, aligned: i % 5 !== 0, sessionId: s.session.id };
    now += delta; C.advance(s, now);
    assert(s.total.ms >= before && s.total.ms - before <= delta);
    assert(s.session.intentMs <= s.session.totalMs);
    if (s.session.breakDue) { s.session.breakDue = false; s.session.nextBreakAt = s.session.totalMs + 1800000; }
  }
});

test('saved searches preserve query text and reject corrupt or excessive cards', () => {
  const one = { id: 'one', label: 'My music', query: 'Hindi songs & live + 2026' };
  assert.deepEqual(C.savedSearches([one]), [one]);
  assert.deepEqual(C.savedSearches([one, one, { ...one, id: 'bad id' }, { ...one, id: 'two', query: '' }]), [one]);
  assert.equal(C.savedSearches(Array.from({ length: 9 }, (_, i) => ({ ...one, id: String(i) }))).length, 6);
  assert.deepEqual(C.savedSearches(null), []);
});

test('casual browsing allowance stops at a break threshold within a heartbeat', () => {
  const state = C.freshState(base);
  C.startSession(state, 'Just browsing', 30, base, 'browse');
  state.session.totalMs = state.session.nextBreakAt - 500;
  state.browseRemainingMs = 3000;
  state.tabs[1] = { at: base, active: true, aligned: false, sessionId: state.session.id };
  C.advance(state, base + 2000);
  assert.equal(state.session.breakDue, true);
  assert.equal(state.browseRemainingMs, 2500);
});
