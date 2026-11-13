/* Chrome loads helpers via importScripts; Firefox lists every background script. */
if (typeof importScripts === 'function') importScripts('core.js');
if (typeof importScripts === 'function') importScripts('summary.js');
if (Curb.STORE_BUILD) importScripts('local-storage.js');
const api = globalThis.browser || chrome;
const localStore = globalThis.CurbStore || api.storage.local;
let state, prefs, enabled = false, savedSearches = [], searchRequests = {}, queue = Promise.resolve(), lastSaved = 0;
// Gemini API keys (primary first, then backups). Never included in snapshots or sent to any page.
let geminiKeys = [], summaryKeyRevision = '', summaryCache = {};
// Reset invalidates pending requests and cache writes.
let summaryGeneration = 0;
const summaryRuns = new Map(), summaryControllers = new Set();
const CLEARED = 'Local data was cleared. Add a Gemini API key in Settings.';
const DEFAULTS_VERSION = 3, LEGACY_VERSION_KEYS = ['distractionDefaultsVersion', 'nativeSearchVersion', 'browseDefaultsVersion'];
async function init() {
  if (state) return;
  const localKeys = ['savedSearches', 'settings', 'total', 'defaultsVersion', 'enabled', ...LEGACY_VERSION_KEYS];
  const sessionKeys = ['runtime', 'searchRequests'];
  localKeys.push('geminiKeys', 'summaryKeyRevision');
  sessionKeys.push('summaryCache');
  const [local, memory] = await Promise.all([localStore.get(localKeys), api.storage.session.get(sessionKeys)]);
  enabled = local.enabled === true;
  geminiKeys = CurbSummary.keys(local.geminiKeys);
  summaryKeyRevision = local.summaryKeyRevision || '';
  if (memory.summaryCache && typeof memory.summaryCache === 'object' && !Array.isArray(memory.summaryCache)) summaryCache = memory.summaryCache;
  prefs = Curb.settings(local.settings);
  savedSearches = Curb.savedSearches(local.savedSearches);
  // Apply each defaults migration once.
  const legacy = LEGACY_VERSION_KEYS.filter(key => local[key] === 1).length;
  const from = Number.isInteger(local.defaultsVersion) ? local.defaultsVersion : Curb.STORE_BUILD || local.settings === undefined ? DEFAULTS_VERSION : legacy;
  if (from < DEFAULTS_VERSION) {
    if (from < 1) { if (prefs.thumbnailMode === 'show') prefs.thumbnailMode = 'hover'; prefs.hideShorts = true; }
    if (from < 2) { prefs.hideHeader = false; prefs.hideSearchClutter = false; }
    if (from < 3) { prefs.hideShorts = true; prefs.hideHome = true; prefs.homeMinutes = 5; }
    await localStore.set({ settings: prefs });
  }
  if (!Curb.STORE_BUILD && local.defaultsVersion !== DEFAULTS_VERSION) {
    await localStore.set({ defaultsVersion: DEFAULTS_VERSION });
    await api.storage.local.remove(LEGACY_VERSION_KEYS);
  }
  state = Curb.restore(memory.runtime, local.total);
  if (memory.searchRequests && typeof memory.searchRequests === 'object' && !Array.isArray(memory.searchRequests)) searchRequests = memory.searchRequests;
}
function searchUrl(value) {
  const url = new URL(value);
  if (!/^https:\/\/(www\.|m\.)?youtube\.com\//.test(url.href)) throw new Error('Search focus requires a YouTube page.');
  url.hostname = 'www.youtube.com';
  url.searchParams.delete('themeRefresh'); url.hash = '';
  return url.href;
}
function snapshot() {
  return { settings: prefs, savedSearches, session: state.session, total: state.total, homeRemainingMs: state.homeRemainingMs, browseRemainingMs: state.browseRemainingMs,
    ...(Curb.STORE_BUILD ? { enabled } : {}),
    summaries: { ready: geminiKeys.length > 0 }
  };
}
const extensionPage = sender => (sender.url || '').startsWith(api.runtime.getURL('')) && (!sender.tab || (sender.tab.url || sender.url).startsWith(api.runtime.getURL('')));
async function persist(force = false) {
  await api.storage.session.set({ runtime: state, searchRequests });
  if (force || Date.now() < lastSaved || Date.now() - lastSaved >= Curb.LIMITS.checkpointMs) {
    await localStore.set({ total: state.total });
    lastSaved = Date.now();
  }
}
async function broadcast(tabs = Object.keys(state.tabs), intentSaved = false) {
  const data = snapshot();
  await Promise.allSettled(tabs.map(id => api.tabs.sendMessage(Number(id), { type: 'STATE', data, intentSaved })));
}
async function saveGeminiKeys(keys) {
  const revision = crypto.randomUUID();
  await localStore.set({ geminiKeys: keys, summaryKeyRevision: revision });
  geminiKeys = keys;
  summaryKeyRevision = revision;
}
async function handle(message, sender) {
  try { await init(); }
  catch (error) {
    if (!Curb.STORE_BUILD || message.type !== 'RESET' || !extensionPage(sender)) throw error;
    await localStore.clear();
    await api.storage.session.clear();
    await init();
  }
  if (Curb.STORE_BUILD && !enabled) {
    if (message.type === 'ENABLE') {
      await localStore.set({ enabled: true, defaultsVersion: DEFAULTS_VERSION });
      enabled = true;
      return snapshot();
    }
    if (message.type === 'GET' || message.type === 'TICK') return snapshot();
    if (!extensionPage(sender) || !['SETTINGS', 'RESET'].includes(message.type)) throw new Error('Enable Curb first.');
  }
  const now = Date.now();
  const previous = JSON.stringify(state.session && [state.session.id, state.session.breakDue, state.session.stopped, state.session.mode]);
  const wasBrowsing = state.browseRemainingMs > 0;
  const wasBrowsingHome = state.homeRemainingMs > 0;
  Curb.advance(state, now, prefs);
  const tabId = sender.tab?.id;
  for (const [id, request] of Object.entries(searchRequests)) {
    if (!/^\d+$/.test(id) || !request || typeof request.text !== 'string' || request.text.length > Curb.LIMITS.intent ||
        typeof request.page !== 'string' || typeof request.url !== 'string' || !Number.isFinite(request.at) ||
        request.at > now || now - request.at > 15000 || !state.session || state.session.stopped || request.sessionId !== state.session.id)
      delete searchRequests[id];
  }
  let changed = false, force = false, intentSaved = false;
  let searchRequest;
  switch (message.type) {
    case 'GET': break;
    case 'ENABLE':
      if (!Curb.STORE_BUILD) throw new Error('Unknown request.');
      return snapshot();
    case 'TICK':
      if (tabId === undefined || !/^https:\/\/(www\.|m\.)?youtube\.com\//.test(sender.url || '')) throw new Error('Activity requires a YouTube tab.');
      state.tabs[tabId] = { at: now, active: message.active === true, aligned: message.aligned === true,
        homeBrowsing: message.homeBrowsing === true && new URL(sender.url).pathname === '/', sessionId: Curb.clean(message.sessionId, 100) };
      break;
    case 'HOME_BROWSE':
      if (!state.session || state.session.stopped || state.session.breakDue || state.session.id !== message.sessionId)
        throw new Error('Start or resume your current session before browsing the homepage.');
      if (prefs.hideHome && state.homeRemainingMs <= 0) state.homeRemainingMs = prefs.homeMinutes * 60000;
      changed = true;
      break;
    case 'HOME_HIDE':
      if (state.session?.id !== message.sessionId) throw new Error('Your session changed. Please try again.');
      state.homeRemainingMs = 0;
      changed = true;
      break;
    case 'START':
      // A stale prompt in another tab must not silently replace a newer intent.
      if (message.expectedId !== (state.session?.id || null)) throw new Error('Your session changed in another tab. Please try again.');
      Curb.startSession(state, message.intent, prefs.breakMinutes, now);
      searchRequests = {};
      changed = force = true;
      break;
    case 'BROWSE':
      if (message.expectedId !== (state.session?.id || null)) throw new Error('Your session changed in another tab. Please try again.');
      if (state.session?.breakDue && !state.session.stopped) throw new Error('Continue or finish your break before browsing.');
      searchRequests = {};
      if (!state.session || state.session.stopped) Curb.startSession(state, Curb.BROWSE_INTENT, prefs.breakMinutes, now, 'browse');
      else {
        // Grant a fresh allowance when switching to browsing or after the last one ran out,
        // never top up time that is still running.
        if (state.session.mode !== 'browse' || state.browseRemainingMs <= 0) state.browseRemainingMs = Curb.LIMITS.browseMs;
        state.session.mode = 'browse';
      }
      changed = force = true;
      break;
    case 'EDIT_INTENT':
      Curb.editIntent(state, message.sessionId, message.intent, message.expectedIntent);
      searchRequests = {};
      intentSaved = Curb.STORE_BUILD && extensionPage(sender);
      changed = force = true;
      break;
    case 'SEARCH_SAVE':
      if (tabId === undefined || !state.session || state.session.stopped || state.session.id !== message.sessionId ||
          typeof message.text !== 'string' || message.text.length > Curb.LIMITS.intent || typeof message.page !== 'string' || message.page.length > 100)
        throw new Error('Search focus requires your current session and YouTube tab.');
      searchRequests[tabId] = { text: message.text, page: message.page, url: searchUrl(message.url), sessionId: state.session.id, at: now };
      break;
    case 'SEARCH_GET': {
      const pending = searchRequests[tabId];
      searchRequest = null;
      if (pending && pending.page !== message.page) {
        if (pending.url === searchUrl(sender.url)) searchRequest = pending;
        else delete searchRequests[tabId];
      }
      break;
    }
    case 'SEARCH_CLEAR':
      delete searchRequests[tabId];
      break;
    case 'SEARCH_INTENT': {
      if (!Curb.STORE_BUILD || !extensionPage(sender) || !state.session || state.session.stopped || state.session.breakDue ||
          state.session.id !== message.sessionId || state.session.intent !== message.intent) throw new Error('Save your current intent before opening suggestions.');
      const url = 'https://www.youtube.com/';
      const tab = await api.tabs.create({ url: 'about:blank' });
      searchRequests[tab.id] = { text: state.session.intent, page: '', url, sessionId: state.session.id, at: now };
      try { await api.tabs.update(tab.id, { url }); }
      catch (error) { delete searchRequests[tab.id]; throw error; }
      break;
    }
    case 'FOCUS':
      if (!state.session || state.session.stopped || state.session.breakDue || message.sessionId !== state.session.id || state.session.casual)
        throw new Error('Start or resume your current session first.');
      state.session.mode = 'focus';
      state.browseRemainingMs = 0;
      changed = true;
      break;
    case 'CONTINUE':
      if (state.session && !state.session.stopped && state.session.id === message.sessionId && state.session.breakDue) {
        state.session.breakDue = false;
        state.session.nextBreakAt = state.session.totalMs + prefs.breakMinutes * 60000;
        changed = true;
      }
      break;
    case 'STOP':
      if (state.session && state.session.id === message.sessionId) { state.session.stopped = true; state.homeRemainingMs = 0; changed = force = true; }
      break;
    case 'SAVE_SEARCH': {
      const id = message.search?.id || `${now}-${Math.random().toString(36).slice(2, 10)}`;
      const valid = Curb.savedSearches([{ ...message.search, id }]);
      if (!valid.length) throw new Error('Enter a name (3–48 characters) and search terms (1–180 characters).');
      if (message.search?.id && !savedSearches.some(item => item.id === id)) throw new Error('This saved search was removed.');
      if (!message.search?.id && savedSearches.length >= 6) throw new Error('You can save up to six searches.');
      const next = message.search?.id ? savedSearches.map(item => item.id === id ? valid[0] : item) : [...savedSearches, valid[0]];
      await localStore.set({ savedSearches: next }); savedSearches = next; changed = true;
      break;
    }
    case 'DELETE_SEARCH': {
      const next = savedSearches.filter(item => item.id !== message.id);
      await localStore.set({ savedSearches: next }); savedSearches = next; changed = true;
      break;
    }
    case 'SETTINGS': {
      const oldInterval = prefs.breakMinutes;
      const nextPrefs = Curb.settings({ ...prefs, ...message.settings });
      await localStore.set({ settings: nextPrefs });
      prefs = nextPrefs;
      if (!prefs.hideHome) state.homeRemainingMs = 0;
      if (state.session && prefs.breakMinutes !== oldInterval && !state.session.breakDue)
        state.session.nextBreakAt = state.session.totalMs + prefs.breakMinutes * 60000;
      changed = true;
      break;
    }
    case 'RESET': {
      summaryGeneration++; summaryRuns.clear();
      for (const controller of summaryControllers) controller.abort();
      await localStore.clear();
      if (!Curb.STORE_BUILD) await localStore.set({ defaultsVersion: DEFAULTS_VERSION });
      await api.storage.session.clear();
      const tabs = Object.keys(state.tabs);
      state = Curb.freshState(now);
      prefs = Curb.settings(); savedSearches = [];
      searchRequests = {}; enabled = false;
      geminiKeys = []; summaryKeyRevision = ''; summaryCache = {};
      if (Curb.STORE_BUILD) {
        lastSaved = 0;
        void broadcast(tabs);
        return snapshot();
      }
      state.tabs = Object.fromEntries(tabs.map(id => [id, { at: now, active: false, aligned: false, homeBrowsing: false, sessionId: '' }]));
      changed = force = true;
      break;
    }
    case 'SUMMARY_KEYS': break;
    case 'SUMMARY_KEY_ADD': {
      if (Curb.STORE_BUILD && message.consent !== true) throw new Error('Confirm the Gemini terms in Settings before adding a key.');
      const key = typeof message.key === 'string' ? message.key.trim() : '';
      if (!CurbSummary.validKey(key)) throw new Error('Enter a valid key from Google AI Studio.');
      if (geminiKeys.includes(key)) throw new Error('This key is already saved.');
      if (geminiKeys.length >= CurbSummary.MAX_KEYS) throw new Error(`You can save up to ${CurbSummary.MAX_KEYS} keys.`);
      await saveGeminiKeys([...geminiKeys, key]); changed = true;
      break;
    }
    case 'SUMMARY_KEY_REMOVE': {
      if (!Number.isInteger(message.index) || !geminiKeys[message.index] || message.revision !== summaryKeyRevision)
        throw new Error('The key list changed. Try again.');
      await saveGeminiKeys(geminiKeys.filter((_, index) => index !== message.index)); changed = true;
      break;
    }
    case 'OPTIONS':
      if (message.section === 'summaries') { await api.tabs.create({ url: api.runtime.getURL('options.html#summaries') }); break; }
      if (Curb.STORE_BUILD && ['edit-intent', 'saved-searches'].includes(message.section)) {
        await api.tabs.create({ url: api.runtime.getURL(`options.html#${message.section}`) });
        break;
      }
      await api.runtime.openOptionsPage();
      break;
    default: throw new Error('Unknown request.');
  }
  const current = JSON.stringify(state.session && [state.session.id, state.session.breakDue, state.session.stopped, state.session.mode]);
  await persist(force);
  // Delivery to a suspended/navigating page must never hold the serialized queue.
  if (changed || previous !== current || wasBrowsing !== (state.browseRemainingMs > 0) || wasBrowsingHome !== (state.homeRemainingMs > 0)) void broadcast(undefined, intentSaved);
  if (message.type === 'SEARCH_GET') return { ...snapshot(), searchRequest };
  // Masked keys are only ever shown to the extension's own Settings page.
  if (/^SUMMARY_KEY/.test(message.type)) return { ...snapshot(), summaryKeys: geminiKeys.map(CurbSummary.mask), summaryKeyRevision };
  return snapshot();
}
function enqueue(work) {
  const job = queue.then(work);
  queue = job.catch(() => {});
  return job;
}
async function readStream(stream, onText) {
  const reader = stream.getReader(), decoder = new TextDecoder();
  let buffer = '', text = '', error = null, last = 0;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const { events, rest } = CurbSummary.sseEvents(done ? buffer + '\n\n' : buffer);
    buffer = rest;
    for (const event of events) {
      if (event?.error) error = event;
      text += CurbSummary.deltaText(event);
    }
    // Throttled so the tab gets a few updates per second rather than one per token.
    if (text && (done || Date.now() - last > 120)) { last = Date.now(); onText(text); }
    if (done) break;
  }
  if (error && !text) throw Object.assign(new Error('stream error'), { body: error });
  return { output_text: text };
}
function progress(sender, requestId, text) {
  if (!sender.tab || typeof requestId !== 'string') return;
  api.tabs.sendMessage(sender.tab.id, { type: 'SUMMARY_PROGRESS', requestId, partial: CurbSummary.partial(text) },
    typeof sender.frameId === 'number' ? { frameId: sender.frameId } : undefined).catch(() => {});
}
// Firefox's built-in data consent lists granted optional data types; Chrome has no such list.
async function allowedToContactGoogle() {
  if (!await api.permissions.contains({ origins: [`${CurbSummary.ORIGIN}/*`] })) return false;
  const granted = typeof api.permissions.getAll === 'function' ? await api.permissions.getAll() : {};
  if (!granted || !('data_collection' in granted)) return true;
  return CurbSummary.DATA_COLLECTION.every(type => granted.data_collection?.includes(type));
}
// Summaries run outside the serialized queue: a Gemini call takes seconds and must not hold up timers.
async function summarize(message, sender) {
  if (!sender.tab || !/^https:\/\/(www\.|m\.)?youtube\.com\//.test(sender.url || '')) throw new Error('Summaries can be requested from YouTube pages only.');
  const videoId = String(message.videoId || '');
  if (!CurbSummary.VIDEO_ID.test(videoId)) throw new Error('This link is not a YouTube video.');
  const durationSeconds = Number.isFinite(message.durationSeconds) ? message.durationSeconds : 0;
  const context = await enqueue(async () => {
    await init();
    if (Curb.STORE_BUILD && !enabled) throw new Error('Enable Curb first.');
    const session = state.session && !state.session.stopped && !state.session.casual ? state.session : null;
    return { keys: [...geminiKeys], intent: !Curb.STORE_BUILD || prefs.summaryIntent ? session?.intent || '' : '', clip: prefs.summaryClip, generation: summaryGeneration };
  });
  if (!context.keys.length) throw new Error('Add a Gemini API key in Settings.');
  const clipped = CurbSummary.isClipped(context.clip, durationSeconds);
  const cacheKey = `${videoId}|${context.intent}|${clipped ? 'clip' : 'whole'}`;
  // Private-window summaries neither read nor enter the cache shared with regular windows.
  const shared = sender.tab.incognito !== true;
  if (shared && summaryCache[cacheKey]) return { ...summaryCache[cacheKey], cached: true };
  if (!await allowedToContactGoogle())
    throw new Error('Allow Curb to contact Google in Settings.');
  if (context.generation !== summaryGeneration) throw new Error(CLEARED);
  if (shared && summaryRuns.has(cacheKey)) return summaryRuns.get(cacheKey);
  const run = askGemini({ videoId, durationSeconds, clipped, context, sender, requestId: message.requestId, cacheKey, shared });
  if (shared) {
    summaryRuns.set(cacheKey, run);
    run.catch(() => {}).finally(() => { if (summaryRuns.get(cacheKey) === run) summaryRuns.delete(cacheKey); });
  }
  return run;
}
async function askGemini({ videoId, durationSeconds, clipped, context, sender, requestId, cacheKey, shared }) {
  const current = () => { if (context.generation !== summaryGeneration) throw new Error(CLEARED); };
  const failures = {};
  const limits = CurbSummary.LIMITS_MS, attemptMs = clipped ? limits.attempt : limits.wholeAttempt;
  const deadline = Date.now() + (clipped ? limits.total : limits.wholeTotal);
  const timeout = 'Gemini took too long. Try again.';
  attempts: for (const [index, key] of context.keys.entries()) {
    for (const model of CurbSummary.MODELS) {
      current();
      // A key removed in Settings while this summary runs is never used again.
      if (!geminiKeys.includes(key)) continue attempts;
      if (Date.now() >= deadline) { failures.slow ??= timeout; break attempts; }
      let response, body;
      const started = Date.now();
      const controller = new AbortController();
      summaryControllers.add(controller);
      const timer = setTimeout(() => controller.abort(), Math.min(attemptMs, deadline - started));
      try {
        try {
          response = await fetch(CurbSummary.ENDPOINT, { method: 'POST', credentials: 'omit', signal: controller.signal,
            headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': CurbSummary.API_REVISION },
            body: JSON.stringify(CurbSummary.request({ videoId, intent: context.intent, clip: context.clip, durationSeconds }, model)) });
          if (!/event-stream/.test(response.headers?.get?.('content-type') || '')) body = await response.json().catch(() => null);
        } catch {
          current();
          if (controller.signal.aborted) { failures.slow ??= timeout; continue; }
          failures.network = 'Could not reach Gemini. Check your internet connection.'; break attempts;
        }
        let streamError = null;
        if (response.ok && /event-stream/.test(response.headers?.get?.('content-type') || '') && response.body?.getReader) {
          try { body = await readStream(response.body, text => progress(sender, requestId, text)); }
          catch (error) { body = null; streamError = error.body || { error: { message: 'The answer stream broke off.' } }; }
        }
        current();
        if (controller.signal.aborted) { failures.slow ??= timeout; continue; }
        if (response.ok && !streamError) {
          let parsed;
          try { parsed = CurbSummary.parse(body); } catch (error) { failures.unreadable ??= error.message; continue; }
          const result = { ...parsed, keyPoints: CurbSummary.withinWindow(parsed.keyPoints, clipped, durationSeconds), videoId, intent: context.intent,
            model: model.label, seconds: Math.round((Date.now() - started) / 100) / 10, backupKey: index > 0, clipped };
          // Serialized with Clear local data, so a reset can never be undone by a late write.
          await enqueue(async () => {
            current();
            if (!shared) return;
            summaryCache = Object.fromEntries([...Object.entries(summaryCache).filter(([k]) => k !== cacheKey), [cacheKey, result]].slice(-CurbSummary.CACHE_SIZE));
            await api.storage.session.set({ summaryCache }).catch(() => {});
          });
          return result;
        }
        // An error can also arrive inside a successful stream; classify it like any other reply.
        const failedStatus = streamError ? 0 : response.status;
        const info = CurbSummary.errorInfo(streamError || body);
        const kind = CurbSummary.classify(failedStatus, info);
        if (kind === 'key') {
          const name = index ? `backup key ${index}` : 'primary key';
          failures.key ??= `Gemini rejected your ${name}. Check it in Settings.`;
          continue attempts;
        }
        if (kind === 'quota') { failures.quota ??= 'Your Gemini project hit its usage limit. Try again later.'; continue; }
        if (kind === 'busy') { failures.busy ??= 'Gemini is busy. Try again shortly.'; continue; }
        if (kind === 'model') { failures.model ??= 'Gemini has no supported model available for this key.'; continue; }
        throw new Error(/private|unavailable/i.test(info.message)
          ? 'Gemini can only summarize available public videos.'
          : 'Gemini could not summarize this video. Try another public video.');
      } finally { clearTimeout(timer); summaryControllers.delete(controller); }
    }
  }
  current();
  throw new Error(failures.quota || failures.busy || failures.slow || failures.unreadable || failures.key || failures.model || failures.network || 'Gemini could not summarize this video.');
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== api.runtime.id || !message || typeof message.type !== 'string' || message.type === 'STATE') return false;
  // Limit web-origin senders to our declared YouTube surfaces.
  if (sender.tab && !/^https:\/\/(www\.|m\.)?youtube\.com\//.test(sender.url || '') && !(sender.url || '').startsWith(api.runtime.getURL(''))) return false;
  // Gemini keys can only be read or changed from the extension's own pages.
  if (/^SUMMARY_KEY/.test(message.type) && !extensionPage(sender)) return false;
  let job;
  if (message.type === 'SUMMARIZE') job = summarize(message, sender);
  job ||= enqueue(() => handle(message, sender));
  if (typeof browser !== 'undefined') return job.then(data => ({ ok: true, data }), error => ({ ok: false, error: error.message }));
  job.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
api.tabs.onRemoved.addListener(id => {
  queue = queue.then(async () => {
    await init();
    if (!(id in state.tabs)) return;
    Curb.advance(state, Date.now(), prefs);
    delete state.tabs[id];
    delete searchRequests[id];
    if (!Object.keys(state.tabs).length) { state.session = null; state.homeRemainingMs = 0; }
    await persist(true);
  }).catch(() => {});
});
