const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('rebuild removes deleted assets and release checks reject extra files', async () => {
  const workspace = path.resolve(__dirname, '..');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'curb-release-regression-'));
  const run = file => execFileSync(process.execPath, [file], { cwd: scratch, encoding: 'utf8', windowsHide: true });
  try {
    for (const name of ['extension', 'scripts', 'store', 'package.json'])
      await fs.cp(path.join(workspace, name), path.join(scratch, name), { recursive: true });
    for (const browser of ['chrome', 'firefox', 'chrome-store']) {
      await fs.mkdir(path.join(scratch, 'dist', browser), { recursive: true });
      await fs.writeFile(path.join(scratch, 'dist', browser, 'deleted-source-asset.js'), '/* stale asset */');
    }
    run('scripts/build.mjs');
    for (const browser of ['chrome', 'firefox', 'chrome-store'])
      await assert.rejects(fs.stat(path.join(scratch, 'dist', browser, 'deleted-source-asset.js')), { code: 'ENOENT' });
    assert.match(run('scripts/check.mjs'), /build assets verified/);
    run('scripts/package.mjs');
    assert.match(run('scripts/check-package.mjs'), /chrome-store ZIP verified/);

    const storeScript = path.join(scratch, 'dist/chrome-store/content.js');
    await fs.appendFile(storeScript, '\nfetch("https://www.youtube.com/");\n');
    const storeCheck = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: scratch, encoding: 'utf8', windowsHide: true });
    assert.notEqual(storeCheck.status, 0);
    assert.match(storeCheck.stderr, /unexpected fetch call in the store build/);
    run('scripts/build.mjs');

    for (const browser of ['chrome', 'firefox'])
      await fs.writeFile(path.join(scratch, 'dist', browser, 'deleted-source-asset.js'), '/* stale asset */');
    const staticCheck = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd: scratch, encoding: 'utf8', windowsHide: true });
    assert.notEqual(staticCheck.status, 0);
    assert.match(staticCheck.stderr, /unexpected or missing build assets/);

    // Construct a stale archive with the release serializer to exercise the independent verifier.
    const packageSource = await fs.readFile(path.join(scratch, 'scripts/package.mjs'), 'utf8');
    await fs.writeFile(path.join(scratch, 'scripts/package-stale.mjs'), packageSource.replace("import './build.mjs';", ''));
    run('scripts/package-stale.mjs');
    const archiveCheck = spawnSync(process.execPath, ['scripts/check-package.mjs'], { cwd: scratch, encoding: 'utf8', windowsHide: true });
    assert.notEqual(archiveCheck.status, 0);
    assert.match(archiveCheck.stderr, /unexpected or missing release assets/);
  } finally {
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    assert(path.basename(scratch).startsWith('curb-release-regression-'));
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('clean removes only browser profiles from artifacts/e2e, never saved reports', async () => {
  const workspace = path.resolve(__dirname, '..');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'curb-clean-regression-'));
  try {
    const e2e = path.join(scratch, 'artifacts', 'e2e');
    for (const [dir, file] of [['chromium-profile-x', 'Local State'], ['firefox-profile-y', 'user.js'], ['saved-reports', 'important.json']]) {
      await fs.mkdir(path.join(e2e, dir), { recursive: true });
      await fs.writeFile(path.join(e2e, dir, file), '{}');
    }
    await fs.writeFile(path.join(e2e, 'report.json'), '{}');
    const out = execFileSync(process.execPath, [path.join(workspace, 'scripts/clean.mjs')], { cwd: scratch, encoding: 'utf8', windowsHide: true });
    assert.match(out, /Removed 2 temporary browser profiles/);
    assert.deepEqual((await fs.readdir(e2e)).sort(), ['report.json', 'saved-reports']);
    assert.equal(await fs.readFile(path.join(e2e, 'saved-reports', 'important.json'), 'utf8'), '{}');
  } finally {
    assert(path.basename(scratch).startsWith('curb-clean-regression-'));
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
});
