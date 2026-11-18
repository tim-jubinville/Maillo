import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dist = join(root, 'dist');
const outDir = join(root, 'release');
const name = `mailmax-${pkg.version}`;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = walk(dist).map((p) => ({ path: `${name}/${relative(dist, p).split(sep).join('/')}`, data: readFileSync(p) }));
for (const extra of ['docs/INSTALL.md', 'README.md']) {
  entries.push({ path: `${name}/${extra.split('/').pop()}`, data: readFileSync(join(root, extra)) });
}

const local = [];
const central = [];
let offset = 0;
const d = new Date();
const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

for (const e of entries) {
  const nameBuf = Buffer.from(e.path, 'utf8');
  const comp = deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data) >>> 0;
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6);
  h.writeUInt16LE(8, 8);
  h.writeUInt16LE(dosTime, 10);
  h.writeUInt16LE(dosDate, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(comp.length, 18);
  h.writeUInt32LE(e.data.length, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  local.push(h, nameBuf, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE(20, 4);
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10);
  c.writeUInt16LE(dosTime, 12);
  c.writeUInt16LE(dosDate, 14);
  c.writeUInt32LE(crc, 16);
  c.writeUInt32LE(comp.length, 20);
  c.writeUInt32LE(e.data.length, 24);
  c.writeUInt16LE(nameBuf.length, 28);
  c.writeUInt32LE(offset, 42);
  central.push(c, nameBuf);
  offset += h.length + nameBuf.length + comp.length;
}

const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${name}.zip`);
writeFileSync(file, Buffer.concat([...local, centralBuf, end]));
console.log(`Created ${relative(root, file)} (${entries.length} files)`);
