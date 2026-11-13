// Native Firefox BiDi smoke test. Node 22+ supplies WebSocket; no driver required.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import distractions from '../tests/distraction-fixtures.cjs';
const out = path.resolve('artifacts'); await mkdir(out, { recursive: true });
const profile = await mkdtemp(path.join(out, 'firefox-profile-'));
const extensionUuid = '6a1c6e2e-4f0b-4b8e-9c3a-2b1d7c0e5f41';
await writeFile(path.join(profile, 'user.js'), `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ 'curb-your-youtube@local.extension': extensionUuid }))});\n` + 'user_pref("remote.experimental.enabled", true);\nuser_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.startup.homepage_override.mstone", "ignore");\n');
const executable = process.env.FIREFOX_EXECUTABLE || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe';
const processHandle = spawn(executable, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', '--remote-allow-system-access'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let socket, nextId = 0, logs = '', browserClosed = false;
const pending = new Map();
const fixture = '<!doctype html><html><head><title>Python lesson - YouTube</title></head><body><ytd-app><ytd-browse page-subtype="home"><div id="contents">Recommendations</div></ytd-browse><ytd-watch-metadata><h1>Python lesson</h1></ytd-watch-metadata><video controls></video></ytd-app></body></html>';
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Firefox startup timed out: ${logs.slice(-2000)}`)), 15000);
    const read = bytes => { logs += bytes; const match = logs.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1] + '/session'); } };
    processHandle.stdout.on('data', read); processHandle.stderr.on('data', read);
    processHandle.once('error', error => { clearTimeout(timeout); reject(error); });
    processHandle.once('exit', code => { clearTimeout(timeout); reject(new Error(`Firefox exited: ${code} ${logs.slice(-1000)}`)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const job = pending.get(message.id); if (!job) return; clearTimeout(job.timeout); pending.delete(message.id);
      if (message.type === 'error') job.reject(new Error(`${message.error}: ${message.message}`)); else job.resolve(message.result);
    } else if (message.method === 'network.beforeRequestSent' && message.params.isBlocked) {
      command('network.provideResponse', { request: message.params.request.request, statusCode: 200, headers: [{ name: 'Content-Type', value: { type: 'string', value: 'text/html' } }], body: { type: 'base64', value: Buffer.from(fixture).toString('base64') } }).catch(error => console.error(error.message));
    }
  });
  const session = await command('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  await command('webExtension.install', { extensionData: { type: 'path', path: path.resolve('dist/firefox') } });
  await command('session.subscribe', { events: ['network.beforeRequestSent'] });
  await command('network.addIntercept', { phases: ['beforeRequestSent'], urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: 'www.youtube.com' }] });
  const { context } = await command('browsingContext.create', { type: 'tab' });
  await command('browsingContext.navigate', { context, url: 'https://www.youtube.com/', wait: 'complete' });
  async function evaluate(expression) {
    const response = await command('script.evaluate', { expression, target: { context }, awaitPromise: true });
    if (response.type === 'exception') throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result?.value;
  }
  async function until(expression) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error(`Condition did not become true: ${expression}`);
  }
  const root = 'document.getElementById("curb-extension-root")?.shadowRoot';
  await until(`${root}?.textContent.includes('What brings you to YouTube?')`);
  await evaluate(`${root}.querySelector('.preset').click(); ${root}.querySelector('form').requestSubmit(); true`);
  await until(`${root}?.textContent.includes('Search or browse')`);
  await command('browsingContext.navigate', { context, url: 'https://www.youtube.com/watch?v=lesson', wait: 'complete' });
  await until(`${root}?.textContent.includes('Does this video fit your intent?')`);
  await evaluate(`${root}.querySelector('.card .primary').click(); true`);
  assert.equal(await evaluate('document.querySelector("ytd-app").inert'), false);
  const { context: popup } = await command('browsingContext.create', { type: 'tab' });
  await command('browsingContext.navigate', { context: popup, url: `moz-extension://${extensionUuid}/popup.html`, wait: 'complete' });
  const popupReady = await command('script.evaluate', { expression: `new Promise((resolve,reject) => { let tries=0; const timer=setInterval(() => { const settings=[...document.querySelectorAll('button')].find(node=>node.textContent==='Settings'); if(settings){clearInterval(timer);settings.click();resolve(true);} else if(++tries>50){clearInterval(timer);reject(new Error('Popup Settings button unavailable'));} },100); })`, target: { context: popup }, awaitPromise: true });
  assert.equal(popupReady.result?.value, true, 'Popup Settings button opens options');
  let options;
  for (let attempt = 0; attempt < 50 && !options; attempt++) {
    const tree = await command('browsingContext.getTree', {});
    options = tree.contexts.find(c => c.url.endsWith('/options.html'));
    if (!options) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(options, 'Options tab should open');
  const optionsResult = await command('script.evaluate', { expression: 'new Promise(resolve => { let tries=0; const timer=setInterval(() => { if(document.querySelector("h1") || ++tries > 50) {clearInterval(timer);resolve(document.body.textContent.includes("Settings"));}},100); })', target: { context: options.context }, awaitPromise: true });
  assert.equal(optionsResult.result.value, true);
  async function optionsEvaluate(expression) {
    const result = await command('script.evaluate', { expression, target: { context: options.context }, awaitPromise: true });
    if (result.type === 'exception') throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  }
  assert.equal(await optionsEvaluate(`browser.runtime.sendMessage({type:'SETTINGS',settings:Object.fromEntries(Curb.CONTROLS.map(([key])=>[key,false]))}).then(r=>r.ok)`), true);
  await until(`!document.documentElement.hasAttribute('data-curb-hide-home')`);
  for (const [key, markup] of Object.entries(distractions)) {
    await evaluate(`{ document.getElementById('control-fixture')?.remove(); const node=document.createElement('div'); node.id='control-fixture'; node.innerHTML=${JSON.stringify(markup)}; document.querySelector('ytd-app').append(node); } true`);
    await until(`getComputedStyle(document.querySelector('[data-probe]')).display !== 'none'`);
    assert.equal(await optionsEvaluate(`browser.runtime.sendMessage({type:'SETTINGS',settings:{${key}:true}}).then(r=>r.ok)`), true);
    await until(`getComputedStyle(document.querySelector('[data-probe]')).display === 'none'`);
    assert.equal(await optionsEvaluate(`browser.runtime.sendMessage({type:'SETTINGS',settings:{${key}:false}}).then(r=>r.ok)`), true);
    await until(`getComputedStyle(document.querySelector('[data-probe]')).display !== 'none'`);
    console.log(`Firefox control passed: ${key}`);
  }
  await evaluate(`document.getElementById('control-fixture').remove(); true`);
  await optionsEvaluate(`browser.runtime.sendMessage({type:'SETTINGS',settings:{disableAutoplay:true,hideShorts:true}}).then(r=>r.ok)`);
  await evaluate(`const toggle=document.createElement('button'); toggle.className='ytp-autonav-toggle-button'; toggle.setAttribute('aria-checked','true'); toggle.onclick=()=>toggle.setAttribute('aria-checked','false'); document.querySelector('ytd-app').append(toggle); true`);
  await until(`document.querySelector('.ytp-autonav-toggle-button').getAttribute('aria-checked') === 'false'`);
  await evaluate(`document.querySelector('video').dispatchEvent(new Event('ended')); true`);
  assert.equal(await evaluate(`${root}?.textContent.includes('Does this video fit your intent?')`), false, 'The approved video remains approved after ending');
  await command('browsingContext.navigate', { context, url: 'https://www.youtube.com/watch?v=another-lesson', wait: 'complete' });
  await until(`${root}?.textContent.includes('Does this video fit your intent?')`);
  await evaluate(`${root}.querySelector('.card .primary').click(); true`);
  await command('browsingContext.navigate', { context, url: 'https://www.youtube.com/shorts/short1', wait: 'complete' });
  await until(`${root}?.textContent.includes('Shorts are hidden')`);
  await optionsEvaluate(`browser.runtime.sendMessage({type:'SETTINGS',settings:{redirectSubscriptions:true}}).then(r=>r.ok)`);
  await command('browsingContext.navigate', { context, url: 'https://www.youtube.com/feed/subscriptions', wait: 'complete' });
  await until(`location.pathname === '/' && !new URL(location.href).searchParams.has('search_query')`);
  await optionsEvaluate(`browser.runtime.sendMessage({type:'GET'}).then(r=>browser.runtime.sendMessage({type:'STOP',sessionId:r.data.session.id})).then(r=>r.ok)`);
  await until(`${root}?.textContent.includes('Session finished')`);
  await optionsEvaluate(`browser.runtime.sendMessage({type:'RESET'}).then(r=>r.ok)`);
  await until(`${root}?.textContent.includes('What brings you to YouTube?')`);
  const shot = await command('browsingContext.captureScreenshot', { context: options.context });
  await writeFile(path.join(out, 'firefox-settings.png'), Buffer.from(shot.data, 'base64'));
  console.log(`Firefox ${session.capabilities.browserVersion} passed: install, intent, video gate, options, all 24 controls, Shorts, finish and reset.`);
  await command('browser.close'); browserClosed = true;
} finally {
  if (socket?.readyState === WebSocket.OPEN && !browserClosed) await command('browser.close').catch(() => {});
  socket?.close();
  for (const job of pending.values()) clearTimeout(job.timeout);
  if (processHandle.exitCode === null) await new Promise(resolve => { processHandle.once('exit', resolve); setTimeout(() => { if (processHandle.exitCode === null) processHandle.kill(); resolve(); }, 2000); });
  if (path.dirname(path.resolve(profile)) !== out || !path.basename(profile).startsWith('firefox-profile-')) throw new Error('Unexpected test profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
