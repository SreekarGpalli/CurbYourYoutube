// One command for builds, logic, both browser journeys, live checks and packages.
const { spawnSync } = require('node:child_process');
const { readdirSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..'));
const unitTests = readdirSync('tests').filter(name => name.endsWith('.test.cjs')).map(name => `tests/${name}`);
const jobs = [
  ['Build', ['scripts/build.mjs']],
  ['Logic tests', ['--test', ...unitTests]],
  ['Static/build checks', ['scripts/check.mjs']],
  ['Chrome Web Store privacy, consent and local storage', ['scripts/chrome-store-test.cjs']],
  ['Search, filtering, keyboard and session regressions', ['scripts/behavior-regression-test.cjs']],
  ['Settings accessibility and save regressions', ['scripts/settings-regression-test.cjs']],
  ['Chromium header and dock layout', ['scripts/layout-test.cjs', 'chromium']],
  ['Firefox header and dock layout', ['scripts/layout-test.cjs', 'firefox']],
  ['Shared Chromium/Firefox E2E journeys', ['scripts/e2e-test.cjs']],
  ['Startup and native search keyboard access', ['scripts/native-search-test.cjs']],
  ['Navigation and casual browsing journeys', ['scripts/navigation-test.cjs']],
  ['No premature or duplicate intent searches', ['scripts/search-submission-test.cjs']],
  ['Signed-in textarea search box handoff', ['scripts/textarea-search-test.cjs']],
  ['Hover Summarize button', ['scripts/summary-pill-test.cjs']],
  ['Summary card placement and hover edge cases', ['scripts/summary-card-test.cjs']],
  ['Summarize guards: synthetic clicks, stale intent, thumbnails, keyboard', ['scripts/summary-guards-test.cjs']],
  ['Saved search cards and exact query navigation', ['scripts/saved-search-test.cjs']],
  ['Every settings/popup control and recovery', ['scripts/controls-test.cjs']],
  ['Fullscreen header and break regression', ['scripts/fullscreen-test.cjs']],
  ['Thumbnail Chromium/Firefox journeys', ['scripts/thumbnail-test.cjs']],
  ['Timed homepage Chromium/Firefox journeys', ['scripts/homepage-test.cjs']],
  ['Chromium failure-recovery regression', ['scripts/browser-test.cjs']],
  ['Standalone Firefox regression', ['scripts/firefox-test.mjs']],
  ['Live signed-out Chromium/Firefox E2E journeys', ['scripts/live-e2e-test.cjs']],
  ['Live native search and suggestions', ['scripts/native-search-test.cjs', '--live']],
  ['Live thumbnail Chromium/Firefox journeys', ['scripts/thumbnail-test.cjs', '--live']],
  ['Package', ['scripts/package.mjs']],
  ['ZIP contents', ['scripts/check-package.mjs']]
];
let failed = false;
const report = { startedAt: new Date().toISOString(), jobs: [] };
for (const [name, args] of jobs) {
  console.log(`\n${name}`);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, timeout: 10 * 60000 });
  report.jobs.push({ name, status: r.error || r.status !== 0 ? 'failed' : 'passed', exitCode: r.status, error: r.error?.message });
  if (r.error || r.status !== 0) { console.error(`${name} failed: ${r.error?.message || `exit ${r.status}`}`); failed = true; }
}
report.finishedAt = new Date().toISOString(); report.status = failed ? 'failed' : 'passed';
mkdirSync('artifacts/e2e', { recursive: true });
writeFileSync('artifacts/e2e/full-run.json', JSON.stringify(report, null, 2) + '\n');
// Profiles are kept after a failure for inspection; a passing run removes them.
if (!failed && !process.env.CURB_KEEP_PROFILES) spawnSync(process.execPath, ['scripts/clean.mjs'], { stdio: 'inherit', windowsHide: true });
process.exitCode = failed ? 1 : 0;
