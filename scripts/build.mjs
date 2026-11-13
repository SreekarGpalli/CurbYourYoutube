import { mkdir, cp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { releaseTargets, storeSource } from './release-targets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const common = {
  manifest_version: 3,
  name: 'Curb Your YouTube',
  version,
  description: 'Hide YouTube distractions, set a session intent, and take timed breaks.',
  permissions: ['storage'],
  // Requested only when the user adds a Gemini API key for video summaries.
  optional_host_permissions: ['https://generativelanguage.googleapis.com/*'],
  action: { default_popup: 'popup.html', default_title: 'Curb Your YouTube', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  options_ui: { page: 'options.html', open_in_tab: true },
  content_scripts: [{ matches: ['https://www.youtube.com/*', 'https://youtube.com/*', 'https://m.youtube.com/*'], js: ['core.js', 'content.js'], css: ['content.css'], run_at: 'document_start' }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src https://generativelanguage.googleapis.com" }
};
// Generate our simple, original geometric mark without a graphics dependency.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const b of buffer) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
function icon(size, inset = 0) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (x < inset || y < inset || x >= size - inset || y >= size - inset) continue;
    const art = size - inset * 2;
    const u = (x - inset) / art, v = (y - inset) / art;
    const corner = Math.hypot(Math.max(.2 - u, u - .8, 0), Math.max(.2 - v, v - .8, 0)) > .2;
    const ring = Math.hypot(u - .48, v - .5);
    const mark = ring > .21 && ring < .30 && !(u > .5 && Math.abs(v - .5) < .16);
    const arrow = u > .54 && u < .79 && Math.abs(v - .5) < (.79 - u) * .7;
    const i = y * (size * 4 + 1) + 1 + x * 4;
    pixels.set(mark || arrow ? [237, 237, 237, 255] : [28, 28, 28, corner ? 0 : 255], i);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
for (const browser of releaseTargets) {
  const dist = path.resolve(root, 'dist');
  const out = path.resolve(dist, browser);
  if (path.dirname(out) !== dist) throw new Error('Build output must be a browser directory inside dist.');
  const store = browser === 'chrome-store';
  await rm(out, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(out, { recursive: true });
  if (store) {
    const sourceDir = path.join(root, 'extension');
    for (const name of await readdir(sourceDir)) {
      if (name === 'privacy.html') continue;
      await writeFile(path.join(out, name), storeSource(await readFile(path.join(sourceDir, name), 'utf8')));
    }
    await cp(path.join(root, 'store/local-storage.js'), path.join(out, 'local-storage.js'));
    const privacy = await readFile(path.join(root, 'store/privacy.html'), 'utf8');
    await writeFile(path.join(out, 'privacy.html'), privacy.replace('  </main>', '    <a href="options.html">← Back to settings</a>\n  </main>'));
    const site = path.join(dist, 'chrome-store-site');
    await mkdir(site, { recursive: true });
    await cp(path.join(root, 'store/index.html'), path.join(site, 'index.html'));
    await writeFile(path.join(site, 'privacy.html'), privacy);
    await cp(path.join(out, 'pages.css'), path.join(site, 'pages.css'));
  } else await cp(path.join(root, 'extension'), out, { recursive: true });
  await mkdir(path.join(out, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) await writeFile(path.join(out, 'icons', `${size}.png`), icon(size, store && size === 128 ? 16 : 0));
  const manifest = structuredClone(common);
  if (browser === 'firefox') {
    manifest.background = { scripts: ['core.js', 'summary.js', 'background.js'] };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'curb-your-youtube@local.extension',
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'], optional: ['browsingActivity', 'websiteActivity'] }
      }
    };
  } else {
    manifest.minimum_chrome_version = '120';
    manifest.background = { service_worker: 'background.js' };
  }
  if (store) {
    manifest.description = 'Focus controls for YouTube™. Hide distractions, set a session intent, and take timed breaks.';
    manifest.incognito = 'not_allowed';
    manifest.content_security_policy.extension_pages = "default-src 'self'; connect-src https://generativelanguage.googleapis.com; object-src 'none'; form-action 'none'; base-uri 'none'";
  }
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built ${browser}: ${out}`);
}
