/* Shared, dependency-free logic. No network access. */
(function (root) {
  'use strict';
  const STORE_BUILD = false;
  const LIMITS = Object.freeze({ intent: 180, title: 160, description: 210, channel: 70, duration: 30,
    heartbeatMs: 2000, leaseMs: 6000, idleMs: 20 * 60000, browseMs: 5 * 60000,
    // Hidden tabs can be throttled to one heartbeat per minute; keep them tracked well beyond that.
    tabRetentionMs: 5 * 60000,
    checkpointMs: 15000, previewMs: 14000, dayMs: 25 * 60 * 60000 });
  const CONTROLS = [
    ['hideHome', 'Limit homepage browsing', true, 'Feeds'],
    ['hideSidebar', 'Hide entire video sidebar', false, 'Feeds'],
    ['hideRelated', 'Hide related videos', true, 'Feeds'],
    ['hideShorts', 'Hide Shorts', true, 'Feeds'],
    ['hideMixes', 'Hide mix playlists', true, 'Feeds'],
    ['hideSearchClutter', 'Hide extra search recommendations', false, 'Feeds'],
    ['hideExplore', 'Hide Explore and trending', true, 'Navigation'],
    ['hideMore', 'Hide More from YouTube', true, 'Navigation'],
    ['hideSubscriptions', 'Hide subscriptions link', false, 'Navigation'],
    ['redirectSubscriptions', 'Redirect subscriptions to homepage', false, 'Navigation'],
    ['hideHeader', 'Hide YouTube header and search', false, 'Navigation'],
    ['hideNotifications', 'Hide notification bell', true, 'Navigation'],
    ['hideComments', 'Hide comments', true, 'Watch page'],
    ['hideLiveChat', 'Hide live chat', true, 'Watch page'],
    ['hidePlaylist', 'Hide playlist panel', false, 'Watch page'],
    ['hideEndWall', 'Hide end-screen video wall', true, 'Watch page'],
    ['hideEndCards', 'Hide end-screen cards', true, 'Watch page'],
    ['hideMerch', 'Hide merchandise and offers', true, 'Watch page'],
    ['hideInfo', 'Hide all video information', false, 'Video details'],
    ['hideButtons', 'Hide video action buttons', false, 'Video details'],
    ['hideChannel', 'Hide channel and subscribe button', false, 'Video details'],
    ['hideDescription', 'Hide video description', false, 'Video details'],
    ['disableAutoplay', 'Disable autoplay', true, 'Playback'],
    ['hideAnnotations', 'Hide info cards', true, 'Playback']
  ];
  const PRESETS = Object.freeze(['Practice programming', 'Study math & science', 'Learn a language', 'Build a practical skill',
    'Follow a course', 'Research a question', 'Listen to music', 'Check something quickly']);
  // Casual sessions are flagged explicitly; this label is display text only.
  const BROWSE_INTENT = 'Just browsing';
  const DEFAULTS = Object.freeze({ breakMinutes: 30, homeMinutes: 5, localPreviews: true, fullscreenPill: true, thumbnailMode: STORE_BUILD ? 'hidden' : 'hover',
    summaryClip: true, ...(STORE_BUILD ? { summaryIntent: false } : {}),
    ...Object.fromEntries(CONTROLS.map(([key, , value]) => [key, value])) });
  function settings(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (key === 'breakMinutes') result[key] = input[key] === 60 ? 60 : 30;
      else if (key === 'homeMinutes') result[key] = [2, 5, 10].includes(input[key]) ? input[key] : 5;
      else if (key === 'thumbnailMode') result[key] = ['show', 'hidden', 'hover'].includes(input[key]) ? input[key] : DEFAULTS.thumbnailMode;
      else if (typeof input[key] === 'boolean') result[key] = input[key];
    }
    return result;
  }
  function clean(value, max = LIMITS.intent) { return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''; }
  function savedSearches(input) {
    if (!Array.isArray(input)) return [];
    const ids = new Set();
    return input.filter(item => item && typeof item.id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(item.id) &&
      typeof item.label === 'string' && item.label.trim().length >= 3 && item.label.trim().length <= 48 &&
      typeof item.query === 'string' && item.query.trim().length > 0 && item.query.trim().length <= 180 &&
      !ids.has(item.id) && ids.add(item.id)).slice(0, 6).map(({ id, label, query }) => ({ id, label: label.trim(), query: query.trim() }));
  }
  function format(ms) {
    const total = Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 1000);
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function formatSession(ms) {
    const minutes = Math.floor((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 60000);
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  function dayKey(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function videoKey(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return '';
      if (!['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)) return '';
      if (u.pathname === '/watch') return clean(u.searchParams.get('v'), 80);
      return clean(u.pathname.match(/^\/(?:shorts|live)\/([^/?]+)/)?.[1], 80);
    } catch { return ''; }
  }
  function preview({ title, channel, description, duration } = {}) {
    const detail = clean(description, LIMITS.description);
    return { title: clean(title, LIMITS.title) || 'Video details unavailable',
      text: detail || [clean(channel, LIMITS.channel), clean(duration, LIMITS.duration)].filter(Boolean).join(' · ') || 'No description available.',
      source: detail ? 'Description excerpt' : 'Video metadata' };
  }
  function freshState(now = Date.now()) {
    return { session: null, browseRemainingMs: 0, homeRemainingMs: 0, tabs: {}, lastTick: now, lastActive: now, total: { day: dayKey(now), ms: 0 } };
  }
  // Storage can outlive an extension update. Restore only the schema we use.
  function restore(runtime, total, now = Date.now()) {
    const result = freshState(now);
    const counter = n => Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
    const savedTotal = runtime?.total || total;
    if (savedTotal?.day === dayKey(now) && counter(savedTotal.ms))
      result.total.ms = Math.min(savedTotal.ms, LIMITS.dayMs);
    if (!runtime || !counter(runtime.lastTick) || !counter(runtime.lastActive)) return result;
    result.lastTick = Math.min(now, runtime.lastTick);
    result.lastActive = Math.min(now, runtime.lastActive);
    const s = runtime.session;
    if (s && typeof s.id === 'string' && s.id.length <= 100 && s.id && clean(s.intent).length >= 3 &&
        counter(s.startedAt) && counter(s.totalMs) && counter(s.intentMs) && counter(s.nextBreakAt) &&
        s.intentMs <= s.totalMs && typeof s.breakDue === 'boolean' && typeof s.stopped === 'boolean') {
      const mode = s.mode === 'browse' ? 'browse' : 'focus';
      result.session = { id: s.id, intent: clean(s.intent), mode, casual: s.casual === true || (s.casual === undefined && mode === 'browse' && s.intent === BROWSE_INTENT),
        startedAt: s.startedAt, totalMs: s.totalMs, intentMs: s.intentMs, nextBreakAt: s.nextBreakAt, breakDue: s.breakDue, stopped: s.stopped };
    }
    if (result.session && !result.session.stopped && counter(runtime.homeRemainingMs) && runtime.homeRemainingMs <= 10 * 60000)
      result.homeRemainingMs = runtime.homeRemainingMs;
    if (result.session?.mode === 'browse' && !result.session.stopped)
      result.browseRemainingMs = counter(runtime.browseRemainingMs) && runtime.browseRemainingMs <= LIMITS.browseMs ? runtime.browseRemainingMs : LIMITS.browseMs;
    for (const [id, t] of Object.entries(runtime.tabs && typeof runtime.tabs === 'object' ? runtime.tabs : {})) {
      if (/^\d+$/.test(id) && t && counter(t.at) && t.at <= now && now - t.at <= LIMITS.tabRetentionMs)
        result.tabs[id] = { at: t.at, active: t.active === true, aligned: t.aligned === true, homeBrowsing: t.homeBrowsing === true, sessionId: clean(t.sessionId, 100) };
    }
    return result;
  }
  // Aggregate the union of activity across tabs; never multiply time by tab count.
  // Lease expiry and delta cap prevent background throttling/sleep from adding hours.
  function advance(state, now, prefs = DEFAULTS) {
    if (now < state.lastTick) {
      // Discard leases after a backwards clock jump rather than count them twice.
      state.tabs = {}; state.lastTick = now; state.lastActive = now;
    }
    if (state.total.day !== dayKey(now)) state.total = { day: dayKey(now), ms: 0 };
    const from = Math.max(state.lastTick, now - LIMITS.leaseMs);
    const active = Object.values(state.tabs).filter(t => t.active && t.at + LIMITS.leaseMs > from);
    const end = active.reduce((end, t) => Math.max(end, Math.min(now, t.at + LIMITS.leaseMs)), from);
    const elapsed = Math.max(0, end - from);
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    state.total.ms += Math.max(0, end - Math.max(from, midnight.getTime()));
    state.total.ms = Math.min(state.total.ms, LIMITS.dayMs);
    if (elapsed) state.lastActive = end;
    const session = state.session;
    if (session && !session.stopped) {
      if (!session.breakDue && prefs.hideHome && state.homeRemainingMs > 0) {
        const homeEnd = active.filter(t => t.homeBrowsing && t.sessionId === session.id)
          .reduce((end, t) => Math.max(end, Math.min(now, t.at + LIMITS.leaseMs)), from);
        const homeElapsed = Math.min(Math.max(0, homeEnd - from), Math.max(0, session.nextBreakAt - session.totalMs));
        state.homeRemainingMs = Math.max(0, state.homeRemainingMs - homeElapsed);
      }
      if (session.mode === 'browse' && !session.breakDue && state.browseRemainingMs > 0) {
        const browseEnd = active.filter(t => t.sessionId === session.id)
          .reduce((end, t) => Math.max(end, Math.min(now, t.at + LIMITS.leaseMs)), from);
        const browseElapsed = Math.min(Math.max(0, browseEnd - from), Math.max(0, session.nextBreakAt - session.totalMs));
        state.browseRemainingMs = Math.max(0, state.browseRemainingMs - browseElapsed);
      }
      session.totalMs += elapsed;
      if (!session.breakDue) {
        const intended = active.filter(t => session.mode !== 'browse' && t.aligned && t.sessionId === session.id);
        const intendedEnd = intended.reduce((end, t) => Math.max(end, Math.min(now, t.at + LIMITS.leaseMs)), from);
        session.intentMs += Math.min(Math.max(0, intendedEnd - from), Math.max(0, session.nextBreakAt - (session.totalMs - elapsed)));
        if (session.totalMs >= session.nextBreakAt) session.breakDue = true;
      }
    }
    if (session && now - state.lastActive >= LIMITS.idleMs) state.session = null;
    if (!state.session || state.session.stopped) { state.homeRemainingMs = 0; state.browseRemainingMs = 0; }
    for (const [id, t] of Object.entries(state.tabs)) if (now - t.at > LIMITS.tabRetentionMs) delete state.tabs[id];
    state.lastTick = now;
    return state;
  }
  function intentText(intent) {
    const text = clean(intent);
    if (text.length < 3) throw new Error('Choose a purpose or enter at least three characters.');
    return text;
  }
  function startSession(state, intent, minutes, now, mode = 'focus') {
    const casual = mode === 'browse';
    const text = casual ? BROWSE_INTENT : intentText(intent);
    state.session = { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, intent: text, mode: casual ? 'browse' : 'focus', casual,
      startedAt: now, totalMs: 0, intentMs: 0, nextBreakAt: settings({ breakMinutes: minutes }).breakMinutes * 60000, breakDue: false, stopped: false };
    state.lastActive = now;
    state.browseRemainingMs = casual ? LIMITS.browseMs : 0;
    state.homeRemainingMs = 0;
    return state.session;
  }
  // Changing the purpose keeps the session clock and break schedule.
  // expectedIntent is the intent the editor started from, so a stale tab cannot overwrite a newer edit.
  function editIntent(state, sessionId, intent, expectedIntent) {
    const session = state.session;
    if (!session || session.stopped || session.breakDue || session.id !== sessionId || session.intent !== expectedIntent)
      throw new Error('Your session changed in another tab. Please try again.');
    session.intent = intentText(intent);
    session.mode = 'focus'; session.casual = false;
    state.browseRemainingMs = 0;
    return session;
  }
  const api = { STORE_BUILD, LIMITS, CONTROLS, PRESETS, BROWSE_INTENT, DEFAULTS, settings, savedSearches, clean, format, formatSession, dayKey, videoKey, preview, freshState, restore, advance, startSession, editIntent };
  root.Curb = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
