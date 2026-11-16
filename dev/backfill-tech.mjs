// Adds material/technique to works already in the cache. Writes dev/cache/tech.jsonl ({id, nl, en}); resumable.
// New harvests store technique themselves (row[11], row[12]), so this is only needed once for older caches.
// Usage: node dev/backfill-tech.mjs
import fs from 'node:fs'; import path from 'node:path';
import { getJSON, techOf, pool } from './lib.mjs';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const techFile = path.join(root, 'dev/cache/tech.jsonl');
const done = new Set(rd(techFile).map((t) => t.id));
const ids = new Set();
for (const c of rd(path.join(root, 'dev/cache/rows.jsonl'))) if (c.r && c.r.length < 12) ids.add(c.r[0]);
for (const c of rd(path.join(root, 'dev/cache/top.jsonl'))) if (c.r.length < 12) ids.add(c.r[0]);
const todo = [...ids].filter((id) => !done.has(id));
console.log(`${todo.length} works to fetch`);
const out = fs.createWriteStream(techFile, { flags: 'a' });
await pool(todo, 8, async (id) => {
  const d = await getJSON('https://id.rijksmuseum.nl/' + id);
  if (!d) return;
  const [nl, en] = techOf(d);
  out.write(JSON.stringify({ id, nl, en }) + '\n');
});
out.end();
