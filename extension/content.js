(() => {
  'use strict';
  const api = globalThis.browser || chrome;
  if (document.getElementById('curb-extension-root')) return;
  if (!Curb.STORE_BUILD) {
    document.documentElement.setAttribute('data-curb-locked', '');
    document.documentElement.setAttribute('data-curb-thumbnails', Curb.DEFAULTS.thumbnailMode);
    document.documentElement.setAttribute('data-curb-hide-shorts', '');
  }
  let data = null, route = location.href, approved = '', approvedSession = '', editing = false;
  let approvedAligned = true, intentDraft = null, editingSessionId = null, editingIntent = null;
  let selectedPreset = '', savedSearchDraft = null;
  let mode = '', busy = false, pendingSearch = false, inFlight = false, errorText = '', previewTimeout, observerTimer;
  let searchReveal = false, retired = false, heartbeat = 0, positionFrame = 0;
  let consentDismissed = false, renderSignature = '';
  const OUT_OF_SYNC = 'Curb Your YouTube is only partly updated. Reload the extension on your browser’s extensions page, then reload this tab. ';
  const FOCUS_SEARCH_KEY = 'curb-focus-search';
  // Remove handoffs left by older versions from the page's storage.
  try { sessionStorage.removeItem(FOCUS_SEARCH_KEY); } catch { /* Storage may be unavailable. */ }
  const PAGE_LOAD = Math.random().toString(36).slice(2);
  let searchDraft = null, searchChecked = false, searchLoading = false, fillingSearch = false, searchEngaged = false, searchGeneration = 0;
  const thumbnailTabStops = new Map();
  const thumbnailSelector = 'ytd-thumbnail,.ytLockupViewModelContentImage,yt-thumbnail-view-model,.ytThumbnailViewModelHost,.yt-thumbnail-view-model,ytm-thumbnail-cover,.video-thumbnail-container,.reel-item-endpoint,ytd-expandable-metadata-renderer #thumbnail,ytd-macro-markers-list-item-renderer #thumbnail';
  const host = document.createElement('div');
  host.id = 'curb-extension-root';
  host.style.cssText = 'all:initial!important;color-scheme:dark!important;position:relative!important;z-index:2200!important';
  const shadow = host.attachShadow({ mode: Curb.STORE_BUILD ? 'closed' : 'open' });
  const barSize = new ResizeObserver(entries => {
    const height = Math.ceil(entries[0].target.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--curb-bar-height', `${height}px`);
  });
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:dark;font:14px/1.55 "Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;color:#ededed}
    :host>div,:host>aside{color-scheme:dark;font:14px/1.55 "Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;color:#ededed}
    *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:disabled{opacity:.55;cursor:wait}
    button:focus-visible,input:focus-visible{outline:2px solid #ddd;outline-offset:3px}
    ::selection{background:#494949;color:#fff}
    .bar{position:fixed;inset:auto 0 0;min-height:56px;background:#141414;border-top:1px solid #333;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:9px 16px;z-index:2}
    .intent{flex:1;min-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
    .overline{display:block;font-size:10px;color:#a3a3a3;font-weight:400;margin-bottom:2px}
    .metric{white-space:nowrap;font-variant-numeric:tabular-nums}.metric b{font:500 15px/1.2 "Cascadia Mono",Consolas,monospace}
    .bar button{border:1px solid #707070;background:#1c1c1c;color:#ddd;border-radius:5px;padding:5px 9px;font-size:12px}
    .bar button:hover{background:#2a2a2a;border-color:#aaa}
    :host([data-fullscreen]) .bar{display:none!important}
    .fullscreen-pill{display:none;position:fixed;top:12px;left:50%;transform:translateX(-50%);max-width:min(580px,calc(100vw - 24px));align-items:center;gap:12px;padding:7px 14px;border:1px solid #ffffff26;border-radius:999px;background:rgba(15,15,15,.35);backdrop-filter:blur(4px);color:#f5f5f5;text-shadow:0 1px 3px #000;font-size:12px;line-height:18px;pointer-events:none;user-select:none;z-index:2}
    :host([data-fullscreen]) .fullscreen-pill{display:flex}
    :host(:not([data-fullscreen])[data-player-visible]) .fullscreen-pill{display:flex;top:var(--curb-player-top);left:var(--curb-player-center);max-width:min(580px,var(--curb-player-width))}
    .fullscreen-pill-intent{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fullscreen-pill-time{flex-shrink:0;white-space:nowrap;font-variant-numeric:tabular-nums;border-left:1px solid #ffffff40;padding-left:12px}
    .fullscreen-pill-time b{font-weight:500}
    @media(max-width:1100px){.bar{gap:10px}}
    @media(max-width:760px){.bar{height:auto;min-height:60px;flex-wrap:wrap}}
    .veil{position:fixed;inset:0 0 var(--curb-bar-height,60px);background:#101010;display:grid;place-items:center;padding:24px;overflow:auto;z-index:4}
    .card{width:min(530px,100%);background:#181818;border:1px solid #3a3a3a;border-radius:12px;padding:30px;margin:auto;box-shadow:0 12px 40px #0004}
    .consent{position:fixed;right:16px;bottom:16px;width:min(390px,calc(100% - 32px));padding:18px}.consent h1{font-size:18px;margin-bottom:6px}.consent p{margin:0 0 12px}.consent .actions{margin-top:0}
    h1{font-size:26px;line-height:1.25;letter-spacing:-.6px;margin:0 0 12px;font-weight:600}p{color:#aaa;margin:8px 0 20px;line-height:1.55;font-size:13px}
    .presets{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:24px 0}.preset{position:relative;background:#202020;border:1px solid #707070;border-radius:5px;text-align:left;padding:11px 28px 11px 12px;font-size:12px;color:#ddd;min-height:44px}
    .preset:hover{background:#2b2b2b;border-color:#aaa}.preset[aria-pressed=true]{background:#303030;border-color:#ededed;color:#fff}.preset[aria-pressed=true]::after{content:'✓';position:absolute;right:10px;top:50%;transform:translateY(-50%)}
    label{display:block;font-weight:500;font-size:12px;margin-bottom:8px}input{width:100%;border:1px solid #707070;border-radius:5px;padding:11px 12px;background:#121212;color:#ededed;font-size:13px;caret-color:#fff}input::placeholder{color:#a3a3a3;opacity:1}input:-webkit-autofill{-webkit-text-fill-color:#ededed;box-shadow:0 0 0 100px #121212 inset}
    .actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}.primary,.secondary{border-radius:5px;padding:10px 16px;font-size:13px;font-weight:600}.primary{background:#e5e5e5;color:#151515;border:1px solid #e5e5e5}.primary:hover{background:#fff;border-color:#fff}.secondary{background:#1c1c1c;color:#ddd;border:1px solid #707070}.secondary:hover{background:#2a2a2a;border-color:#aaa}
    .error{color:#ffb4a5;font-size:12px;margin:10px 0}
    .video-title{border-left:2px solid #888;padding:4px 0 4px 14px;margin:22px 0 16px;font-size:16px;font-weight:500;line-height:1.5;overflow-wrap:anywhere}
    .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;border-block:1px solid #3a3a3a;padding:20px 0;margin:22px 0}.summary>div+div{border-left:1px solid #3a3a3a;padding-left:16px}.summary b{display:block;font:500 25px/1.4 "Cascadia Mono",Consolas,monospace;font-variant-numeric:tabular-nums;letter-spacing:-1px}.summary span{font-size:11px;color:#a3a3a3}
    .home{position:fixed;inset:110px 24px var(--curb-bar-height,60px);max-width:540px;margin:auto;padding:28px;color:#171717;overflow:auto;pointer-events:auto}:host([data-yt-dark]) .home{color:#f1f1f1}.home button{pointer-events:auto}.home h1{font-size:26px}
    .home .actions{pointer-events:auto}.home-countdown{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:12px;color:#ccc}
    .preview{position:fixed;z-index:6;right:20px;bottom:calc(var(--curb-bar-height,60px) + 16px);width:min(370px,calc(100vw - 32px));background:#202020;border:1px solid #666;border-radius:8px;box-shadow:0 8px 24px #0006;padding:12px 14px;overflow:auto;overflow-wrap:anywhere}
    .preview-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.preview-head b{font-size:14px;font-weight:600;line-height:1.4;padding-top:3px}
    .preview-close{flex:0 0 28px;height:28px;margin:-2px -4px 0 0;padding:0;border:1px solid transparent;border-radius:4px;background:none;color:#ccc;font-size:20px;line-height:1}.preview-close:hover{color:#fff;background:#343434}
    .preview-detail p{margin:5px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.preview-detail small{color:#aaa;font-size:11px}
    .summarize-pill{position:fixed;z-index:7;padding:3px 10px;border:1px solid #707070;border-radius:999px;background:#1c1c1c;color:#ededed;font:600 11px/1.5 "Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 2px 10px #0008;cursor:pointer}.summarize-pill:hover,.summarize-pill:focus-visible{background:#2a2a2a;border-color:#ddd;color:#fff}
    .preview .summarize{display:block;margin-top:8px;padding:5px 10px;border:1px solid #707070;border-radius:5px;background:#1c1c1c;color:#ededed;font-size:12px;font-weight:600}.preview .summarize:hover{background:#2a2a2a;border-color:#aaa;color:#fff}
    .preview.expanded{width:min(440px,calc(100vw - 32px))}.preview.expanded .preview-detail,.preview.expanded>.summarize{display:none}
    .ai-summary{border-top:1px solid #3a3a3a;margin-top:8px;padding-top:8px}.ai-summary p{margin:0;color:#e1e1e1}.ai-summary p.error{color:#ffb4a5}
    .summary-status,.summary-scope{color:#bcbcbc;font-size:12px}.summary-scope{display:block;margin-bottom:4px}
    .summary-status[data-complete]{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    .ai-summary .intent-fit{border-left:2px solid #707070;padding-left:9px;margin-top:9px}.intent-fit strong{display:block;font-size:12px;margin-bottom:2px}
    .ai-summary ul{margin:8px 0 0;padding:0;list-style:none;color:#ddd;font-size:12px}.ai-summary li{display:flex;align-items:baseline;gap:8px;border-top:1px solid #383838;padding:5px 0}.ai-summary li:last-child{padding-bottom:0}
    .ai-summary li a{color:#b8d4ff;font-variant-numeric:tabular-nums;flex:0 0 3.5em;text-underline-offset:2px}.ai-summary li a:focus-visible{outline:2px solid #b8d4ff;outline-offset:2px}
    .card.intent-card{width:min(680px,100%)}
    .saved-search{min-width:0;border:1px solid #707070;border-left:3px solid #d0d0d0;border-radius:5px;padding:4px;background:#202020;color:#ededed;overflow-wrap:anywhere;display:flex;flex-direction:column}
    .saved-search .saved-search-launch{flex:1;width:100%;border:0;background:transparent;color:inherit;padding:7px 8px}
    .saved-search:hover{background:#2b2b2b;border-color:#aaa;border-left-color:#fff}
    .saved-search-actions{display:flex;gap:6px;flex-wrap:wrap;padding:0 8px 4px}
    .saved-search-actions button{font-size:11px;padding:2px 7px;background:transparent;border-color:#707070;color:#ccc}
    .saved-search-add{border-style:dashed;color:#bbb}
    .saved-search-form{display:grid;gap:10px;margin-top:18px}.saved-search-form label{margin-bottom:0}
    .thumbnail-preview{position:fixed;z-index:5;pointer-events:none;background:#181818;border:1px solid #666;border-radius:8px;padding:6px;box-shadow:0 8px 30px #0008;width:min(320px,calc(100vw - 24px))}
    .thumbnail-preview img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;border-radius:4px}
    @media(max-width:600px){.presets{grid-template-columns:repeat(2,minmax(0,1fr))}}
    [hidden]{display:none!important}
    @media(max-width:760px){.bar{gap:10px;padding:8px 12px}.bar .overall{display:none}.metric b{font-size:14px}.card{padding:24px}.veil{padding:16px;top:0}.presets{gap:8px}.preset{font-size:12px}h1{font-size:24px}.summary{gap:10px}.summary>div+div{padding-left:10px}.summary b{font-size:21px}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  `;
  shadow.append(style);
  const ui = document.createElement('div'); shadow.append(ui);
  const thumbnailTip = document.createElement('aside'); thumbnailTip.className = 'thumbnail-preview'; thumbnailTip.hidden = true; thumbnailTip.setAttribute('aria-hidden', 'true'); shadow.append(thumbnailTip);
  const tip = document.createElement('aside'); tip.className = 'preview'; tip.hidden = true; tip.setAttribute('aria-labelledby', 'curb-preview-title'); shadow.append(tip);
  const summarizePill = document.createElement('button'); summarizePill.type = 'button'; summarizePill.className = 'summarize-pill'; summarizePill.textContent = 'Summarize'; summarizePill.hidden = true; shadow.append(summarizePill);
  function el(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) { if (key === 'class') node.className = value; else node.setAttribute(key, value); }
    node.textContent = text; return node;
  }
  function button(text, fn, className = 'primary') {
    const b = el('button', { type: 'button', class: className }, text);
    b.addEventListener('click', fn); return b;
  }
  function pause() {
    document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); });
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }
  function videoTitle() {
    return Curb.clean(document.querySelector('ytd-watch-metadata h1, h1.ytd-video-primary-info-renderer, ytm-slim-video-metadata-section-renderer h1')?.textContent || document.title.replace(/ - YouTube$/, ''), 240) || 'This video';
  }
  function desiredMode() {
    if (retired || (Curb.STORE_BUILD && !data?.enabled)) return '';
    if (!data) return 'loading';
    if (data.session?.breakDue && !data.session.stopped) return 'break';
    if (editing) return 'intent';
    if (!data.session) return 'intent';
    if (data.session.stopped) return 'stopped';
    if (data.session.mode === 'browse' && !(data.browseRemainingMs > 0)) return 'browse-ended';
    if (data.settings.hideShorts && /^\/shorts(?:\/|$)/.test(location.pathname)) return 'shorts';
    const key = Curb.videoKey(location.href);
    if (key && data.session.mode !== 'browse' && (approved !== key || approvedSession !== data.session.id)) return 'align';
    return '';
  }
  function homeUnlocked() {
    return data?.homeRemainingMs > 0 || (data?.session?.mode === 'browse' && !data.session.stopped && data.browseRemainingMs > 0);
  }
  function focusedActivity() {
    return !desiredMode() && data?.session?.mode !== 'browse' && (!Curb.videoKey(location.href) || approvedAligned);
  }
  function markShortsControls() {
    // Search filter chips have no destination URL. Limit text matching to
    // navigation controls so ordinary video titles mentioning Shorts survive.
    document.querySelectorAll('button.ytChipShapeButtonReset, yt-chip-cloud-chip-renderer, yt-tab-shape, tp-yt-paper-tab').forEach(node => {
      node.toggleAttribute('data-curb-shorts-control', node.textContent.trim().toLowerCase() === 'shorts');
    });
    document.querySelectorAll('ytd-guide-entry-renderer,ytd-mini-guide-entry-renderer,yt-guide-entry-view-model').forEach(row => {
      const link = row.querySelector('a');
      const path = link ? new URL(link.href, location.href).pathname : '';
      const label = [row.getAttribute('aria-label'), row.getAttribute('title'), link?.getAttribute('aria-label'), link?.getAttribute('title'), row.querySelector('yt-formatted-string,.title')?.textContent, row.textContent].filter(Boolean).join(' ').trim();
      row.toggleAttribute('data-curb-shorts-control', /(^|\/)shorts(?:\/|$)/.test(path) || /^shorts(?:\s|$)/i.test(label) || !!row.querySelector('[icon*="shorts" i]'));
      row.toggleAttribute('data-curb-explore-control', /^\/feed\/(explore|trending)/.test(path));
      row.toggleAttribute('data-curb-subscriptions-control', path === '/feed/subscriptions');
    });
    document.querySelectorAll('ytd-guide-section-renderer,yt-guide-section-view-model').forEach(section => {
      const heading = section.querySelector('#guide-section-title,h3,[role="heading"]')?.textContent.trim();
      section.toggleAttribute('data-curb-explore-control', heading?.toLowerCase() === 'explore' || !!section.querySelector('a[href^="/feed/trending"],a[href^="/feed/explore"]'));
      section.toggleAttribute('data-curb-more-control', !!section.querySelector('a[href^="/premium"],a[href^="https://www.youtube.com/premium"],a[href^="https://music.youtube.com"]'));
    });
  }
  function syncThumbnailTabStops(compact = data?.settings.thumbnailMode !== 'show') {
    for (const [link, previous] of thumbnailTabStops) {
      if (!compact || !link.isConnected) {
        if (link.getAttribute('tabindex') === '-1') {
          if (previous === null) link.removeAttribute('tabindex'); else link.setAttribute('tabindex', previous);
        }
        thumbnailTabStops.delete(link);
      }
    }
    if (!compact) return;
    document.querySelectorAll(thumbnailSelector).forEach(container => {
      const nodes = [...container.querySelectorAll('a[href],button,[tabindex]')];
      if (container.matches('a[href],button,[tabindex]')) nodes.push(container);
      nodes.forEach(node => {
        if (!thumbnailTabStops.has(node)) thumbnailTabStops.set(node, node.getAttribute('tabindex'));
        node.setAttribute('tabindex', '-1');
      });
    });
  }
  function applyPrefs() {
    markShortsControls();
    syncThumbnailTabStops();
    document.documentElement.setAttribute('data-curb-thumbnails', data.settings.thumbnailMode || Curb.DEFAULTS.thumbnailMode);
    for (const [key] of Curb.CONTROLS) {
      const attr = `data-curb-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`;
      const enabled = key === 'hideHome' ? data.settings.hideHome && !homeUnlocked()
        : key === 'hideHeader' ? data.settings.hideHeader && !searchReveal : data.settings[key];
      document.documentElement.toggleAttribute(attr, !!enabled);
    }
  }
  function redirectSubscriptions() {
    // Keep subscription redirects separate from state updates.
    const searching = searchEngaged && isNativeSearch(document.activeElement) && !!document.activeElement.value;
    if (!pendingSearch && !searching && data?.settings.redirectSubscriptions && location.pathname === '/feed/subscriptions' && data.session && !desiredMode()) {
      location.replace('https://www.youtube.com/');
    }
  }
  function summaryIntent() {
    const session = data?.session;
    return session && !session.stopped && !session.casual && (!Curb.STORE_BUILD || data.settings.summaryIntent) ? session.intent || '' : '';
  }
  function apply(next, intentSaved = false) {
    const oldId = data?.session?.id, oldIntent = data?.session?.intent, oldMode = data?.session?.mode, wasStopped = data?.session?.stopped;
    const wasEnabled = data?.enabled;
    const oldSummaryIntent = data ? summaryIntent() : null;
    data = next;
    if ((oldId && (oldId !== data.session?.id || oldIntent !== data.session?.intent || oldMode !== data.session?.mode)) || (data.session?.stopped && !wasStopped)) {
      searchGeneration++;
      searchDraft = null; pendingSearch = false;
      try { sessionStorage.removeItem(FOCUS_SEARCH_KEY); } catch { /* Legacy storage may be unavailable. */ }
    }
    if ((oldId && !data.session) || (data.session?.stopped && !wasStopped)) { editing = false; intentDraft = null; }
    if (Curb.STORE_BUILD && editing && (intentSaved || oldIntent !== data.session?.intent)) editing = false;
    if (Curb.STORE_BUILD && !data.enabled) {
      if (wasEnabled) {
        consentDismissed = false; renderSignature = ''; savedSearchDraft = null; selectedPreset = '';
        closeCard(); hidePill(); closeThumbnail(); lockApps(false); syncThumbnailTabStops(false);
        for (const attr of document.documentElement.getAttributeNames())
          if (attr.startsWith('data-curb-')) document.documentElement.removeAttribute(attr);
      }
      render(true);
      return;
    }
    if (!data.settings.localPreviews && cardOrigin === 'preview') closeCard();
    // Also forgets a thumbnail still loading, so it cannot appear after switching away from Hover.
    if (data.settings.thumbnailMode !== 'hover') closeThumbnail();
    if (oldSummaryIntent !== null && oldSummaryIntent !== summaryIntent()) intentChanged();
    // A new session or a changed intent needs every video to be checked again.
    if (oldId !== data.session?.id || oldIntent !== data.session?.intent) { approved = ''; approvedSession = ''; approvedAligned = true; }
    applyPrefs(); render();
  }
  async function request(type, extra = {}) {
    const result = await api.runtime.sendMessage({ type, ...extra });
    if (!result?.ok) {
      // An older background script (extension not reloaded after an update) rejects newer requests.
      if (result?.error === 'Unknown request.') { retire(OUT_OF_SYNC); throw new Error(OUT_OF_SYNC); }
      throw new Error(result?.error || 'Extension unavailable. Reload this YouTube tab.');
    }
    return result.data;
  }
  async function action(type, extra = {}) {
    if (busy) return;
    busy = true; errorText = '';
    try { apply(await request(type, extra)); }
    catch (error) { errorText = error.message; render(true); }
    finally { busy = false; }
  }
  async function goHome() {
    if (busy) return;
    busy = true; errorText = '';
    try {
      let next = await request('GET');
      if (next.session?.stopped) throw new Error('Start a new session or choose Just browse before searching or going Home.');
      if (next.session?.breakDue) throw new Error('Continue or finish your break before searching or going Home.');
      if (!next.session) next = await request('BROWSE', { expectedId: null });
      editing = false; intentDraft = null; apply(next);
      await requestSearchAfterLoad('', 'https://www.youtube.com/');
      location.href = 'https://www.youtube.com/';
    } catch (error) { errorText = error.message; render(true); }
    finally { busy = false; }
  }
  async function browse(home = false) {
    if (busy) return;
    busy = true; errorText = '';
    try {
      clearSearchRequest();
      const next = await request('BROWSE', { expectedId: data?.session?.id || null });
      editing = false; intentDraft = null; apply(next);
      if (home === true && location.href !== 'https://www.youtube.com/') location.href = 'https://www.youtube.com/';
      else redirectSubscriptions();
    }
    catch (error) { errorText = error.message; render(true); }
    finally { busy = false; }
  }
  function editIntent() {
    selectedPreset = Curb.PRESETS.includes(data?.session?.intent) ? data.session.intent : '';
    editing = true; intentDraft = '';
    editingSessionId = data?.session?.id || null; editingIntent = data?.session?.intent ?? null; render();
  }
  function nativeSearchInput() {
    // YouTube's newer (signed-in) search box is a <textarea name="search_query">; older ones use <input>.
    return [...document.querySelectorAll('input[name="search_query"], textarea[name="search_query"], yt-searchbox textarea, ytd-searchbox textarea, ytd-searchbox input:not([type="file"]):not([type="hidden"]), yt-searchbox input:not([type="file"]):not([type="hidden"]), ytm-searchbox input, ytm-search-box input, ytm-mobile-topbar-renderer input[type="text"], input.searchbox-input')].find(node => node.getClientRects().length);
  }
  // Focus YouTube's own search box. With text, fill it the way typing would so
  // YouTube opens its own suggestion list; nothing is submitted for the user.
  function fillNativeSearch(text = '', clear = false) {
    if (data?.settings.hideHeader && !searchReveal) { searchReveal = true; applyPrefs(); }
    const input = nativeSearchInput();
    if (!input) {
      const trigger = [...document.querySelectorAll('ytm-mobile-topbar-renderer button.topbar-button-search-button,ytm-mobile-topbar-renderer button[aria-label="Search YouTube"],ytm-mobile-topbar-renderer button[aria-label="Search"]')]
        .find(button => button.getBoundingClientRect().height > 0 && getComputedStyle(button).visibility !== 'hidden');
      trigger?.click();
      return false;
    }
    fillingSearch = true;
    searchEngaged = true;
    input.focus();
    if (text || clear) {
      input.value = text;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      input.setSelectionRange(text.length, text.length);
    } else
    input.select();
    fillingSearch = false;
    return true;
  }
  function focusSearch() {
    // A prompt makes YouTube inert, so search from the homepage instead.
    if (desiredMode()) { goHome(); return false; }
    return fillNativeSearch();
  }
  async function requestSearchAfterLoad(text, url = location.href) {
    pendingSearch = true;
    const sessionId = data.session.id, intent = data.session.intent, generation = searchGeneration;
    await request('SEARCH_SAVE', { text, url, page: PAGE_LOAD, sessionId });
    if (generation !== searchGeneration || data.session?.id !== sessionId || data.session?.intent !== intent || data.session.stopped)
      throw new Error('Your session changed. Please try again.');
    searchDraft = { text, url, at: Date.now(), sessionId, intent }; searchChecked = true;
  }
  function clearSearchRequest() {
    searchGeneration++;
    searchDraft = null; searchChecked = true; pendingSearch = false;
    request('SEARCH_CLEAR').catch(() => {});
  }
  // Offer YouTube's suggestions for typed search terms; if a prompt (such as a video
  // check) covers this page, continue on the homepage where the search box is usable.
  async function searchWithSuggestions(text) {
    if (!desiredMode()) {
      await requestSearchAfterLoad(text);
      if (fillNativeSearch(text, true)) { searchDraft = null; pendingSearch = false; }
      return;
    }
    const home = new URL('/', location.href).href;
    await requestSearchAfterLoad(text, home);
    location.href = home;
  }
  async function resumeSearchFocus() {
    if (mode || !data || searchLoading) return;
    searchLoading = true;
    try {
      if (!searchChecked) {
        const generation = searchGeneration, sessionId = data.session?.id, intent = data.session?.intent;
        const next = await request('SEARCH_GET', { page: PAGE_LOAD });
        if (generation !== searchGeneration || data.session?.id !== sessionId || data.session?.intent !== intent || desiredMode()) return;
        searchChecked = true;
        searchDraft = next.searchRequest ? { ...next.searchRequest, intent: next.session?.intent } : null;
      }
      if (!searchDraft) return;
      if (data.session?.id !== searchDraft.sessionId || data.session?.intent !== searchDraft.intent || desiredMode()) { clearSearchRequest(); return; }
      if (Date.now() - searchDraft.at > 15000) { clearSearchRequest(); return; }
      if (fillNativeSearch(searchDraft.text, true)) { searchDraft = null; pendingSearch = false; }
    } catch { /* A heartbeat retries after the background reconnects. */ }
    finally { searchLoading = false; }
  }
  async function chooseIntent(intent, query = '', savedQuery = '') {
    if (busy) return false;
    busy = true; pendingSearch = !!(savedQuery || (!Curb.STORE_BUILD && query)); errorText = '';
    try {
      const editingLive = editing && editingSessionId && data?.session && !data.session.stopped;
      const next = editingLive ? await request('EDIT_INTENT', { sessionId: editingSessionId, expectedIntent: editingIntent, intent })
        : await request('START', { intent, expectedId: editing ? editingSessionId : data?.session?.id || null });
      editing = false; intentDraft = null; selectedPreset = '';
      approved = ''; approvedSession = ''; approvedAligned = true;
      apply(next);
      if (savedQuery) location.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(savedQuery)}`;
      else if (query) await searchWithSuggestions(query);
      else { clearSearchRequest(); redirectSubscriptions(); if (!desiredMode()) fillNativeSearch('', !Curb.STORE_BUILD); }
      return true;
    } catch (error) {
      pendingSearch = false;
      errorText = error.message;
      // Keep the draft and refresh the expected intent for a retry.
      try { const latest = await request('GET'); editingSessionId = latest.session?.id || null; editingIntent = latest.session?.intent ?? null; apply(latest); } catch { render(true); }
      return false;
    } finally { busy = false; }
  }
  function mount() {
    // Mount in the fullscreen top layer when its element can render children.
    const full = document.fullscreenElement;
    const parent = full && !(full instanceof HTMLMediaElement) ? full : document.documentElement;
    // YouTube's theme variables stop at ytd-app.
    host.toggleAttribute('data-yt-dark', document.documentElement.hasAttribute('dark'));
    if (host.parentNode !== parent) parent.append(host);
    host.toggleAttribute('data-fullscreen', !!full);
    document.documentElement.setAttribute('data-curb-ready', '');
    positionStatus();
  }
  function positionStatus() {
    if (Curb.STORE_BUILD && !data?.enabled) return;
    if (document.fullscreenElement) { host.removeAttribute('data-player-visible'); return; }
    const player = document.querySelector('#movie_player, .html5-video-player, #player video, video');
    const r = player?.getBoundingClientRect();
    const dockTop = shadow.querySelector('.bar')?.getBoundingClientRect().top || innerHeight;
    const header = document.querySelector('#masthead-container, ytm-mobile-topbar-renderer')?.getBoundingClientRect();
    const headerBottom = header && header.width > 0 && header.top <= 0 ? Math.max(0, header.bottom) : 0;
    const top = r ? Math.max(headerBottom + 8, r.top + 12) : 0;
    const left = r ? Math.max(0, r.left) : 0;
    const right = r ? Math.min(r.right, innerWidth) : 0;
    const visible = !!r && right - left >= 160 && r.height >= 90 && top + 36 < Math.min(dockTop, r.bottom - 40);
    host.toggleAttribute('data-player-visible', visible);
    if (!visible) return;
    const width = right - left - 24;
    host.style.setProperty('--curb-player-top', `${top}px`);
    host.style.setProperty('--curb-player-center', `${(left + right) / 2}px`);
    host.style.setProperty('--curb-player-width', `${width}px`);
  }
  function schedulePosition() {
    if (!positionFrame) positionFrame = requestAnimationFrame(() => { positionFrame = 0; positionStatus(); placeCard(); });
  }
  const playerSize = new ResizeObserver(schedulePosition);
  let observedPlayer = null;
  function observePlayer() {
    const player = document.querySelector('#movie_player, .html5-video-player, #player video, video');
    if (player !== observedPlayer) { playerSize.disconnect(); observedPlayer = player; if (player) playerSize.observe(player); }
    positionStatus();
  }
  function lockApps(locked) {
    document.querySelectorAll('ytd-app, ytm-app').forEach(app => {
      if (locked && !app.inert) { app.inert = true; app.setAttribute('data-curb-inert', ''); }
      else if (!locked && app.hasAttribute('data-curb-inert')) { app.inert = false; app.removeAttribute('data-curb-inert'); }
    });
  }
  function render(force = false) {
    if (retired) return;
    if (Curb.STORE_BUILD && !data?.enabled) {
      mode = '';
      if (consentDismissed || (!data && !errorText)) return;
      if (!host.isConnected) document.documentElement.append(host);
      const notice = el('section', { class: 'card consent', 'aria-labelledby': 'curb-enable' });
      notice.append(el('h1', { id: 'curb-enable' }, 'Enable Curb on YouTube'));
      notice.append(el('p', {}, 'Curb reads YouTube pages to hide distractions and track watch time. Curb stores your data in this Chrome profile.'));
      const actions = el('div', { class: 'actions' });
      actions.append(button('Enable Curb', event => { if (event.isTrusted) action('ENABLE'); }),
        button('Not now', () => { consentDismissed = true; host.remove(); }, 'secondary'));
      if (errorText) notice.append(el('p', { class: 'error', role: 'alert' }, errorText));
      notice.append(actions); ui.replaceChildren(notice);
      return;
    }
    mount();
    const nextMode = desiredMode();
    document.documentElement.toggleAttribute('data-curb-locked', !!nextMode);
    lockApps(!!nextMode);
    if (nextMode) {
      pause(); thumbnailTip.hidden = true; closeCard();
      hidePill();
    }
    const signature = `${nextMode}:${data?.session?.id || ''}:${data?.session?.mode}:${Curb.videoKey(location.href)}:${location.pathname}:${data?.settings.hideHome}:${data?.settings.breakMinutes}:${data?.settings.homeMinutes}:${homeUnlocked()}:${data?.session?.intent}:${data?.session?.casual}:${data?.settings.fullscreenPill}:${data?.settings.hideHeader}:${approvedAligned}:${errorText}:${JSON.stringify(data?.savedSearches || [])}`;
    if (!force && renderSignature === signature) { updateTimes(); return; }
    const previousFocus = shadow.activeElement;
    const previousSelection = previousFocus instanceof HTMLInputElement ? [previousFocus.selectionStart, previousFocus.selectionEnd] : null;
    mode = nextMode;
    renderSignature = signature; ui.replaceChildren();
    const bar = el('header', { class: 'bar', 'aria-label': 'Your YouTube intention' });
    const intent = el('div', { class: 'intent', title: data?.session?.intent || 'No intent set' });
    const browsing = data?.session?.mode === 'browse';
    if (!browsing || !data.session.casual) intent.append(el('span', { class: 'overline' }, browsing ? 'Browsing · intent paused' : 'Intent'));
    intent.append(el('span', {}, data?.session?.intent || 'None set')); bar.append(intent);
    const casual = !!data?.session?.casual;
    // YouTube's own search box is always present unless the user hid its header.
    if (!mode && data?.settings.hideHeader) bar.append(button('Search YouTube', focusSearch, ''));
    for (const [name, label, cls] of [['intent', 'Intent time', ''], ['session', 'Session', ''], ['total', 'YouTube today', 'overall']]) {
      const metric = el('div', { class: `metric ${cls}` });
      metric.append(el('span', { class: 'overline' }, label), el('b', { 'data-time': name }, '0:00')); bar.append(metric);
    }
    if (data?.session && !data.session.stopped && !data.session.breakDue) {
      if (!mode && data.session.mode !== 'browse' && location.pathname === '/' && (!data.settings.hideHome || data.homeRemainingMs > 0)) {
        if (data.settings.hideHome) bar.append(el('span', { class: 'home-countdown', 'data-home-time': '' }));
        bar.append(button('Hide homepage', () => data.settings.hideHome
          ? action('HOME_HIDE', { sessionId: data.session.id })
          : action('SETTINGS', { settings: { hideHome: true } }), ''));
      }
      if (data.session.mode === 'browse') bar.append(el('span', { 'data-browse-time': '' }));
      bar.append(button(casual ? 'Set intent' : 'Edit intent', editIntent, ''));
      if (data.session.mode === 'browse' && !casual) bar.append(button('Resume intent', () => { approved = ''; action('FOCUS', { sessionId: data.session.id }); }, ''));
      bar.append(button('Finish', () => action('STOP', { sessionId: data.session.id }), ''));
    }
    ui.append(bar);
    barSize.disconnect(); barSize.observe(bar);
    if (data?.session && !mode && data.settings.fullscreenPill && (document.fullscreenElement || Curb.videoKey(location.href))) {
      const pill = el('aside', { class: 'fullscreen-pill', 'aria-label': 'Current intent and session time' });
      const focused = focusedActivity();
      pill.append(el('span', { class: 'fullscreen-pill-intent' }, focused ? data.session.intent : 'Browsing · ' + data.session.intent));
      const time = el('span', { class: 'fullscreen-pill-time' }, 'Session ');
      time.append(el('b', { 'data-time': 'session-short' }, Curb.formatSession(data.session.totalMs))); pill.append(time); ui.append(pill);
    }
    if (mode) renderModal();
    else if (location.pathname === '/' && data.settings.hideHome && !homeUnlocked()) {
      const home = el('section', { class: 'home' });
      home.append(el('h1', {}, 'Search or browse'));
      const actions = el('div', { class: 'actions' });
      actions.append(button(`Browse homepage for ${data.settings.homeMinutes} min`, () => action('HOME_BROWSE', { sessionId: data.session.id })));
      if (data.settings.hideHeader) actions.append(button('Search YouTube', focusSearch, 'secondary'));
      home.append(actions);
      ui.append(home);
    }
    if (!mode && errorText) ui.append(el('div', { class: 'preview error', role: 'alert' }, errorText));
    updateTimes();
    const replacementFocus = previousFocus?.id ? shadow.getElementById(previousFocus.id) : null;
    if (replacementFocus) { replacementFocus.focus(); if (previousSelection && replacementFocus.type !== 'search') replacementFocus.setSelectionRange(...previousSelection); }
    else if (mode) queueMicrotask(() => shadow.querySelector('.card button, .card input')?.focus());
    else resumeSearchFocus();
  }
  function renderModal() {
    const veil = el('div', { class: 'veil' });
    const card = el('section', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'curb-title' });
    const headline = text => card.append(el('h1', { id: 'curb-title' }, text));
    const description = text => { card.setAttribute('aria-describedby', 'curb-description'); card.append(el('p', { id: 'curb-description' }, text)); };
    if (mode === 'loading') {
      headline('Loading session…');
      card.append(button('Retry', () => tick()));
    } else if (mode === 'intent') {
      card.classList.add('intent-card');
      headline('What brings you to YouTube?');
      const presets = el('div', { class: 'presets' });
      const input = Curb.STORE_BUILD ? null : el('input', { id: 'curb-intent', type: 'text', maxlength: String(Curb.LIMITS.intent), placeholder: 'e.g. Understand Python list comprehensions', autocomplete: 'off' });
      if (input) input.value = intentDraft ?? '';
      for (const preset of Curb.PRESETS) {
        const b = button(preset, () => {
          selectedPreset = preset;
          input?.setCustomValidity('');
          presets.querySelectorAll('[aria-pressed]').forEach(item => item.setAttribute('aria-pressed', String(item === b)));
          submit.disabled = false;
        }, 'preset');
        b.setAttribute('aria-pressed', String(selectedPreset === preset)); presets.append(b);
      }
      const form = el('form');
      form.append(presets);
      if (input) form.append(el('label', { for: 'curb-intent' }, 'Your intent'), input);
      const actions = el('div', { class: 'actions' });
      const submit = el('button', { class: 'primary', type: 'submit' }, 'Start session'); actions.append(submit);
      if (Curb.STORE_BUILD) {
        submit.disabled = !selectedPreset;
        actions.append(button('Custom intent…', event => { if (event.isTrusted) action('OPTIONS', { section: 'edit-intent' }); }, 'secondary'));
      }
      if (editing && data?.session && !data.session.stopped) actions.append(button('Keep current intent', () => { editing = false; intentDraft = null; render(); }, 'secondary'));
      actions.append(button('Just browse', () => browse(true), 'secondary'));
      form.append(actions);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const queryText = input?.value.trim() || '';
        const chosenIntent = queryText || selectedPreset;
        if (Curb.clean(chosenIntent).length < 3) {
          input?.setCustomValidity('Choose a preset or enter at least 3 characters.'); input?.reportValidity(); return;
        }
        submit.disabled = true;
        try { await chooseIntent(chosenIntent, queryText); } finally { submit.disabled = false; }
      });
      input?.addEventListener('input', () => { intentDraft = input.value; selectedPreset = ''; input.setCustomValidity(''); presets.querySelectorAll('[aria-pressed]').forEach(b => b.setAttribute('aria-pressed', 'false')); });
      card.append(form);
      if (Curb.STORE_BUILD) {
        for (const item of data.savedSearches || []) {
          const launch = button(item.label, event => { if (event.isTrusted) chooseIntent(item.label, '', item.query); }, 'preset');
          launch.setAttribute('aria-label', `Search YouTube for ${item.label}`);
          launch.title = `Search YouTube for ${item.query}`;
          launch.append(el('span', { 'aria-hidden': 'true' }, ' ↗'));
          presets.append(launch);
        }
        presets.append(button('Manage saved searches…', event => { if (event.isTrusted) action('OPTIONS', { section: 'saved-searches' }); }, 'preset saved-search-add'));
      } else {
        const editor = el('form', { class: 'saved-search-form' }); editor.hidden = !savedSearchDraft;
        const name = el('input', { id: 'curb-search-name', type: 'text', maxlength: '48', minlength: '3', required: '' });
        const query = el('input', { id: 'curb-search-query', type: 'text', maxlength: '180', required: '' });
        let editId = savedSearchDraft?.id || null;
        name.value = savedSearchDraft?.label || ''; query.value = savedSearchDraft?.query || '';
        const rememberSearch = () => { savedSearchDraft = { id: editId, label: name.value, query: query.value }; };
        name.addEventListener('input', rememberSearch); query.addEventListener('input', rememberSearch);
        const openEditor = item => {
          editId = item?.id || null; name.value = item?.label || ''; query.value = item?.query || '';
          rememberSearch(); editor.hidden = false; name.focus();
        };
        for (const item of data.savedSearches || []) {
          const entry = el('div', { class: 'saved-search' });
          const launch = button(item.label, event => { if (event.isTrusted) chooseIntent(item.label, '', item.query); }, 'preset saved-search-launch');
          launch.title = item.query; entry.append(launch);
          const tools = el('div', { class: 'saved-search-actions' });
          const edit = button('Edit', () => openEditor(item), 'secondary'); edit.setAttribute('aria-label', `Edit ${item.label}`);
          const remove = button('Remove', () => action('DELETE_SEARCH', { id: item.id }), 'secondary'); remove.setAttribute('aria-label', `Remove ${item.label}`);
          tools.append(edit, remove); entry.append(tools); presets.append(entry);
        }
        if ((data.savedSearches || []).length < 6) presets.append(button('+ Add search', () => openEditor(), 'preset saved-search-add'));
        editor.append(el('label', { for: name.id }, 'Name'), name, el('label', { for: query.id }, 'Search terms'), query);
        const editorActions = el('div', { class: 'actions' });
        const save = el('button', { type: 'submit', class: 'primary' }, 'Save search');
        editorActions.append(save, button('Cancel', () => { savedSearchDraft = null; editor.hidden = true; }, 'secondary')); editor.append(editorActions);
        editor.addEventListener('submit', async event => {
          event.preventDefault(); if (busy) return; busy = true; save.disabled = true;
          try {
            const next = await request('SAVE_SEARCH', { search: { ...(editId ? { id: editId } : {}), label: name.value, query: query.value } });
            savedSearchDraft = null; errorText = ''; apply(next); render(true);
          } catch (error) {
            editor.querySelector('[role=alert]')?.remove(); editor.append(el('p', { class: 'error', role: 'alert' }, error.message));
          } finally { busy = false; save.disabled = false; }
        });
        card.append(editor);
      }
    } else if (mode === 'browse-ended') {
      headline('Browse time is up');
      const actions = el('div', { class: 'actions' });
      actions.append(button('Set intent', editIntent));
      actions.append(button('Just browse 5 more min', () => browse(), 'secondary'));
      if (!data.session.casual) actions.append(button('Resume intent', () => action('FOCUS', { sessionId: data.session.id }), 'secondary'));
      actions.append(button('Finish', () => action('STOP', { sessionId: data.session.id }), 'secondary')); card.append(actions);
    } else if (mode === 'align') {
      headline('Does this video fit your intent?'); description(`Your intent: ${data.session.intent}`);
      card.append(el('div', { class: 'video-title', 'data-video-title': '' }, videoTitle()));
      const actions = el('div', { class: 'actions' });
      const approve = aligned => { approved = Curb.videoKey(location.href); approvedSession = data.session.id; approvedAligned = aligned; render(); tick(); };
      actions.append(button('Yes, this fits', () => approve(true)), button('Watch as a detour', () => approve(false), 'secondary'), button('Search instead', focusSearch, 'secondary'));
      card.append(actions);
    } else if (mode === 'break') {
      headline('Keep watching?');
      card.append(summary());
      const actions = el('div', { class: 'actions' }); actions.append(button('Finish for now', () => action('STOP', { sessionId: data.session.id })), button(`Continue for ${data.settings.breakMinutes} min`, () => action('CONTINUE', { sessionId: data.session.id }), 'secondary')); card.append(actions);
    } else if (mode === 'stopped') {
      headline('Session finished');
      const actions = el('div', { class: 'actions' });
      actions.append(button('Set intent', editIntent), button('Just browse', () => browse(true), 'secondary'));
      card.append(summary(), actions);
    } else if (mode === 'shorts') {
      headline('Shorts are hidden');
      const actions = el('div', { class: 'actions' });
      actions.append(button('Search YouTube', focusSearch), button('Open settings', () => action('OPTIONS'), 'secondary')); card.append(actions);
    }
    if (errorText) card.append(el('p', { class: 'error', role: 'alert' }, errorText));
    veil.append(card); ui.append(veil);
  }
  function summary() {
    const box = el('div', { class: 'summary' });
    for (const [key, label] of [['intent', 'Intent time'], ['session', 'This session'], ['total', 'YouTube today']]) {
      const div = el('div'); div.append(el('b', { 'data-time': key }, ''), el('span', {}, label)); box.append(div);
    }
    return box;
  }
  function updateTimes() {
    observePlayer();
    const homeTime = shadow.querySelector('[data-home-time]');
    const browseTime = shadow.querySelector('[data-browse-time]');
    if (browseTime) browseTime.textContent = `Browse ${Curb.format(data?.browseRemainingMs)}`;
    if (homeTime) homeTime.textContent = `Home ${Curb.format(data?.homeRemainingMs)}`;
    shadow.querySelectorAll('[data-time]').forEach(node => {
      const key = node.getAttribute('data-time');
      const text = key === 'session-short' ? Curb.formatSession(data?.session?.totalMs)
        : Curb.format(key === 'total' ? data?.total.ms : key === 'session' ? data?.session?.totalMs : data?.session?.intentMs);
      if (node.textContent !== text) node.textContent = text;
    });
    if (mode === 'align') {
      const title = shadow.querySelector('[data-video-title]'); if (title) title.textContent = videoTitle();
    }
  }
  function navigation() {
    if (route === location.href) return;
    // Reset on every video transition, including going back to a previously approved video.
    if (Curb.videoKey(route) !== Curb.videoKey(location.href)) { approved = ''; approvedAligned = true; }
    const previous = new URL(route), current = new URL(location.href);
    previous.hash = ''; current.hash = '';
    route = location.href; closeCard();
    if (previous.href !== current.href) {
      clearSearchRequest();
      if (searchReveal) { searchReveal = false; if (data) applyPrefs(); }
    }
    render(); redirectSubscriptions();
  }
  function enforceAutoplay() {
    if (!data?.settings.disableAutoplay) return;
    const toggle = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle) toggle.click();
  }
  // After an extension update/reload this script is orphaned: release the page instead of gating it.
  function retire(message = 'Curb Your YouTube was updated. Reload this tab. ') {
    if (retired) return;
    retired = true; clearInterval(heartbeat); observer.disconnect(); playerSize.disconnect(); barSize.disconnect();
    lockApps(false); document.documentElement.removeAttribute('data-curb-locked');
    host.removeAttribute('data-player-visible'); closeCard(); thumbnailTip.hidden = true;
    const notice = el('div', { class: 'preview error', role: 'alert' }, message);
    notice.append(button('Reload', () => location.reload(), 'secondary'));
    ui.replaceChildren(notice);
  }
  async function tick() {
    if (inFlight || retired) return;
    inFlight = true;
    try {
      if (Curb.STORE_BUILD && !data?.enabled) {
        const next = await request('GET');
        if (!data || next.enabled) { errorText = ''; apply(next); }
        return;
      }
      navigation();
      const playing = [...document.querySelectorAll('video')].some(v => !v.paused && !v.ended);
      const active = (document.visibilityState === 'visible' && document.hasFocus()) || playing;
      const homeBrowsing = location.pathname === '/' && data?.session?.mode !== 'browse' && document.visibilityState === 'visible' && document.hasFocus() && !desiredMode();
      const recovering = !data;
      const next = await request('TICK', { active, homeBrowsing, aligned: focusedActivity(), sessionId: data?.session?.id || '' });
      if (recovering) errorText = '';
      apply(next); enforceAutoplay(); resumeSearchFocus();
      if (!busy) redirectSubscriptions();
    } catch (error) {
      if (!api.runtime?.id || /context invalidated/i.test(error?.message || '')) { retire(); return; }
      data = null; errorText = error.message; render(true);
    }
    finally { inFlight = false; }
  }
  let summaryToken = 0;
  const FIT_LABELS = { yes: 'Fits your intent', partly: 'Partly fits your intent', no: 'Does not fit your intent' };
  function renderSummary(box, videoId, result) {
    const rows = [];
    if (result.clipped) rows.push(el('small', { class: 'summary-scope' }, 'First 5 minutes'));
    if (result.summary) rows.push(el('p', {}, result.summary));
    if (FIT_LABELS[result.fitsIntent]) {
      const fit = el('div', { class: 'intent-fit' });
      fit.append(el('strong', {}, FIT_LABELS[result.fitsIntent]));
      if (result.verdict) fit.append(el('p', {}, result.verdict));
      rows.push(fit);
    }
    if (result.keyPoints?.length) {
      const list = el('ul');
      for (const item of result.keyPoints) {
        const row = el('li');
        const seconds = /^\d+(:\d{1,2}){1,2}$/.test(item.time) ? item.time.split(':').reduce((total, part) => total * 60 + Number(part), 0) : null;
        if (seconds !== null) row.append(el('a', { href: `https://www.youtube.com/watch?v=${videoId}&t=${seconds}s` }, item.time));
        row.append(el('span', {}, item.point)); list.append(row);
      }
      rows.push(list);
    }
    box.replaceChildren(...rows);
    placeCard();
  }
  let streamTarget = null;
  async function summarizeVideo(videoId, durationSeconds, moveFocus) {
    clearTimeout(previewTimeout);
    if (moveFocus) tip.querySelector('.preview-close').focus();
    tip.querySelector('.ai-summary')?.remove();
    const box = el('div', { class: 'ai-summary' });
    const status = el('div', { class: 'summary-status', role: 'status' });
    const body = el('div');
    box.append(status, body);
    tip.classList.add('expanded'); tip.append(box);
    status.textContent = 'Summarizing with Gemini…';
    placeCard();
    const requestId = `${videoId}-${++summaryToken}-${Math.random().toString(36).slice(2, 8)}`;
    const target = { requestId, body, videoId };
    streamTarget = target;
    try {
      const result = await request('SUMMARIZE', { videoId, durationSeconds, requestId });
      if (streamTarget !== target || tip.hidden) return;
      if (result.intent !== summaryIntent()) return intentChanged();
      status.setAttribute('data-complete', '');
      status.textContent = 'Summary ready.';
      renderSummary(body, videoId, result);
    } catch (error) {
      if (streamTarget !== target || tip.hidden) return;
      status.remove();
      body.replaceChildren(el('p', { class: 'error', role: 'alert' }, error.message));
      if (/Settings/.test(error.message)) body.append(button('Open settings', () => action('OPTIONS', { section: 'summaries' }), 'summarize'));
      else body.append(button('Retry', event => { if (event.isTrusted) summarizeVideo(videoId, durationSeconds, event.detail === 0); }, 'summarize'));
      placeCard();
    } finally { if (streamTarget === target) streamTarget = null; }
  }
  // Discard verdicts tied to the previous intent.
  function intentChanged() {
    if (tip.hidden || (!tip.querySelector('.ai-summary') && !streamTarget)) return;
    const link = cardLink, origin = cardOrigin;
    if (!link?.isConnected) return closeCard();
    const focused = tip.contains(shadow.activeElement);
    openPreview(link, origin);
    tip.querySelector('.preview-detail').append(el('p', { class: 'summary-status', role: 'status' }, 'Your intent changed.'));
    if (focused) tip.querySelector('.summarize')?.focus();
    placeCard();
  }
  function showProgress(message) {
    const target = streamTarget;
    if (!target || message.requestId !== target.requestId || tip.hidden) return;
    const partial = message.partial || {};
    if (!partial.verdict && !partial.summary) return;
    renderSummary(target.body, target.videoId, {
      verdict: Curb.clean(partial.verdict, 300), summary: Curb.clean(partial.summary, 700),
      fitsIntent: ['yes', 'partly', 'no'].includes(partial.fitsIntent) ? partial.fitsIntent : '',
      keyPoints: (Array.isArray(partial.keyPoints) ? partial.keyPoints : []).slice(0, 4).map(item => ({ time: Curb.clean(item?.time, 12), point: Curb.clean(item?.point, 240) })).filter(item => item.point)
    });
  }
  function localPreview(event) {
    if (!data?.settings.localPreviews || (Curb.STORE_BUILD && !data.enabled)) return;
    const link = event.target.closest?.('a[href]');
    if (!link || !Curb.videoKey(link.href)) return;
    openPreview(link, 'preview');
    // Deliberately do not preventDefault: the browser's normal menu remains available.
  }
  let cardSource = null, cardOrigin = null, cardLink = null, lastPointer = { x: -1, y: -1 };
  // Where the pointer really is: enter/leave events do not fire when the card appears under a still pointer.
  document.addEventListener('pointermove', event => { lastPointer = { x: event.clientX, y: event.clientY }; }, { capture: true, passive: true });
  function pointerOnCard() {
    if (tip.hidden) return false;
    const r = tip.getBoundingClientRect();
    return lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom;
  }
  // Keep a preview open while the pointer is over it.
  function scheduleAutoClose(delay = Curb.LIMITS.previewMs) {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(function check() {
      if (tip.hidden || tip.classList.contains('expanded')) return;
      if (pointerOnCard()) { previewTimeout = setTimeout(check, 1500); return; } // look again shortly
      closeCard();
    }, delay);
  }
  const overlapArea = (a, b) => b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : 0;
  function cardArea() {
    const barTop = shadow.querySelector('.bar')?.getBoundingClientRect().top || innerHeight;
    const head = document.querySelector('#masthead-container, ytm-mobile-topbar-renderer')?.getBoundingClientRect();
    const top = head && head.height > 0 && head.bottom > 0 && head.top <= 0 ? head.bottom + 8 : 8;
    return { left: 8, top, right: innerWidth - 8, bottom: Math.min(innerHeight, barTop) - 8 };
  }
  function placeCard() {
    if (tip.hidden || !cardSource) return;
    const area = cardArea(), room = Math.max(0, area.bottom - area.top);
    tip.style.right = 'auto'; tip.style.bottom = 'auto'; tip.style.maxHeight = `${room}px`;
    const player = document.fullscreenElement ? null : document.querySelector('#movie_player')?.getBoundingClientRect();
    // On a watch page the sidebar is narrower than the card: fit the card beside the player rather than over it.
    const besidePlayer = player && player.width > 0 ? area.right - (player.right + 12) : 0;
    const expanded = tip.classList.contains('expanded');
    tip.style.width = besidePlayer >= 300 && besidePlayer < (expanded ? 440 : 370) ? `${Math.floor(besidePlayer)}px` : '';
    const w = tip.offsetWidth, h = Math.min(tip.offsetHeight, room);
    const src = cardSource.isConnected ? cardSource.getBoundingClientRect() : null;
    const titleNode = cardSource.querySelector('#video-title, .yt-lockup-metadata-view-model__title');
    const anchor = titleNode?.getClientRects().length ? titleNode : cardLink;
    const title = anchor?.getClientRects().length ? anchor.getBoundingClientRect() : src;
    const fitX = x => Math.min(Math.max(x, area.left), area.right - w);
    const fitY = y => Math.min(Math.max(y, area.top), area.bottom - h);
    const gap = 8;
    const spots = src && title ? [
      [src.right + gap, title.top],
      [src.left - gap - w, title.top],
      [title.left, src.bottom + gap],
      [title.left, src.top - gap - h],
      [title.right - w, src.bottom + gap],
      [title.right - w, src.top - gap - h]
    ] : [];
    spots.push([area.right - w, area.bottom - h], [area.left, area.bottom - h]);
    // Keep the title and player clear, then use the nearest spot that covers the least of the tile.
    const candidates = spots.map(([x, y]) => {
      const left = fitX(x), top = fitY(y);
      const box = { left, top, right: left + w, bottom: top + h };
      const distance = title ? Math.hypot(
        Math.max(title.left - box.right, box.left - title.right, 0),
        Math.max(title.top - box.bottom, box.top - title.bottom, 0)) : 0;
      return { left, top, blocked: overlapArea(box, title) + overlapArea(box, player), covered: overlapArea(box, src), distance };
    });
    const best = candidates.reduce((best, next) => {
      const order = next.blocked - best.blocked || next.covered - best.covered || next.distance - best.distance;
      return order < 0 ? next : best;
    });
    tip.style.left = `${best.left}px`; tip.style.top = `${best.top}px`;
  }
  // Hover popups never cover the open card (with a small margin so they do not crowd it either).
  function overlapsCard(rect) {
    if (tip.hidden) return false;
    const card = tip.getBoundingClientRect(), margin = 16;
    return overlapArea({ left: card.left - margin, top: card.top - margin, right: card.right + margin, bottom: card.bottom + margin }, rect) > 0;
  }
  function closeCard(restoreFocus = false) {
    const focus = restoreFocus && tip.contains(shadow.activeElement) ? cardLink : null;
    clearTimeout(previewTimeout);
    streamTarget = null;
    tip.hidden = true; cardSource = null; cardOrigin = null; cardLink = null;
    focus?.focus({ preventScroll: true });
  }
  function openPreview(link, origin) {
    const card = link.closest('ytd-video-renderer,ytd-rich-item-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model,ytm-video-with-context-renderer') || link;
    // Try selectors in order to skip YouTube's duplicate labels and empty placeholders.
    const text = (...selectors) => selectors.flatMap(selector => [...card.querySelectorAll(selector)]).map(node => node.textContent.trim()).find(Boolean);
    const info = Curb.preview({
      title: text('#video-title', '.yt-lockup-metadata-view-model__title') || link.getAttribute('title') || link.textContent,
      channel: text('#channel-name #text', '#channel-name yt-formatted-string', '.yt-content-metadata-view-model__metadata-text'),
      description: text('.metadata-snippet-text', '#description-text'),
      duration: text('ytd-thumbnail-overlay-time-status-renderer badge-shape', '.yt-badge-shape__text', 'ytd-thumbnail-overlay-time-status-renderer #text')
    });
    const videoId = Curb.videoKey(link.href);
    const durationText = text('ytd-thumbnail-overlay-time-status-renderer badge-shape', '.yt-badge-shape__text', 'ytd-thumbnail-overlay-time-status-renderer #text') || '';
    const durationSeconds = /^\d+(:\d{1,2}){1,2}$/.test(durationText) ? durationText.split(':').reduce((total, part) => total * 60 + Number(part), 0) : 0;
    streamTarget = null;
    tip.classList.remove('expanded');
    const header = el('div', { class: 'preview-head' });
    const dismiss = button('×', () => closeCard(true), 'preview-close');
    dismiss.setAttribute('aria-label', 'Close video card');
    header.append(el('b', { id: 'curb-preview-title' }, info.title), dismiss);
    const details = el('div', { class: 'preview-detail' });
    details.append(el('p', {}, info.text), el('small', {}, info.source));
    tip.replaceChildren(header, details);
    // Require a trusted click because page scripts can reach the local build's shadow root.
    if (!/^\/shorts\//.test(new URL(link.href).pathname)) tip.append(button('Summarize', event => { if (event.isTrusted) summarizeVideo(videoId, durationSeconds, event.detail === 0); }, 'summarize'));
    tip.hidden = false; cardSource = card; cardOrigin = origin; cardLink = link; placeCard();
    scheduleAutoClose();
    return { videoId, durationSeconds };
  }
  let pillLink = null, pillHovered = false, pillTimer = 0;
  function hidePill() { clearTimeout(pillTimer); summarizePill.hidden = true; pillLink = null; }
  function hidePillSoon() { clearTimeout(pillTimer); pillTimer = setTimeout(() => { if (!pillHovered) hidePill(); }, 450); }
  function showPill(event) {
    if (retired || !data?.summaries?.ready || desiredMode() || (Curb.STORE_BUILD && !data.enabled)) return;
    const link = event.target.closest?.('a[href]');
    const card = link?.closest(previewCardSelector);
    if (!card || !Curb.videoKey(link.href) || /^\/shorts\//.test(new URL(link.href, location.href).pathname) ||
        link.closest('ytd-thumbnail,yt-thumbnail-view-model,.ytLockupViewModelContentImage')) return;
    clearTimeout(pillTimer);
    if (pillLink === link && !summarizePill.hidden) return;
    pillLink = link; summarizePill.hidden = false;
    summarizePill.setAttribute('aria-label', `Summarize ${link.textContent.trim().slice(0, 80)}`);
    const rect = link.getBoundingClientRect(), { width, height } = summarizePill.getBoundingClientRect();
    const top = Math.max(8, rect.top + Math.min(0, rect.height / 2 - 12));
    const spots = [{ x: rect.right + 8, y: top }, { x: rect.left - width - 8, y: top }, { x: rect.left, y: rect.bottom + 4 }]
      .map(({ x, y }) => ({ x: Math.max(8, Math.min(x, innerWidth - width - 12)), y: Math.max(8, Math.min(y, innerHeight - height - 8)) }));
    // Clamping can move a candidate over the title or the open card.
    const spot = spots.find(({ x, y }) => { const box = { left: x, top: y, right: x + width, bottom: y + height }; return !overlapsCard(box) && !overlapArea(box, rect); });
    if (!spot) return hidePill();
    summarizePill.style.left = `${spot.x}px`; summarizePill.style.top = `${spot.y}px`;
    pillAt = { top: rect.top, left: rect.left };
  }
  summarizePill.addEventListener('pointerenter', () => { pillHovered = true; clearTimeout(pillTimer); });
  summarizePill.addEventListener('pointerleave', () => { pillHovered = false; hidePillSoon(); });
  summarizePill.addEventListener('click', event => {
    event.stopPropagation();
    if (!event.isTrusted) return;
    const link = pillLink; hidePill(); pillHovered = false;
    if (!link?.isConnected) return;
    const target = openPreview(link, 'summary');
    summarizeVideo(target.videoId, target.durationSeconds, event.detail === 0);
  });
  // Keyboard: focusing a title shows its Summarize button; Tab moves onto it, and Tab again continues
  // from the title as if the button were right after it.
  document.addEventListener('focusin', event => { const link = event.target.closest?.('a[href]'); if (link && link.matches(':focus-visible')) showPill({ target: link }); }, true);
  document.addEventListener('focusout', event => { if (pillLink && event.target === pillLink && event.relatedTarget !== host) hidePillSoon(); }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey && pillLink && event.target === pillLink && !summarizePill.hidden) { event.preventDefault(); summarizePill.focus(); }
  }, true);
  summarizePill.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !pillLink?.isConnected) return;
    event.stopPropagation(); pillLink.focus();
    if (event.shiftKey) event.preventDefault();
  });
  summarizePill.addEventListener('focusout', event => { if (event.relatedTarget !== pillLink) hidePillSoon(); });
  // Ignore quick passes over titles.
  const HOVER_INTENT_MS = 220;
  let intentLink = null, intentTimer = 0;
  document.addEventListener('pointerover', event => {
    const link = event.target.closest?.('a[href]') || null;
    if (link === intentLink) return;
    clearTimeout(intentTimer); intentLink = link;
    if (!link) return;
    intentTimer = setTimeout(() => {
      if (intentLink !== link || !link.isConnected || !link.matches(':hover')) return;
      showPill({ target: link }); showThumbnail({ target: link });
    }, HOVER_INTENT_MS);
  }, true);
  document.addEventListener('pointerout', event => {
    if (intentLink && !intentLink.contains(event.relatedTarget)) { clearTimeout(intentTimer); intentLink = null; }
  }, true);
  document.addEventListener('pointerout', event => { if (pillLink && !pillLink.contains(event.relatedTarget)) hidePillSoon(); }, true);
  // Hide popups only when their title actually moved. Firefox also fires scroll events when a popup
  // appears and nudges layout without moving anything; those must not close the popup just shown.
  const moved = (link, at) => { if (!link?.isConnected || !at) return true; const r = link.getBoundingClientRect(); return Math.abs(r.top - at.top) > 2 || Math.abs(r.left - at.left) > 2; };
  let pillAt = null;
  document.addEventListener('scroll', () => { if (!pillHovered && pillLink && moved(pillLink, pillAt)) hidePill(); }, { capture: true, passive: true });
  document.addEventListener('yt-navigate-finish', hidePill);
  document.addEventListener('contextmenu', localPreview, true);
  // thumbnailAnchor: link whose preview is shown; hoverLink: link under the pointer or focus,
  // which may still be waiting for YouTube to lazy-load its thumbnail.
  let thumbnailAnchor = null, hoverLink = null, thumbnailAt = null;
  function closeThumbnail() { thumbnailTip.hidden = true; thumbnailAnchor = null; hoverLink = null; }
  const previewCardSelector = 'ytd-video-renderer,ytd-grid-video-renderer,ytd-rich-item-renderer,ytd-compact-video-renderer,ytd-playlist-video-renderer,ytd-playlist-panel-video-renderer,yt-lockup-view-model';
  function placeThumbnail(link, src) {
    const image = document.createElement('img');
    if (Curb.STORE_BUILD) image.referrerPolicy = 'no-referrer';
    image.src = src; image.alt = '';
    thumbnailTip.replaceChildren(image); thumbnailTip.hidden = false; thumbnailAnchor = link;
    const rect = link.getBoundingClientRect(), width = thumbnailTip.getBoundingClientRect().width;
    thumbnailAt = { top: rect.top, left: rect.left };
    const height = width * 9 / 16 + 14;
    const bottom = innerHeight - (shadow.querySelector('.bar')?.getBoundingClientRect().height || 60) - 12;
    thumbnailTip.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    thumbnailTip.style.top = `${Math.max(12, Math.min(rect.bottom + 8, bottom - height))}px`;
    if (overlapsCard(thumbnailTip.getBoundingClientRect())) closeThumbnail();
  }
  const loadedSrc = img => {
    const src = img?.complete && img.naturalWidth ? img.currentSrc || img.src : '';
    return !Curb.STORE_BUILD || /^https:\/\/i\.ytimg\.com\//.test(src) ? src : '';
  };
  function showThumbnail(event) {
    if (retired || data?.settings.thumbnailMode !== 'hover' || desiredMode() || (Curb.STORE_BUILD && !data.enabled)) return closeThumbnail();
    const link = event.target.closest?.('a[href]');
    const card = link?.closest(previewCardSelector);
    const id = card && Curb.videoKey(link.href);
    if (!id || link.closest('ytd-thumbnail,yt-thumbnail-view-model,.ytLockupViewModelContentImage')) return;
    if (thumbnailAnchor === link && !thumbnailTip.hidden) return;
    const source = card.querySelector('ytd-thumbnail img,yt-thumbnail-view-model img,.ytLockupViewModelContentImage img,.ytThumbnailViewModelHost img');
    if (loadedSrc(source)) return placeThumbnail(link, loadedSrc(source));
    closeThumbnail(); hoverLink = link;
    // YouTube may never load a collapsed thumbnail. Use the first image that arrives.
    const show = src => { if (hoverLink === link && thumbnailAnchor !== link && src && !retired && data?.settings.thumbnailMode === 'hover' && !desiredMode()) placeThumbnail(link, src); };
    source?.addEventListener('load', () => show(loadedSrc(source)), { once: true });
    const standard = new Image();
    if (Curb.STORE_BUILD) standard.referrerPolicy = 'no-referrer';
    standard.addEventListener('load', () => show(standard.naturalWidth > 120 ? standard.src : ''), { once: true });
    standard.src = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
  }
  document.addEventListener('focusin', showThumbnail, true);
  document.addEventListener('pointerout', event => { const anchor = thumbnailAnchor || hoverLink; if (anchor && !anchor.contains(event.relatedTarget)) closeThumbnail(); }, true);
  document.addEventListener('focusout', closeThumbnail, true);
  const isNativeSearch = node => (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && (node.name === 'search_query' || node === nativeSearchInput());
  const syncNativeSearch = event => {
    if ((Curb.STORE_BUILD && !data?.enabled) || !isNativeSearch(event.target)) return;
    searchEngaged = event.type !== 'focusout';
    if (!fillingSearch && event.isTrusted && (event.type === 'input' || (event.type === 'focusout' && !searchDraft))) clearSearchRequest();
  };
  for (const type of ['focusin', 'focusout', 'input']) document.addEventListener(type, syncNativeSearch, true);
  document.addEventListener('scroll', () => { if (thumbnailAnchor && moved(thumbnailAnchor, thumbnailAt)) closeThumbnail(); else if (!thumbnailAnchor && hoverLink) closeThumbnail(); }, true);
  document.addEventListener('yt-navigate-finish', closeThumbnail);
  window.addEventListener('resize', closeThumbnail);
  window.addEventListener('popstate', closeThumbnail);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeThumbnail();
    if (Curb.STORE_BUILD && !data?.enabled) return;
    if (isNativeSearch(event.target) && event.isTrusted && !['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) clearSearchRequest();
    if (isNativeSearch(event.target) && event.key === 'Escape') searchEngaged = false;
  }, true);
  document.addEventListener('play', event => {
    navigation(); if (desiredMode() && event.target instanceof HTMLMediaElement) event.target.pause();
  }, true);
  document.addEventListener('fullscreenchange', () => {
    closeCard(); closeThumbnail();
    hidePill();
    render(true); if (desiredMode()) pause();
  });
  window.addEventListener('resize', schedulePosition);
  document.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
  document.addEventListener('yt-navigate-finish', () => { navigation(); render(); tick(); });
  window.addEventListener('popstate', () => { navigation(); tick(); });
  document.addEventListener('visibilitychange', tick);
  window.addEventListener('focus', tick); window.addEventListener('blur', tick);
  window.addEventListener('pagehide', () => {
    if (!Curb.STORE_BUILD || data?.enabled) request('TICK', { active: false, aligned: false }).catch(() => {});
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !tip.hidden) closeCard(true); }, true);
  shadow.addEventListener('keydown', event => {
    // Player shortcuts must not consume text typed in our shadow-DOM inputs.
    if (event.target instanceof HTMLInputElement) event.stopPropagation();
    if (mode && event.key === 'Tab') {
      const focusable = [...shadow.querySelectorAll('.card button:not(:disabled), .card input:not(:disabled), .bar button:not(:disabled)')].filter(node => node.getClientRects().length);
      // Firefox also tabs to overflowing scroll containers. Use the actual
      // visible controls consistently, including when a prompt scrolls.
      const index = focusable.indexOf(shadow.activeElement);
      const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length;
      focusable[next]?.focus(); event.preventDefault();
    }
  });
  ui.addEventListener('click', event => event.stopPropagation());
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (retired) return false;
    if (message.type === 'SUMMARY_PROGRESS') { showProgress(message); return false; }
    if (message.type !== 'STATE') return false;
    apply(message.data, message.intentSaved === true); respond({ ok: true }); return false;
  });
  // Observe structural changes only. Debouncing avoids repeated work during YouTube rendering.
  const observer = new MutationObserver(() => {
    if (Curb.STORE_BUILD && !data?.enabled) return;
    // YouTube can create its app element after the gate renders; lock it immediately.
    if (mode) lockApps(true);
    if (observerTimer) return;
    observerTimer = setTimeout(() => { observerTimer = null; mount(); navigation(); markShortsControls(); syncThumbnailTabStops(); if (desiredMode()) pause(); enforceAutoplay(); resumeSearchFocus(); }, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  render(); tick(); heartbeat = setInterval(tick, Curb.LIMITS.heartbeatMs);
})();
