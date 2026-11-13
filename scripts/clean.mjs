// Remove temporary browser profiles left by browser test runs. Screenshots, JSON reports and any other
// directory stay: only a directory holding a browser's own profile files is removed.
import { readdir, rm, stat } from 'node:fs/promises';
const dir = 'artifacts/e2e';
// Chromium writes "Local State"; Firefox profiles hold prefs.js, or at least the user.js the test driver writes.
const PROFILE_MARKERS = ['Local State', 'prefs.js', 'user.js', 'times.json'];
const isProfile = async path => (await Promise.all(PROFILE_MARKERS.map(name => stat(`${path}/${name}`).then(s => s.isFile(), () => false)))).some(Boolean);
let removed = 0;
for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
  const path = `${dir}/${entry.name}`;
  if (entry.isDirectory() && await isProfile(path)) { await rm(path, { recursive: true, force: true, maxRetries: 3 }); removed++; }
}
console.log(`Removed ${removed} temporary browser profile${removed === 1 ? '' : 's'} from ${dir}.`);
