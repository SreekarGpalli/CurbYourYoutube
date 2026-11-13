import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { releaseTargets, storeSource } from './release-targets.mjs';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
async function files(base, prefix = '') {
  const result = [];
  for (const entry of await readdir(base + '/' + prefix, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(base, name + '/'));
    else result.push(name);
  }
  return result.sort();
}
const sourceFiles = await files('extension');
const expectedFiles = [...sourceFiles, 'manifest.json', ...[16, 32, 48, 128].map(size => `icons/${size}.png`)].sort();
for (const file of sourceFiles) {
  if (file.endsWith('.js')) {
    execFileSync(process.execPath, ['--check', `extension/${file}`]);
    const source = await readFile(`extension/${file}`, 'utf8');
    assert(!/XMLHttpRequest|WebSocket|sendBeacon|storage\.sync|\beval\s*\(/.test(source), `${file}: unexpected network or dynamic-code API`);
    // Video summaries are the only network feature: one call site, in the background script, to Gemini only.
    const fetches = source.match(/\bfetch\s*\(/g) || [];
    if (file === 'background.js') {
      assert.equal(fetches.length, 1, 'background.js: exactly one fetch call site');
      const hosts = [...source.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map(m => m[0]).filter(u => !/youtube\.com$/.test(u));
      assert(hosts.every(u => u === 'https://generativelanguage.googleapis.com'), 'background.js: only the Gemini API host');
    } else assert.equal(fetches.length, 0, `${file}: network requests are only allowed in background.js`);
  }
}
for (const browser of releaseTargets) {
  const base = `dist/${browser}/`;
  const store = browser === 'chrome-store';
  const expected = store ? [...expectedFiles, 'local-storage.js'].sort() : expectedFiles;
  assert.deepEqual(await files(base), expected, `${browser}: unexpected or missing build assets; run npm run build`);
  const m = JSON.parse(await readFile(base + 'manifest.json', 'utf8'));
  assert.equal(m.version, version, `${browser}: stale release version`);
  assert.deepEqual(m.permissions, ['storage']);
  assert(!m.host_permissions && !m.web_accessible_resources && !m.externally_connectable);
  for (const file of [...m.content_scripts.flatMap(s => [...s.js, ...s.css]), m.action.default_popup, m.options_ui.page, ...Object.values(m.icons)]) assert((await stat(base + file)).size > 0);
  if (store) {
    assert.equal(m.name, 'Curb Video Focus');
    assert.equal(m.incognito, 'not_allowed');
    assert.deepEqual(m.optional_host_permissions, ['https://generativelanguage.googleapis.com/*']);
    assert.equal(m.optional_permissions, undefined);
    assert.match(m.content_security_policy.extension_pages, /connect-src https:\/\/generativelanguage\.googleapis\.com;/);
    for (const file of expected.filter(name => name.endsWith('.js'))) {
      execFileSync(process.execPath, ['--check', base + file]);
      const source = await readFile(base + file, 'utf8');
      assert(!/XMLHttpRequest|WebSocket|sendBeacon|storage\.sync|\beval\s*\(|\bpostMessage\s*\(/i.test(source), `${file}: unexpected network or dynamic-code API in the store build`);
      assert.equal((source.match(/\bfetch\s*\(/g) || []).length, file === 'background.js' ? 1 : 0, `${file}: unexpected fetch call in the store build`);
      for (const match of source.matchAll(/https:\/\/([\w.-]+)/g))
        assert(['www.youtube.com', 'music.youtube.com', 'i.ytimg.com', 'aistudio.google.com', 'generativelanguage.googleapis.com'].includes(match[1]), `${file}: unexpected external URL`);
    }
    for (const file of sourceFiles.filter(file => file !== 'privacy.html'))
      assert.equal(await readFile(base + file, 'utf8'), storeSource(await readFile('extension/' + file, 'utf8')), `${file}: stale store build`);
    assert.deepEqual(await readFile(base + 'local-storage.js'), await readFile('store/local-storage.js'));
    const hostedPolicy = await readFile('dist/chrome-store-site/privacy.html', 'utf8');
    assert.equal(hostedPolicy, await readFile('store/privacy.html', 'utf8'));
    assert.equal((await readFile(base + 'privacy.html', 'utf8')).replace('    <a href="options.html">← Back to settings</a>\n', ''), hostedPolicy);
    assert.deepEqual(await readFile(base + 'pages.css'), await readFile('dist/chrome-store-site/pages.css'));
    const icon = await readFile(base + 'icons/128.png');
    assert.equal(icon.readUInt32BE(16), 128);
    assert.equal(icon.readUInt32BE(20), 128);
    assert.equal(icon.toString('ascii', 37, 41), 'IDAT');
    const pixels = inflateSync(icon.subarray(41, 41 + icon.readUInt32BE(33)));
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      if (x < 16 || x >= 112 || y < 16 || y >= 112) assert.equal(pixels[y * 513 + x * 4 + 4], 0, 'store icon needs 16px transparent padding');
    }
  } else {
    assert.deepEqual(m.optional_host_permissions, ['https://generativelanguage.googleapis.com/*'], `${browser}: only the Gemini host, and only as an optional permission`);
    assert(/connect-src https:\/\/generativelanguage\.googleapis\.com(;|$)/.test(m.content_security_policy.extension_pages), `${browser}: connections limited to the Gemini API`);
    for (const file of sourceFiles) {
      assert.deepEqual(await readFile(base + file), await readFile('extension/' + file), `${browser}/${file}: stale build; run npm run build`);
    }
  }
  assert.equal(m.content_scripts[0].run_at, 'document_start');
  assert.deepEqual(m.content_scripts[0].matches, ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://m.youtube.com/*']);
  if (browser !== 'firefox') assert.equal(m.background.service_worker, 'background.js');
  else {
    assert.deepEqual(m.background.scripts, ['core.js', 'summary.js', 'background.js']);
    // Summaries send video URLs and session intents to Google: Firefox must ask for that consent.
    const { DATA_COLLECTION } = (await import('../extension/summary.js')).default;
    assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'], optional: [...DATA_COLLECTION] }, 'firefox: summary data types must be declared as optional data collection');
  }
}
console.log('JavaScript syntax, network policy, permissions, and build assets verified.');
