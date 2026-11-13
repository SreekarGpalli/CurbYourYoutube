(() => {
  'use strict';
  const api = globalThis.browser || chrome;
  const root = document.getElementById('app');
  const popup = document.body.dataset.page === 'popup';
  let data, toastTimer, refreshing = false;
  let refreshSummaryKeys, refreshSavedSearches, refreshIntentEditor;
  let requestQueue = Promise.resolve();
  const pendingSettings = new Map();
  function el(tag, className = '', text = '') { const n = document.createElement(tag); n.className = className; n.textContent = text; return n; }
  function button(text, fn, cls = 'primary') { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function send(type, extra = {}) {
    const request = requestQueue.then(async () => {
      const result = await api.runtime.sendMessage({ type, ...extra });
      if (!result?.ok) throw new Error(result?.error || 'Unable to connect to the extension.');
      data = result.data; return data;
    });
    requestQueue = request.catch(() => {});
    return request;
  }
  function notify(text, error = false) {
    document.querySelector('.toast')?.remove();
    const toast = el('div', 'toast', text); toast.setAttribute('role', error ? 'alert' : 'status'); root.append(toast);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.remove(), 5000);
  }
  async function save(control) {
    const key = control.dataset.setting;
    const value = control.type === 'checkbox' ? control.checked
      : typeof Curb.DEFAULTS[key] === 'number' ? Number(control.value) : control.value;
    const pending = { value };
    pendingSettings.set(key, pending);
    control.setAttribute('aria-busy', 'true');
    syncDependents();
    try { await send('SETTINGS', { settings: { [key]: value } }); }
    catch (error) { notify(error.message, true); }
    finally {
      if (pendingSettings.get(key) === pending) pendingSettings.delete(key);
      syncSettings();
    }
  }
  function wordmark(parent) { parent.append(el('div', 'wordmark', 'Curb Your YouTube')); }
  function syncDependents() {
    const hideHome = pendingSettings.get('hideHome')?.value ?? data.settings.hideHome;
    root.querySelectorAll('[data-setting="homeMinutes"]').forEach(select => { select.disabled = !hideHome; });
  }
  function syncSettings() {
    if (Curb.STORE_BUILD && !popup && Boolean(document.getElementById('edit-intent')) !== data.enabled) { render(); return; }
    root.querySelectorAll('[data-setting]').forEach(control => {
      const pending = pendingSettings.get(control.dataset.setting);
      const value = pending?.value ?? data.settings[control.dataset.setting];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = value;
      if (pending) control.setAttribute('aria-busy', 'true');
      else control.removeAttribute('aria-busy');
    });
    syncDependents();
  }
  function sessionCard() {
    const card = el('section', 'card session-card'); card.id = 'session-card';
    if (data.session?.stopped || data.session?.breakDue)
      card.append(el('div', 'eyebrow', data.session.stopped ? 'Session finished' : 'Break due'));
    card.append(el('div', 'session-intent', data.session?.intent || 'No session in progress'));
    const metrics = el('div', 'metrics');
    for (const [value, label] of [[data.session?.intentMs, 'Intent time'], [data.session?.totalMs, 'Session'], [data.total.ms, 'YouTube today']]) {
      const metric = el('div', 'metric'); metric.append(el('b', '', Curb.format(value)), el('span', '', label)); metrics.append(metric);
    }
    card.append(metrics); return card;
  }
  function intervalRow() {
    const row = el('label', 'row');
    const text = el('span', 'row-text'); text.append(el('strong', '', 'Break interval'));
    const select = el('select'); select.setAttribute('aria-label', 'Break interval'); select.dataset.setting = 'breakMinutes';
    for (const value of [30, 60]) { const option = el('option', '', `Every ${value} minutes`); option.value = value; select.append(option); }
    select.value = data.settings.breakMinutes;
    select.addEventListener('change', () => save(select));
    row.append(text, select); return row;
  }
  function thumbnailRow() {
    const row = el('label', 'row');
    const text = el('span', 'row-text');
    text.append(el('strong', '', 'Video thumbnails'));
    const select = el('select'); select.setAttribute('aria-label', 'Video thumbnails'); select.dataset.setting = 'thumbnailMode';
    const choices = [['show', 'Show normally'], ['hover', 'Reveal on hover'], ['hidden', 'Always hidden']];
    if (Curb.STORE_BUILD) text.append(el('span', 'muted', 'Hover previews can load an image from YouTube.'));
    for (const [value, label] of choices) {
      const option = el('option', '', label); option.value = value; select.append(option);
    }
    select.value = data.settings.thumbnailMode;
    select.addEventListener('change', () => save(select));
    row.append(text, select); return row;
  }
  function homeDurationRow() {
    const row = el('label', 'row');
    const text = el('span', 'row-text');
    text.append(el('strong', '', 'Homepage browse time'));
    const select = el('select'); select.dataset.setting = 'homeMinutes'; select.setAttribute('aria-label', 'Homepage browse time');
    for (const value of [2, 5, 10]) { const option = el('option', '', `${value} minutes`); option.value = value; select.append(option); }
    select.value = data.settings.homeMinutes;
    select.addEventListener('change', () => save(select));
    row.append(text, select); return row;
  }
  // Firefox also asks for consent to the optional data types summaries send (declared in the manifest).
  const optionalData = api.runtime.getManifest().browser_specific_settings?.gecko?.data_collection_permissions?.optional || [];
  const GEMINI_ORIGINS = { origins: ['https://generativelanguage.googleapis.com/*'], ...(optionalData.length ? { data_collection: optionalData } : {}) };
  async function geminiAllowed() {
    if (!await api.permissions.contains({ origins: GEMINI_ORIGINS.origins })) return false;
    if (!optionalData.length) return true;
    const granted = (await api.permissions.getAll()).data_collection || [];
    return optionalData.every(type => granted.includes(type));
  }
  function summariesSection() {
    const section = el('section', 'section'); section.id = 'summaries';
    section.append(el('h2', '', 'Video summaries'), el('p', 'summary-intro',
      'Add a Gemini API key, then hover over a public video title and select Summarize. Long videos can take longer. Your project’s usage limits apply.'));
    if (Curb.STORE_BUILD && !data.enabled) {
      refreshSummaryKeys = null;
      section.append(el('p', 'muted', 'Enable Curb in Session to set up Gemini.'));
      return section;
    }
    const panel = el('div', 'key-panel');
    const form = el('form', 'key-form');
    const head = el('div', 'key-heading');
    const label = el('label', '', 'Gemini API key'); label.htmlFor = 'gemini-key';
    const getKey = el('a', '', 'Get an API key'); getKey.href = 'https://aistudio.google.com/apikey'; getKey.target = '_blank'; getKey.rel = 'noreferrer';
    head.append(label, getKey);
    const field = el('input', 'key-input'); field.type = 'password'; field.id = 'gemini-key'; field.autocomplete = 'off'; field.spellcheck = false; field.required = true;
    const add = el('button', 'primary', 'Add key'); add.type = 'submit';
    const addRow = el('div', 'key-add'); addRow.append(field, add);
    const keyError = el('p', 'error key-error'); keyError.setAttribute('role', 'alert');
    form.append(head, addRow);
    let consent;
    if (Curb.STORE_BUILD) {
      form.append(el('p', 'muted', 'Summarize sends Google the video link and your API key. You can also opt in to sharing your intent. Billing and Gemini’s data terms apply.'));
      const row = el('label', 'key-consent');
      consent = el('input'); consent.type = 'checkbox'; consent.required = true;
      row.append(consent, el('span', '', 'I’m 18 or older, using Gemini for work in a supported region, and using my own billing-enabled project with request logging and data sharing turned off.'));
      const terms = el('a', 'muted', 'Gemini API terms'); terms.href = 'https://aistudio.google.com/docs/terms'; terms.target = '_blank'; terms.rel = 'noreferrer';
      form.append(row, terms);
    }

    const list = el('ul', 'key-list'); list.hidden = true; list.setAttribute('aria-label', 'Saved Gemini API keys');
    const status = el('div', 'visually-hidden'); status.setAttribute('role', 'status');
    const permission = el('div', 'key-permission'); permission.hidden = true;
    const allow = button('Allow Gemini access', async () => {
      allow.disabled = true;
      try {
        if (!await api.permissions.request(GEMINI_ORIGINS)) throw new Error('Allow Google access to use summaries.');
        permission.hidden = true;
        field.focus();
      } catch (error) { notify(error.message, true); }
      finally { allow.disabled = false; }
    }, 'secondary');
    permission.append(allow);
    let revision, keyCount = 0;
    const syncPermission = async () => {
      try { const granted = await geminiAllowed(); permission.hidden = granted || !keyCount; }
      catch (error) { if (section.isConnected) notify(error.message, true); }
    };
    const renderKeys = result => {
      if (!section.isConnected || revision === result.summaryKeyRevision) return;
      const { summaryKeys, summaryKeyRevision } = result;
      revision = summaryKeyRevision; keyCount = summaryKeys.length;
      const focusedIndex = [...list.children].findIndex(row => row.contains(document.activeElement));
      list.replaceChildren(...summaryKeys.map((masked, index) => {
        const row = el('li', 'key-row');
        const name = index ? `Backup key ${index}` : 'Primary key';
        const remove = button('Remove', async () => {
          remove.disabled = true;
          try {
            await send('SUMMARY_KEY_REMOVE', { index, revision: summaryKeyRevision }).then(renderKeys);
            if (document.activeElement === document.body) (list.children[index]?.querySelector('button') || field).focus();
            status.textContent = `Key removed. ${keyCount} saved.`;
          } catch (error) { notify(error.message, true); refreshKeys(); }
          finally { remove.disabled = false; }
        }, 'secondary');
        remove.setAttribute('aria-label', `Remove ${name.toLowerCase()}`);
        row.append(el('span', '', name), el('code', '', masked), remove);
        return row;
      }));
      list.hidden = !keyCount;
      if (focusedIndex >= 0) (list.children[focusedIndex]?.querySelector('button') || field).focus();
    };
    const refreshKeys = async () => {
      try { renderKeys(await send('SUMMARY_KEYS')); await syncPermission(); }
      catch (error) { if (section.isConnected) notify(error.message, true); }
    };
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (add.disabled) return;
      const key = field.value.trim();
      if (!key) { field.value = ''; field.reportValidity(); return; }
      add.disabled = true;
      keyError.remove();
      try {
        if (!await api.permissions.request(GEMINI_ORIGINS)) throw new Error('Allow Google access to use summaries.');
        renderKeys(await send('SUMMARY_KEY_ADD', { key, ...(consent ? { consent: consent.checked } : {}) }));
        if (field.value.trim() === key) field.value = '';
        if (consent) consent.checked = false;
        permission.hidden = true;
        status.textContent = `Key added. ${keyCount} saved.`;
      } catch (error) { keyError.textContent = error.message; form.append(keyError); }
      finally { add.disabled = false; }
    });
    panel.append(form, list, status, permission, toggle('summaryClip', 'Limit summaries to the first 5 minutes'));
    if (Curb.STORE_BUILD) panel.append(toggle('summaryIntent', 'Include my intent in Gemini requests'));
    const privacy = el('p', 'muted summary-privacy', Curb.STORE_BUILD
      ? 'Curb encrypts your saved key on this device. '
      : 'Google receives the video link and your session intent, if set, only when you select Summarize. Curb saves your key on this device. ');
    const details = el('a', '', 'Privacy details'); details.href = 'privacy.html#video-summaries'; privacy.append(details);
    section.append(panel, privacy);
    refreshSummaryKeys = refreshKeys;
    refreshKeys();
    return section;
  }
  function toggle(key, name) {
    const row = el('label', 'row');
    const text = el('span', 'row-text'); text.append(el('strong', '', name));
    const input = el('input', 'switch'); input.type = 'checkbox'; input.checked = data.settings[key]; input.setAttribute('aria-label', name); input.dataset.setting = key;
    input.addEventListener('change', () => save(input));
    row.append(text, input); return row;
  }
  function buildPopup() {
    const box = el('main', 'popup'); wordmark(box); box.append(sessionCard());
    if (data.session && !data.session.stopped) box.append(button('Finish this session', async () => { try { await send('STOP', { sessionId: data.session.id }); render(); } catch (e) { notify(e.message, true); } }, 'secondary finish'));
    const controls = el('div', 'popup-controls');
    controls.append(thumbnailRow(), intervalRow());
    const quick = new Set(['hideHome', 'hideShorts', 'hideRelated', 'hideComments', 'disableAutoplay']);
    for (const [key, name] of Curb.CONTROLS) if (quick.has(key)) controls.append(toggle(key, name));
    box.append(controls);
    box.append(button('Open YouTube', () => api.tabs.create({ url: 'https://www.youtube.com/' })));
    box.append(button('Settings', () => api.runtime.openOptionsPage(), 'secondary'));
    root.append(box);
  }
  function storeField(form, id, name, max, value = '') {
    const label = el('label', '', name); label.htmlFor = id;
    const field = el('input'); field.id = id; field.required = true; field.maxLength = max;
    field.value = value; field.autocomplete = 'off'; field.spellcheck = false;
    form.append(label, field);
    return field;
  }
  function enableNotice(section) {
    section.append(el('p', 'muted', 'Curb reads YouTube pages to hide distractions and track watch time. Curb stores your data in this Chrome profile.'),
      button('Enable Curb', async () => {
        try { await send('ENABLE'); render(); document.querySelector(location.hash === '#saved-searches' ? '#search-name' : '#custom-intent')?.focus(); }
        catch (error) { notify(error.message, true); }
      }));
  }
  function intentEditor() {
    const section = el('section', 'section'); section.id = 'edit-intent';
    section.append(el('h2', '', 'Custom intent'));
    const form = el('form', 'entry-form');
    let session = data.session;
    const field = storeField(form, 'custom-intent', 'Your intent', Curb.LIMITS.intent, session?.casual ? '' : session?.intent);
    field.minLength = 3;
    let editing = false;
    field.addEventListener('input', () => { editing = true; });
    refreshIntentEditor = () => {
      if (editing) return;
      session = data.session;
      field.value = session?.casual ? '' : session?.intent || '';
    };
    const save = el('button', 'primary', 'Save intent'); save.type = 'submit';
    const suggest = el('button', 'secondary', 'Save and get YouTube suggestions'); suggest.type = 'submit';
    const actions = el('div', 'entry-actions'); actions.append(save, suggest);
    form.append(actions, el('p', 'muted', 'YouTube can receive your intent for suggestions before you submit a search.'));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const intent = field.value.trim();
      save.disabled = suggest.disabled = true;
      try {
        if (session && !session.stopped) await send('EDIT_INTENT', { intent, sessionId: session.id, expectedIntent: session.intent });
        else await send('START', { intent, expectedId: session?.id ?? null });
        editing = false;
        refreshIntentEditor();
        if (event.submitter === suggest) await send('SEARCH_INTENT', { sessionId: session.id, intent: session.intent });
        else notify('Intent saved. Return to YouTube to continue.');
      } catch (error) {
        if (error.message.startsWith('Your session changed')) {
          try { session = (await send('GET')).session; } catch { /* Retry when the worker is available. */ }
        }
        notify(error.message, true);
      }
      finally { save.disabled = suggest.disabled = false; }
    });
    section.append(form); return section;
  }
  function searchEditor() {
    const section = el('section', 'section'); section.id = 'saved-searches';
    section.append(el('h2', '', 'Saved searches'));
    section.append(el('p', 'muted', 'Opening a saved search sends its terms to YouTube.'));
    const list = el('ul', 'search-list');
    const form = el('form', 'entry-form');
    const name = storeField(form, 'search-name', 'Name', 48);
    name.minLength = 3;
    const query = storeField(form, 'search-terms', 'Search terms', Curb.LIMITS.intent);
    const save = el('button', 'primary', 'Save search'); save.type = 'submit';
    let editId;
    const cancel = button('Cancel edit', () => { editId = undefined; form.reset(); cancel.hidden = true; name.focus(); }, 'secondary');
    cancel.hidden = true;
    const actions = el('div', 'entry-actions'); actions.append(save, cancel); form.append(actions);
    let renderedSearches;
    const showSearches = () => {
      const currentSearches = JSON.stringify(data.savedSearches);
      if (renderedSearches === currentSearches) return;
      renderedSearches = currentSearches;
      list.replaceChildren(...data.savedSearches.map(item => {
        const row = el('li', 'row');
        const text = el('span', 'row-text');
        text.append(el('strong', '', item.label), el('span', 'muted', item.query));
        const edit = button('Edit', () => { editId = item.id; name.value = item.label; query.value = item.query; cancel.hidden = false; name.focus(); }, 'secondary');
        edit.setAttribute('aria-label', `Edit ${item.label}`);
        const remove = button('Remove', async () => {
          try {
            await send('DELETE_SEARCH', { id: item.id });
            if (editId === item.id) { editId = undefined; form.reset(); cancel.hidden = true; }
            showSearches(); name.focus();
          } catch (error) { notify(error.message, true); }
        }, 'secondary');
        remove.setAttribute('aria-label', `Remove ${item.label}`);
        row.append(text, edit, remove); return row;
      }));
      list.hidden = !data.savedSearches.length;
    };
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try {
        await send('SAVE_SEARCH', { search: { id: editId, label: name.value, query: query.value } });
        editId = undefined; form.reset(); cancel.hidden = true; showSearches(); name.focus();
      } catch (error) { notify(error.message, true); }
      finally { save.disabled = false; }
    });
    refreshSavedSearches = showSearches;
    showSearches(); section.append(list, form); return section;
  }
  function buildOptions() {
    const layout = el('div', 'layout'); const rail = el('aside', 'rail'); wordmark(rail);
    const nav = el('nav', 'nav'); nav.setAttribute('aria-label', 'Settings sections');
    const sections = [['intention', 'Session'], ['distractions', 'Distractions']];
    if (Curb.STORE_BUILD && data.enabled) sections.push(['edit-intent', 'Custom intent'], ['saved-searches', 'Saved searches']);
    sections.push(['summaries', 'Video summaries']);
    sections.push(['privacy', 'Privacy']);
    for (const [id, label] of sections) { const a = el('a', '', label); a.href = `#${id}`; nav.append(a); }
    rail.append(nav);
    const main = el('main', 'main'); main.append(el('h1', '', 'Settings'));
    const intention = el('section', 'section'); intention.id = 'intention'; intention.append(sessionCard());
    if (Curb.STORE_BUILD && !data.enabled) enableNotice(intention);
    const rhythm = el('div', 'card'); rhythm.append(el('h2', '', 'Session controls'), intervalRow());
    rhythm.append(toggle('fullscreenPill', 'Intent pill on videos'));
    intention.append(rhythm); main.append(intention);
    const distractions = el('section', 'section'); distractions.id = 'distractions'; distractions.append(el('h2', '', 'Distractions'));
    const controls = el('div', 'card'); controls.append(thumbnailRow(), toggle('localPreviews', 'Right-click video previews')); let group = '';
    for (const [key, name, , category] of Curb.CONTROLS) {
      if (group !== category) { group = category; controls.append(el('h3', '', category)); }
      controls.append(toggle(key, name));
      if (key === 'hideHome') controls.append(homeDurationRow());
    }
    distractions.append(controls); main.append(distractions);
    if (Curb.STORE_BUILD && data.enabled) main.append(intentEditor(), searchEditor());
    main.append(summariesSection());
    const privacy = el('section', 'section'); privacy.id = 'privacy';
    const privacyCard = el('div', 'card'); privacyCard.append(el('h2', '', 'Privacy & data'));
    const confirm = el('div'); confirm.hidden = true;
    const resetDescription = 'Reset settings and clear saved searches, Gemini keys, summaries, and today’s watch time? This ends the current session.';
    confirm.append(el('p', 'muted', resetDescription));
    const actions = el('div', 'actions');
    const reset = button('Clear local data…', () => { confirm.hidden = false; confirm.querySelector('button').focus(); }, 'danger');
    actions.append(button('Clear and reset', async () => { try { await send('RESET'); render(); notify('Local data cleared'); } catch (e) { notify(e.message, true); } }, 'danger'), button('Cancel', () => { confirm.hidden = true; reset.focus(); }, 'secondary')); confirm.append(actions);
    privacyCard.append(reset, confirm);
    const policy = el('a', 'muted', 'Privacy policy'); policy.href = 'privacy.html'; policy.target = '_blank';
    const policyRow = el('p'); policyRow.append(policy); privacyCard.append(policyRow); privacy.append(privacyCard); main.append(privacy);
    layout.append(rail, main); root.append(layout); syncDependents(); updateNavigation();
  }
  function updateNavigation() {
    const selected = location.hash || '#intention';
    root.querySelectorAll('.nav a').forEach(link => {
      if (link.getAttribute('href') === selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', updateNavigation);
  function render() {
    refreshSavedSearches = null; refreshIntentEditor = null;
    root.replaceChildren(); if (popup) buildPopup(); else buildOptions(); syncSettings();
  }
  async function load() {
    try {
      await send('GET'); render();
      if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
    catch (error) {
      const message = el('p', 'error', error.message); message.setAttribute('role', 'alert');
      root.replaceChildren(message, button('Retry', load, 'secondary'));
      if (Curb.STORE_BUILD && !popup && error.message.includes('Clear local data')) {
        root.append(button('Clear local data', async () => {
          if (!window.confirm('Clear saved searches, settings, and watch time?')) return;
          try { await send('RESET'); render(); notify('Local data cleared'); }
          catch (error) { notify(error.message, true); }
        }, 'danger'));
      }
    }
  }
  load();
  // Saved preferences reach every open Settings/popup page at once, even a background tab;
  // pending local edits keep showing their own value until their save settles.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !data) return;
    if (changes.settings) {
      data.settings = Curb.settings(changes.settings.newValue);
      syncSettings();
    }
    if (Curb.STORE_BUILD && changes.sealedData) {
      send('GET').then(() => { syncSettings(); refreshSavedSearches?.(); refreshIntentEditor?.(); }).catch(() => {});
      refreshSummaryKeys?.();
    }
    if (changes.geminiKeys) refreshSummaryKeys?.();
  });
  api.permissions.onAdded.addListener(() => refreshSummaryKeys?.());
  api.permissions.onRemoved.addListener(() => refreshSummaryKeys?.());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  setInterval(() => refresh(), Curb.LIMITS.heartbeatMs);
  async function refresh() {
    if (document.visibilityState !== 'visible' || refreshing) return;
    refreshing = true;
    try {
      const couldFinish = !!data?.session && !data.session.stopped;
      await send('GET');
      if (!document.getElementById('session-card') || (popup && couldFinish !== (!!data.session && !data.session.stopped))) { render(); return; }
      document.getElementById('session-card')?.replaceWith(sessionCard());
      syncSettings();
      refreshIntentEditor?.();
    } catch { /* A reload will reconnect after extension updates. */ }
    finally { refreshing = false; }
  }
})();
