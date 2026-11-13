const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('extension/content.js', 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
function setup() {
  const fills = [];
  const context = vm.createContext({
    Curb: require('../extension/core.js'),
    fills, PAGE_LOAD: 'new-page', FOCUS_SEARCH_KEY: 'curb-focus-search',
    sessionStorage: { removeItem() {} }, tip: {}, thumbnailTip: {},
    fillNativeSearch(text) { fills.push(text); return true; },
    applyPrefs() {}, render() {},
  });
  vm.runInContext(
    'var data = {settings:{localPreviews:true,thumbnailMode:"hover"},session:{id:"session",intent:"Original",mode:"focus",stopped:false}};' +
    'var searchGeneration=0,searchDraft=null,searchChecked=false,searchLoading=false,mode="",pendingSearch=false;' +
    'var editing=true,intentDraft="An unfinished draft",approved="",approvedSession="",approvedAligned=true;' +
    'var respond; function request(type){if(type==="SEARCH_CLEAR")return Promise.resolve({});return new Promise(resolve=>respond=resolve);}' +
    'function desiredMode(){return !data.session?"intent":data.session.stopped?"stopped":"";}' +
    'var cardOrigin=null,intentChanges=0; function closeCard(){} function closeThumbnail(){} function intentChanged(){intentChanges++;}', context);
  for (const name of ['apply', 'summaryIntent', 'requestSearchAfterLoad', 'clearSearchRequest', 'resumeSearchFocus'])
    vm.runInContext(functionSource(name), context);
  return context;
}
test('a delayed search response cannot restore erased text after reset or stop', async () => {
  for (const session of [null, { id: 'session', intent: 'Original', mode: 'focus', stopped: true }]) {
    const c = setup();
    const work = vm.runInContext('resumeSearchFocus()', c);
    c.apply({ settings: { localPreviews: true, thumbnailMode: 'hover' }, session });
    c.respond({ session: { id: 'session', intent: 'Original' },
      searchRequest: { text: 'erased intent', sessionId: 'session', at: Date.now() } });
    await work;
    assert.deepEqual(c.fills, []);
    assert.equal(c.editing, false);
    assert.equal(c.intentDraft, null);
  }
});
test('cross-tab intent and mode changes cancel handoffs and preserve the editor draft', () => {
  for (const patch of [{ intent: 'Changed' }, { mode: 'browse' }, { id: 'replacement' }]) {
    const c = setup();
    vm.runInContext('searchDraft={text:"Old intent",sessionId:"session",intent:"Original"}', c);
    c.apply({ settings: { localPreviews: true, thumbnailMode: 'hover' },
      session: { id: 'session', intent: 'Original', mode: 'focus', stopped: false, ...patch } });
    assert.equal(c.searchDraft, null);
    assert.equal(c.editing, true);
    assert.equal(c.intentDraft, 'An unfinished draft');
  }
});
test('a handoff save finishing after reset cannot revive a local draft', async () => {
  const c = setup();
  const work = vm.runInContext('requestSearchAfterLoad("Old query","https://www.youtube.com/")', c);
  c.apply({ settings: { localPreviews: true, thumbnailMode: 'hover' }, session: null });
  c.respond({});
  await assert.rejects(work, /Your session changed/);
  assert.equal(c.searchDraft, null);
});
