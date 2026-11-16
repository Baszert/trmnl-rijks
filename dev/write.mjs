// Writes server/index/ from the harvest cache: one file per type and period, top.json and manifest.json.
// Usage: node dev/write.mjs
import fs from 'node:fs'; import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'server/index');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const periodOf = (y) => (y == null ? null : y < 1500 ? 'pre1500' : y >= 1900 ? '1900' : String(Math.floor(y / 100) * 100));

// cache row: [id, objnum, tNL, tEN, mNL, mEN, dNL, dEN, begin, iiif, ratio, techNL?, techEN?]
// index row: [objnum, tNL, tEN|'', mNL, mEN|'', dNL, dEN|'', iiif, ratio, techNL, techEN|'']   ('' = same as NL, saves bytes)
const tech = new Map(readJsonl(path.join(root, 'dev/cache/tech.jsonl')).map((t) => [t.id, [t.nl, t.en]]));
const compact = (r) => {
  const tNL = r[2] || r[3], mNL = r[4], dNL = r[6] || r[7];
  const [kNL, kEN] = r.length > 11 ? [r[11], r[12]] : tech.get(r[0]) || ['', ''];
  return [r[1], tNL, r[3] && r[3] !== tNL ? r[3] : '', mNL, r[5] && r[5] !== mNL ? r[5] : '', dNL, r[7] && r[7] !== dNL ? r[7] : '', r[9], r[10],
    kNL || '', kEN && kEN !== kNL ? kEN : ''];
};

const files = {};
const add = (name, row) => (files[name] ||= []).push(row);
const seen = new Set();
for (const c of readJsonl(path.join(root, 'dev/cache/rows.jsonl'))) {
  if (!c.r || seen.has(c.id)) continue;
  // The search API's "painting" also returns painted objects (boxes, plaques, maps). Keep real paintings only:
  // SK = paintings collection, AK-MAK / AK-RAK = Asian paintings.
  if (c.t === 'painting' && !/^(SK-|AK-MAK-|AK-RAK-)/.test(c.r[1])) continue;
  seen.add(c.id);
  const p = periodOf(c.r[8]);
  add(`${c.t}-all`, compact(c.r));
  if (p) add(`${c.t}-${p}`, compact(c.r));
}

const top = readJsonl(path.join(root, 'dev/cache/top.jsonl')).map((x) => [x.t, periodOf(x.r[8]) || 'all', ...compact(x.r)]);
files.top = top;

// Big sets are shuffled and cut into parts of at most PART rows (name.0.json, name.1.json, ...), so art.php
// only ever reads one file of ~100 KB. The manifest holds the row count and the number of parts.
const PART = 800;
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const manifest = { built: new Date().toISOString().slice(0, 10) };
let bytes = 0, count = 0, biggest = 0;
for (const [name, rows] of Object.entries(files).sort()) {
  const parts = name === 'top' || rows.length <= PART ? 1 : Math.ceil(rows.length / PART);
  if (parts > 1) for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  for (let p = 0; p < parts; p++) {
    const chunk = parts > 1 ? rows.filter((_, i) => i % parts === p) : rows;
    const s = JSON.stringify(chunk);
    fs.writeFileSync(path.join(outDir, (parts > 1 ? `${name}.${p}` : name) + '.json'), s);
    bytes += s.length; count++; biggest = Math.max(biggest, s.length);
  }
  manifest[name] = rows.length;
  if (parts > 1) manifest[name + '.parts'] = parts;
  console.log(name.padEnd(22), String(rows.length).padStart(6), String(parts).padStart(3) + ' part(s)');
}
console.log(`largest file ${(biggest / 1024).toFixed(0)} KB`);
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`total ${(bytes / 1024 / 1024).toFixed(2)} MB in ${count} files`);
