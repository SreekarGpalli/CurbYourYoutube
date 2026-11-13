// Optional signed-out live-site smoke check. Uses no saved browser profile or account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const out = path.resolve('artifacts');
  await fs.mkdir(out, { recursive: true });
  const profile = await fs.mkdtemp(path.join(out, 'live-profile-'));
  const extension = path.resolve('dist/chrome');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
      headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('heading', { name: 'What brings you to YouTube?' }).waitFor();
    await page.getByRole('button', { name: 'Practice programming' }).click();
    await page.getByRole('button', { name: 'Start session' }).click();
    await page.getByRole('heading', { name: 'Search or browse' }).waitFor();
    await page.goto('https://www.youtube.com/results?search_query=Python+tutorial', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const link = page.locator('ytd-video-renderer a#video-title[href*="/watch?"]').first();
    await link.waitFor();
    const videoUrl = await link.getAttribute('href');
    await page.goto(new URL(videoUrl, 'https://www.youtube.com').href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('heading', { name: 'Does this video fit your intent?' }).waitFor();
    await page.waitForFunction(() => !!document.querySelector('video'));
    assert.equal(await page.locator('video').first().evaluate(v => v.paused), true);
    assert.equal(await page.locator('ytd-app').evaluate(n => n.inert), true);
    await page.screenshot({ path: path.join(out, 'live-video-gate.png') });
    console.log('Live signed-out Chromium passed: homepage intent, search results, direct-video gate, inert page and paused video. No video was approved for playback.');
  } finally {
    await context?.close();
    if (path.dirname(path.resolve(profile)) !== out || !path.basename(profile).startsWith('live-profile-')) throw new Error('Unexpected test profile path');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
