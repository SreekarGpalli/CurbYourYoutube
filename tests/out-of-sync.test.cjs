const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// An older background script (the extension was not reloaded after an update) answers
// newer requests with "Unknown request.". The page must release YouTube and say what to do.
const source = fs.readFileSync('extension/content.js', 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp('^  (?:async )?function ' + name + '\\(', 'm'));
  assert(start >= 0, name);
  const next = source.slice(start + 1).search(/\n  (?:async )?function /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}
const constant = name => source.match(new RegExp(`const ${name} = .*;`))[0];

test('an out-of-date background releases the page with an extension-reload instruction', async () => {
  const notices = [], unlocked = [];
  const context = vm.createContext({
    api: { runtime: { sendMessage: async () => ({ ok: false, error: 'Unknown request.' }) } },
    retired: false, heartbeat: 0, notices, unlocked, previewTimeout: 0, streamTarget: {},
    cardSource: {}, cardOrigin: 'summary', cardLink: {},
    clearInterval() {}, clearTimeout() {}, observer: { disconnect() {} }, playerSize: { disconnect() {} }, barSize: { disconnect() {} },
    lockApps(locked) { unlocked.push(!locked); },
    document: { documentElement: { removeAttribute(name) { unlocked.push(name); } } },
    host: { removeAttribute() {} }, tip: {}, thumbnailTip: {}, location: { reload() {} },
    el: (tag, attrs, text) => ({ text, append() {} }), button: () => ({}),
    ui: { replaceChildren(node) { notices.push(node.text); } }
  });
  vm.runInContext(constant('OUT_OF_SYNC'), context);
  for (const name of ['request', 'retire', 'closeCard']) vm.runInContext(functionSource(name), context);
  await assert.rejects(vm.runInContext("request('SEARCH_GET')", context), /Reload the extension/);
  await assert.rejects(vm.runInContext("request('TICK')", context), /Reload the extension/);
  assert.equal(vm.runInContext('retired', context), true);
  assert.equal(vm.runInContext('tip.hidden && streamTarget === null', context), true);
  assert.equal(notices.length, 1, 'one notice, not one per heartbeat');
  assert.match(notices[0], /only partly updated.*Reload the extension.*then reload this tab/);
  assert(unlocked.includes('data-curb-locked'), 'YouTube is no longer covered by a prompt');
});
