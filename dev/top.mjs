// Topstukken: Rijksmuseum works ranked by how many Wikipedia articles they have (Wikidata sitelinks).
// Works with at least MIN_SITELINKS articles count as a masterpiece. Writes dev/cache/top.jsonl.
// Usage: node dev/top.mjs
import fs from 'node:fs'; import path from 'node:path';
import { getJSON, toRow, techOf, resolvePeople, ratio, pool } from './lib.mjs';

const MIN_SITELINKS = 2;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rowsFile = path.join(root, 'dev/cache/rows.jsonl');
const topFile = path.join(root, 'dev/cache/top.jsonl');

const Q = `SELECT ?inv (MAX(?s) AS ?sl) WHERE {
  ?item wdt:P195 wd:Q190804; p:P217 ?st; wikibase:sitelinks ?s.
  ?st ps:P217 ?inv; pq:P195 wd:Q190804.
  FILTER(?s >= ${MIN_SITELINKS})
} GROUP BY ?inv ORDER BY DESC(?sl)`;
const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(Q), {
  headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'trmnl-rijks-harvest/1.0' },
});
const list = (await res.json()).results.bindings
  .map((b) => ({ inv: b.inv.value.trim(), sl: Number(b.sl.value) }))
  .filter((x) => /^[A-Z]{1,3}-[A-Z0-9]/.test(x.inv));
console.log(`${list.length} works on Wikidata with ${MIN_SITELINKS}+ Wikipedia articles`);

const byNum = new Map();
if (fs.existsSync(rowsFile)) for (const l of fs.readFileSync(rowsFile, 'utf8').split('\n')) {
  if (!l) continue;
  const c = JSON.parse(l);
  if (c.r) byNum.set(c.r[1], c.r);
}

const typeOf = (n) => (/^SK-/.test(n) ? 'painting' : /^RP-P-/.test(n) ? 'print' : /^RP-T-/.test(n) ? 'drawing' : /^RP-F-/.test(n) ? 'photograph' : 'object');

const rows = await pool(list, 6, async ({ inv, sl }) => {
  try {
    let row = byNum.get(inv);
    if (!row) {
      const s = await getJSON('https://data.rijksmuseum.nl/search/collection?objectNumber=' + encodeURIComponent(inv));
      const hit = s && (s.orderedItems || [])[0];
      if (!hit) return null;
      const d = await getJSON(hit.id);
      row = toRow(d);
      if (!row || row[1] !== inv) return null;
      await resolvePeople(row);
      const r = await ratio(row[9]);
      if (!r) return null;
      row = [...row, r, ...techOf(d)];
    }
    return { t: typeOf(inv), sl, r: row };
  } catch (e) { console.warn('  skip', inv, e.message); return null; }
});
const kept = rows.filter(Boolean);
fs.writeFileSync(topFile, kept.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`${kept.length} masterpieces with a public-domain image -> dev/cache/top.jsonl`);
const tally = {}; for (const k of kept) tally[k.t] = (tally[k.t] || 0) + 1; console.log(tally);
