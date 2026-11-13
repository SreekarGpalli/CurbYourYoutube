/* Video summaries via the user's own Google Gemini API key. Pure helpers only: the single
   network call lives in background.js. Keys never leave the background script. */
(function (root) {
  'use strict';
  const ORIGIN = 'https://generativelanguage.googleapis.com';
  const ENDPOINT = `${ORIGIN}/v1beta/interactions`;
  const API_REVISION = '2026-05-20';
  // Tried in order for each key: quickest and most generous first. Free-tier limits per model, read from
  // AI Studio on 2026-11-12 (requests per minute / per day): 3.5 and 3.1 Flash-Lite 15/500, 3.x Flash 5/20.
  // Limits are per model, so each fallback adds capacity. Thinking is at each model's lowest allowed level.
  // (Google also caps YouTube input at 8 hours of video per day per project, whichever model answers.)
  const MODELS = Object.freeze([
    Object.freeze({ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', thinking: 'minimal' }),
    Object.freeze({ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', thinking: 'minimal' }),
    Object.freeze({ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', thinking: 'low' }),
    Object.freeze({ id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', thinking: 'low' })
  ]);
  const MAX_KEYS = 5, CLIP_SECONDS = 300, CACHE_SIZE = 60;
  // Streamed answers show the verdict before the rest, but Google spends nearly all the time watching the
  // video first, so streaming gained ~1 s live while total time was higher (12-13 s vs 5-6 s). Off while
  // compared; the stream reader stays so either kind of reply is handled.
  const STREAM_ANSWERS = false;
  // Never leave the viewer waiting: one attempt may take this long, and no new fallback attempt starts
  // after the overall limit. Whole-video summaries get more room. Real clipped summaries take ~5-6 s;
  // when Gemini is overloaded a stalled attempt is dropped after 12 s instead of making the viewer wait.
  // No attempt may exceed 28 s: Chrome stops an extension worker whose fetch response takes over 30 s,
  // which would end the summary before Curb could report the timeout or try the next model.
  const LIMITS_MS = Object.freeze({ attempt: 12000, total: 30000, wholeAttempt: 28000, wholeTotal: 60000 });
  // Firefox's built-in data consent: summaries send a video URL (browsing activity) and the typed
  // session intent (website activity). Optional, and requested only when a key is added.
  const DATA_COLLECTION = Object.freeze(['browsingActivity', 'websiteActivity']);
  const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;
  const SCHEMA = Object.freeze({
    type: 'object',
    // Verdict first: it is what the viewer reads first.
    properties: {
      verdict: { type: 'string', description: 'One sentence: watch or skip, and why, for this viewer.' },
      fits_intent: { type: 'string', enum: ['yes', 'partly', 'no', 'no intent'] },
      summary: { type: 'string', description: 'At most two plain sentences: what the video actually covers.' },
      key_points: { type: 'array', items: { type: 'object', properties: {
        time: { type: 'string', description: 'Timestamp like 4:05 where the point is made.' },
        point: { type: 'string' } }, required: ['time', 'point'] } }
    },
    required: ['verdict', 'fits_intent', 'summary', 'key_points']
  });

  // Older keys look like "AIza…"; auth keys (AI Studio's default since May 2026) start with "AQ." and are longer.
  function validKey(key) { return typeof key === 'string' && /^[A-Za-z0-9._-]{30,256}$/.test(key.trim()); }
  function keys(input) {
    if (!Array.isArray(input)) return [];
    return [...new Set(input.filter(validKey).map(key => key.trim()))].slice(0, MAX_KEYS);
  }
  // Shown in Settings so a key can be recognised without displaying it.
  function mask(key) { return `${key.slice(0, 4)}…${key.slice(-4)}`; }

  // Whether a request analyses only the first CLIP_SECONDS (unknown durations are clipped when clipping is on).
  const isClipped = (clip, durationSeconds) => !!clip && !(durationSeconds > 0 && durationSeconds <= CLIP_SECONDS);
  const timeSeconds = time => /^\d+(:\d{1,2}){1,2}$/.test(time) ? time.split(':').reduce((total, part) => total * 60 + Number(part), 0) : null;
  // Drops timestamps outside what Gemini was actually given (a clip, or the known length); keeps the point.
  function withinWindow(keyPoints, clipped, durationSeconds) {
    const end = clipped ? CLIP_SECONDS : durationSeconds > 0 ? durationSeconds : Infinity;
    return keyPoints.map(item => { const seconds = timeSeconds(item.time); return seconds === null || seconds > end ? { ...item, time: '' } : item; });
  }
  function request({ videoId, intent, clip, durationSeconds }, model) {
    const purpose = intent ? `Their current purpose on YouTube is: "${intent}".` : 'They have no specific purpose right now.';
    const clipped = isClipped(clip, durationSeconds);
    const video = { type: 'video', uri: `https://www.youtube.com/watch?v=${videoId}`, resolution: 'low',
      // Speech carries most of the meaning: one frame every 10 seconds keeps the request small and fast.
      processing: { type: 'static', fps: 0.1, ...(clipped ? { start_offset: '0s', end_offset: `${CLIP_SECONDS}s` } : {}) } };
    const prompt = [
      'You help a viewer decide, before watching, whether a YouTube video is worth their time.',
      purpose,
      clipped ? `You are given only the first ${CLIP_SECONDS / 60} minutes; say so if the rest probably differs.` : 'You are given the whole video.',
      'Base everything on what is actually said and shown, not the title. Be concrete and very brief: the viewer wants an answer in seconds.',
      'key_points: 2 to 4 short items with real timestamps. fits_intent: compare with their purpose ("no intent" if none).'
    ].join(' ');
    // Streamed so the verdict (first in the schema) can be shown while the rest is still being written.
    // store: false opts out of Google's default server-side storage of the interaction (1 day on the
    // free tier, 55 days on paid tiers). Curb never reuses an interaction, so nothing needs storing.
    return { model: model.id, store: false, ...(STREAM_ANSWERS ? { stream: true } : {}), input: [{ type: 'text', text: prompt }, video],
      generation_config: { thinking_level: model.thinking },
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA } };
  }

  // Text candidates from a reply, most specific first. The Interactions API (Api-Revision 2026-05-20)
  // returns steps: [{ type: "thought" }, { type: "model_output", ... }]; other shapes are `output_text`,
  // output items, or generateContent's candidates[].content.parts[]. Thought/reasoning parts are skipped.
  const isThought = node => node?.thought === true || /thought|reason/i.test(String(node?.type || ''));
  function outputTexts(body) {
    const texts = [];
    if (typeof body?.output_text === 'string') texts.push(body.output_text);
    const walk = node => {
      if (!node || typeof node !== 'object' || isThought(node)) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node.text === 'string' && (!node.type || /text|output/i.test(node.type))) texts.push(node.text);
      for (const key of ['steps', 'outputs', 'output', 'content', 'contents', 'parts', 'candidates']) walk(node[key]);
    };
    walk(body);
    return texts;
  }
  const outputText = body => outputTexts(body).join('');
  // A JSON object inside text that may also contain code fences or a sentence around it.
  function jsonIn(text) {
    const trimmed = String(text).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
    const first = trimmed.indexOf('{'), last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) { try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* fall through */ } }
    return null;
  }
  const short = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  function parse(body) {
    const texts = typeof body === 'string' ? [body] : outputTexts(body);
    // Try each text on its own (newest last), then everything joined.
    const data = [...texts].reverse().concat(texts.join('')).map(jsonIn).find(value => value && typeof value === 'object' && 'summary' in value);
    if (!data) {
      // Gemini sometimes answers in plain prose despite the JSON format; show that rather than nothing.
      const prose = short(texts.join(' '), 700);
      if (prose && !/^(?:[{\[]|```)/.test(prose)) return { summary: prose, keyPoints: [], fitsIntent: 'no intent', verdict: '' };
      throw new Error('Gemini returned an unreadable summary. Try again.');
    }
    const summary = short(data?.summary, 700);
    if (!summary) throw new Error('Gemini returned an empty summary. Try again.');
    return {
      summary,
      keyPoints: (Array.isArray(data.key_points) ? data.key_points : []).slice(0, 4)
        .map(item => ({ time: short(item?.time, 12), point: short(item?.point, 240) })).filter(item => item.point),
      fitsIntent: ['yes', 'partly', 'no', 'no intent'].includes(data.fits_intent) ? data.fits_intent : 'no intent',
      verdict: short(data.verdict, 300)
    };
  }
  // Fields readable so far from a JSON answer that is still arriving: completed strings, the verdict
  // and summary even mid-sentence, and only fully closed key points.
  function unescape(raw) {
    const safe = raw.replace(/\\(u[0-9a-fA-F]{0,3})?$/, ''); // drop a half-received escape at the end
    try { return JSON.parse(`"${safe}"`); } catch { return safe; }
  }
  function partial(text) {
    const source = String(text);
    const field = name => {
      const match = source.match(new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
      return match ? short(unescape(match[1]), name === 'verdict' ? 300 : 700) : '';
    };
    const fit = source.match(/"fits_intent"\s*:\s*"(yes|partly|no|no intent)"/)?.[1] || '';
    const keyPoints = [...source.matchAll(/\{\s*"time"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"point"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g)]
      .slice(0, 4).map(match => ({ time: short(unescape(match[1]), 12), point: short(unescape(match[2]), 240) })).filter(item => item.point);
    return { verdict: field('verdict'), fitsIntent: fit, summary: field('summary'), keyPoints };
  }
  // Server-sent events from the Interactions API: text arrives in step.delta events whose delta.type is
  // "text"; thought summaries and other events are skipped. Returns the text and any error event.
  function sseEvents(buffer) {
    const events = [];
    let rest = buffer.replace(/\r\n/g, '\n'), cut;
    while ((cut = rest.indexOf('\n\n')) >= 0) {
      const block = rest.slice(0, cut); rest = rest.slice(cut + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data || data === '[DONE]') continue;
      try { events.push(JSON.parse(data)); } catch { /* ignore a malformed event */ }
    }
    return { events, rest };
  }
  function deltaText(event) {
    const delta = event?.delta;
    return delta && delta.type === 'text' && typeof delta.text === 'string' ? delta.text : '';
  }
  // Google returns errors as an object or as a one-item list: [{ "error": { message, status, details } }].
  function errorInfo(body) {
    const error = (Array.isArray(body) ? body[0] : body)?.error;
    const reasons = (Array.isArray(error?.details) ? error.details : []).map(detail => detail?.reason).filter(Boolean);
    return { message: String(error?.message || '').replace(/\s+/g, ' ').trim().slice(0, 200), reason: reasons.join(','), status: String(error?.status || '') };
  }
  // Which failures should move on to the next model or key.
  // What a failed reply means, so the viewer is told the real reason:
  //   key   - the key itself was refused        -> next key
  //   quota - rate or daily limit (429)          -> next model, then next key
  //   busy  - Google overloaded or a server error -> next model
  //   model - this model is unavailable to this key -> next model
  //   video - anything else (e.g. a private or unsupported video) -> stop and explain
  function classify(status, info = {}) {
    const { message = '', reason = '', status: code = '' } = info;
    if (keyRejected(status, message, reason)) return 'key';
    if (status === 429 || code === 'RESOURCE_EXHAUSTED' || /quota|exhaust|rate limit/i.test(message)) return 'quota';
    if (status >= 500 || code === 'UNAVAILABLE' || /overload/i.test(message)) return 'busy';
    if (status === 404 || /model.*(not found|not supported)|(not found|not supported).*model/i.test(message)) return 'model';
    // A model that rejects one of Curb's settings (thinking level, resolution, clipping, output format):
    // the next model may accept it, so this must not end the whole summary.
    if (status === 400 && /thinking|generation_config|response_format|resolution|processing|fps|offset|unsupported|not supported|unknown name|invalid json payload/i.test(message)) return 'model';
    return 'video';
  }
  const retryable = (status, message = '') => ['quota', 'busy', 'model'].includes(classify(status, { message }));
  function keyRejected(status, message = '', reason = '') {
    return status === 401 || status === 403 || /API_KEY_INVALID|ACCESS_TOKEN_TYPE_UNSUPPORTED|API_KEY_SERVICE_BLOCKED/.test(reason) ||
      /api key not valid|api key expired|permission/i.test(message);
  }

  const api = { ORIGIN, ENDPOINT, API_REVISION, MODELS, MAX_KEYS, CLIP_SECONDS, CACHE_SIZE, LIMITS_MS, STREAM_ANSWERS, VIDEO_ID, DATA_COLLECTION,
    isClipped, timeSeconds, withinWindow, validKey, keys, mask, request, outputText, outputTexts, parse, partial, sseEvents, deltaText, errorInfo, classify, retryable, keyRejected };
  root.CurbSummary = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
