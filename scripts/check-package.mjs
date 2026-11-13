// Independently inflate ZIP entries and compare them with the generated builds.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { releaseTargets, archiveName } from './release-targets.mjs';
async function list(base, prefix = '') {
  const all = [];
  for (const entry of await readdir(base + '/' + prefix, { withFileTypes: true })) {
    if (entry.isDirectory()) all.push(...await list(base, prefix + entry.name + '/'));
    else all.push(prefix + entry.name);
  }
  return all.sort();
}
const expectedFiles = [...await list('extension'), 'manifest.json', ...[16, 32, 48, 128].map(size => `icons/${size}.png`)].sort();
for (const browser of releaseTargets) {
  const base = `dist/${browser}`;
  const { version } = JSON.parse(await readFile(base + '/manifest.json', 'utf8'));
  const bytes = await readFile(`dist/${archiveName(browser, version)}`);
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'ZIP end record');
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'No unsupported ZIP comment');
  const count = bytes.readUInt16LE(end + 10), names = [];
  let offset = bytes.readUInt32LE(end + 16);
  const directoryStart = offset;
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'ZIP directory signature');
    assert.equal(bytes.readUInt16LE(offset + 10), 8, 'Deflate compression');
    const size = bytes.readUInt32LE(offset + 20), rawSize = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28), extraSize = bytes.readUInt16LE(offset + 30), commentSize = bytes.readUInt16LE(offset + 32);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    assert(!name.startsWith('/') && !name.includes('..') && !name.includes('\\'), 'Safe archive path');
    assert(!names.includes(name), 'No duplicate entries'); names.push(name);
    const local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50, 'ZIP local signature');
    assert.equal(bytes.readUInt32LE(local + 14), bytes.readUInt32LE(offset + 16), 'CRC agrees between headers');
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert(start + size <= directoryStart, 'Data stays before the directory');
    const raw = inflateRawSync(bytes.subarray(start, start + size));
    assert.equal(raw.length, rawSize); assert.deepEqual(raw, await readFile(base + '/' + name), `${browser}/${name}: ZIP content differs`);
    offset += 46 + nameSize + extraSize + commentSize;
  }
  assert.equal(offset, end, 'Directory bounds'); assert.deepEqual(names.sort(), await list(base));
  const expected = browser === 'chrome-store' ? [...expectedFiles, 'local-storage.js'].sort() : expectedFiles;
  assert.deepEqual(names.sort(), expected, `${browser}: unexpected or missing release assets`);
  console.log(`${browser} ZIP verified: ${count} matching files`);
}
