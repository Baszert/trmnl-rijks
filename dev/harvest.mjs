// Builds the static index the PHP picker reads.
// Usage: node dev/harvest.mjs [painting|drawing|print|photograph ...]   (default: all four)
// Paintings are harvested in full; drawings, prints and photographs as one search page (100 works) per decade.
// Every fetched object is cached in dev/cache/rows.jsonl, so a rerun only fetches what is new.
// Then run `node dev/top.mjs` for the masterpieces and `node dev/write.mjs` to write server/index/.
import fs from 'node:fs'; import path from 'node:path';
import { getJSON, toRow, techOf, resolvePeople, ratio, pool } from './lib.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const cacheFile = path.join(root, 'dev/cache/rows.jsonl');
fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
const SEARCH = 'https://data.rijksmuseum.nl/search/collection';
const TYPES = process.argv.slice(2).length ? process.argv.slice(2) : ['painting', 'drawing', 'print', 'photograph'];

// cache: id -> { t: type, r: row | null }
const cache = new Map();
if (fs.existsSync(cacheFile)) for (const l of fs.readFileSync(cacheFile, 'utf8').split('\n')) {
  if (!l) continue;
  const c = JSON.parse(l); cache.set(c.id, c);
}
const out = fs.createWriteStream(cacheFile, { flags: 'a' });

async function allPages(query) {
  const ids = [];
  let url = `${SEARCH}?${query}`;
  while (url) {
    const page = await getJSON(url);
    if (!page) break;
    for (const it of page.orderedItems || []) ids.push(it.id);
    url = page.next && page.next.id;
    if (ids.length % 1000 === 0) console.log(`  ${ids.length} ids`);
  }
  return ids;
}

async function firstPage(query) {
  const page = await getJSON(`${SEARCH}?${query}`);
  return page ? (page.orderedItems || []).map((it) => it.id) : [];
}

for (const type of TYPES) {
  console.log(`\n== ${type}`);
  let ids;
  if (type === 'painting') ids = await allPages('type=painting&imageAvailable=true');
  else {
    const decades = [];
    for (let d = type === 'photograph' ? 184 : 140; d <= 199; d++) decades.push(d);
    const lists = await pool(decades, 4, (d) => firstPage(`type=${type}&imageAvailable=true&creationDate=${d}?`));
    ids = [...new Set(lists.flat())];
  }
  const todo = ids.filter((u) => !cache.has(Number(u.split('/').pop())));
  console.log(`${ids.length} ids, ${todo.length} to fetch`);
  await pool(todo, 8, async (u) => {
    const id = Number(u.split('/').pop());
    let row = null;
    try {
      const d = await getJSON(u);
      row = toRow(d);
      if (row) {
        await resolvePeople(row);
        const r = await ratio(row[9]);
        row = r ? [...row, r, ...techOf(d)] : null;
      }
    } catch (e) { console.warn('  skip', u, e.message); row = null; }
    const c = { id, t: type, r: row };
    cache.set(id, c);
    out.write(JSON.stringify(c) + '\n');
  });
  const kept = [...cache.values()].filter((c) => c.t === type && c.r).length;
  console.log(`${type}: ${kept} public-domain works with image in cache`);
}
out.end();
