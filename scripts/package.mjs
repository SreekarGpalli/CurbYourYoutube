// Deterministic ZIP packaging using Node built-ins only.
import './build.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { releaseTargets, archiveName } from './release-targets.mjs';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
async function files(base, prefix = '') {
  const result = [];
  for (const entry of (await readdir(path.join(base, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(base, name + '/'));
    else if (entry.isFile()) result.push(name);
  }
  return result;
}
for (const browser of releaseTargets) {
  const base = `dist/${browser}`, names = await files(base), local = [], central = [];
  let offset = 0;
  for (const name of names) {
    const raw = await readFile(path.join(base, name)), packed = deflateRawSync(raw), filename = Buffer.from(name), crc = crc32(raw);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, packed);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt16LE(8, 10); index.writeUInt16LE(33, 14);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(packed.length, 20); index.writeUInt32LE(raw.length, 24); index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
    central.push(index, filename); offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const { version } = JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8'));
  const destination = `dist/${archiveName(browser, version)}`;
  await writeFile(destination, Buffer.concat([...local, directory, end])); console.log(`Packaged ${destination}`);
}
