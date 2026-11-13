const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {launch,until}=require('../tests/e2e-driver.cjs');
const root='document.getElementById("curb-extension-root").shadowRoot';
(async()=>{for(const browser of ['chromium','firefox']){
 const d=await launch(browser,'<meta charset="utf-8"><ytd-app><form action="/results"><input name="search_query"></form></ytd-app>',await fs.mkdtemp(`artifacts/e2e/${browser}-saved-`));
 try{
 const p=await d.open('https://www.youtube.com/');
 const q=s=>`${root}.querySelector(${JSON.stringify(s)})`;
 const find=t=>`[...(document.getElementById('curb-extension-root')?.shadowRoot.querySelectorAll('button')||[])].find(n=>n.textContent===${JSON.stringify(t)})`;
 // Wait for the control: after a navigation the new page renders the dock a moment later.
 const click=async t=>{await until(()=>d.evaluate(p,t=>[...(document.getElementById('curb-extension-root')?.shadowRoot.querySelectorAll('button')||[])].some(n=>n.textContent===t),t),`button ${t}`);await d.click(p,find(t));};
 await until(()=>d.evaluate(p,()=>!!document.getElementById('curb-extension-root')?.shadowRoot.querySelector('#curb-intent')),'intent');
 const nativeHas=text=>until(()=>d.evaluate(p,text=>document.activeElement?.name==='search_query'&&document.activeElement.value===text,text),`native search holds ${text}`);
 await click('Practice programming'); await d.fill(p,q('#curb-intent'),'Python'); await click('Start session');
 await nativeHas('Python'); await d.key(p,'Enter');
 await until(async()=>new URL(await d.url(p)).searchParams.get('search_query')==='Python','Programming + Python: user submits the exact query from the native box');
 await until(()=>d.evaluate(p,()=>document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.intent')?.textContent.includes('Python')),'Python intent restored after navigation');
 await click('Edit intent'); await d.fill(p,q('#curb-intent'),'Python & arrays? = caf\u00e9'); await click('Start session');
 await nativeHas('Python & arrays? = caf\u00e9'); await d.key(p,'Enter');
 await until(async()=>new URL(await d.url(p)).searchParams.get('search_query')==='Python & arrays? = caf\u00e9','typed punctuation and Unicode preserved');
 await click('Edit intent');
 await d.fill(p,q('#curb-intent'),'My own intent'); await click('Practice programming');
 assert.equal(await d.evaluate(p,()=>document.getElementById('curb-extension-root').shadowRoot.querySelector('#curb-intent').value),'My own intent');
 assert.equal(new URL(await d.url(p)).searchParams.get('search_query'),'Python & arrays? = caf\u00e9');
 await click('+ Add search');await d.fill(p,q('#curb-search-name'),'My music');await d.fill(p,q('#curb-search-query'),'Hindi music & jazz?');await click('Save search');
 await until(()=>d.evaluate(p,()=>!!document.getElementById('curb-extension-root').shadowRoot.querySelector('.saved-search-launch')),'saved');
 const second=await d.open('https://www.youtube.com/');
 await until(()=>d.evaluate(second,()=>[...(document.getElementById('curb-extension-root')?.shadowRoot.querySelectorAll('button')||[])].some(n=>n.textContent==='Edit intent')),'second session');
 await d.click(second,`[...${root}.querySelectorAll('button')].find(n=>n.textContent==='Edit intent')`);
 await until(()=>d.evaluate(second,()=>document.getElementById('curb-extension-root')?.shadowRoot.querySelector('.saved-search-launch')?.textContent==='My music'),'cross-tab');
 await d.activate(p); await click('Edit');await d.fill(p,q('#curb-search-query'),'Hindi music & jazz 2026?');await click('Save search');
 await until(()=>d.evaluate(second,()=>document.getElementById('curb-extension-root').shadowRoot.querySelector('.saved-search-launch')?.title==='Hindi music & jazz 2026?'),'edit sync');
 assert(await d.evaluate(p,()=>{
  const s=document.getElementById('curb-extension-root').shadowRoot;
  const grid=s.querySelector('.presets'), preset=grid.querySelector('[aria-pressed]'), saved=grid.querySelector('.saved-search');
  return saved.parentElement===grid && grid.contains(s.querySelector('.saved-search-launch')) &&
   Math.abs(saved.getBoundingClientRect().width-preset.getBoundingClientRect().width)<1 &&
   getComputedStyle(saved).backgroundColor!==getComputedStyle(preset).backgroundColor;
 }), 'saved cards share built-in grid columns and have distinct color');
 await d.screenshot(p,`artifacts/e2e/${browser}-saved-searches.png`);
 await d.resize(p,390,844);assert(await d.evaluate(p,()=>document.documentElement.scrollWidth<=innerWidth));await d.screenshot(p,`artifacts/e2e/${browser}-saved-searches-narrow.png`);
 await click('My music');await until(async()=>new URL(await d.url(p)).searchParams.get('search_query')==='Hindi music & jazz 2026?','exact query');
 await click('Edit intent');await click('Remove');await until(()=>d.evaluate(p,()=>!document.getElementById('curb-extension-root').shadowRoot.querySelector('.saved-search-launch')),'removed');
 assert.deepEqual(d.errors,[]);console.log(`${browser}: PASS Programming + Python exact search, Unicode query, shared colored card grid, saved search create/edit/remove, cross-tab sync, exact query, desktop/narrow screenshots`);
 }finally{await d.close();}
}})().catch(e=>{console.error(e);process.exitCode=1});
