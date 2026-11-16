// Shared helpers for the harvest scripts: polite fetching and turning a Linked Art object into one compact index row.
const UA = 'trmnl-rijks-harvest/1.0';
export const NL = 'http://vocab.getty.edu/aat/300388256';
export const EN = 'http://vocab.getty.edu/aat/300388277';
const PREFERRED = 'http://vocab.getty.edu/aat/300404670';
const OBJNUM = 'http://vocab.getty.edu/aat/300312355';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJSON(url, { tries = 4, accept = 'application/ld+json' } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (i === tries - 1) { console.warn('  give up', url, e.message); return null; }
      await sleep(1500 * (i + 1));
    }
  }
}

// Runs fn over items with a fixed number of workers.
export async function pool(items, workers, fn) {
  let next = 0, done = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
      if (++done % 250 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return out;
}

const langOf = (x) => [].concat(x.language || []).map((l) => l.id);
const has = (x, id) => [].concat(x.classified_as || []).some((c) => c.id === id);
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function pickName(names, lang) {
  const inLang = names.filter((n) => langOf(n).includes(lang));
  const pref = inLang.find((n) => has(n, PREFERRED)) || inLang[0];
  return clean(pref && pref.content);
}

function notation(o, lang) {
  const n = [].concat(o.notation || []).find((x) => x && x['@language'] === lang);
  return clean(n && n['@value']);
}

// Direct makers only (not "after", "mentioned on object"). A maker without a name in the record is
// returned as '#<person id>' and filled in later by resolvePeople().
function makers(prod, lang) {
  const parts = prod.part && prod.part.length ? prod.part : [prod];
  const names = [];
  for (const p of parts) for (const who of p.carried_out_by || []) {
    const n = notation(who, lang) || notation(who, lang === 'nl' ? 'en' : 'nl') || (who.id ? '#' + who.id.split('/').pop() : '');
    if (n && !names.includes(n)) names.push(n);
  }
  return names.slice(0, 2).join(', ');
}

const people = new Map();
export async function personName(pid) {
  if (people.has(pid)) return people.get(pid);
  const d = await getJSON('https://id.rijksmuseum.nl/' + pid);
  const names = ((d && d.identified_by) || []).filter((i) => i.type === 'Name');
  const v = { nl: pickName(names, NL) || pickName(names, EN), en: pickName(names, EN) || pickName(names, NL) };
  people.set(pid, v);
  return v;
}

// Replaces '#id' placeholders in the maker columns (4 = nl, 5 = en) with real names.
export async function resolvePeople(row) {
  for (const [col, lang] of [[4, 'nl'], [5, 'en']]) {
    if (!row[col].includes('#')) continue;
    const parts = await Promise.all(row[col].split(', ').map(async (p) => (p.startsWith('#') ? (await personName(p.slice(1)))[lang] : p)));
    row[col] = parts.filter(Boolean).join(', ');
  }
  return row;
}

// One Linked Art HumanMadeObject to a row, or null when it has no public-domain IIIF image.
// Row: [id, objectNumber, titleNL, titleEN, makerNL, makerEN, dateNL, dateEN, beginYear, iiif]
export function toRow(d) {
  if (!d || !d.id) return null;
  let iiif = null;
  for (const s of d.subject_of || []) for (const dc of s.digitally_carried_by || []) {
    const ap = (dc.access_point || []).map((a) => a.id).find((u) => /iiif\.micr\.io\//.test(u));
    if (!ap) continue;
    const lic = (dc.referred_to_by || []).map((r) => (r.content || '') + ' ' + (r._label || '')).join(' ');
    if (!/publicdomain|Public Domain/i.test(lic)) continue;
    iiif = ap.match(/iiif\.micr\.io\/([^/]+)/)[1];
    break;
  }
  if (!iiif) return null;
  const ids = d.identified_by || [];
  const objnum = clean((ids.find((i) => i.type === 'Identifier' && has(i, OBJNUM)) || {}).content);
  const names = ids.filter((i) => i.type === 'Name');
  const prod = d.produced_by || {};
  const ts = prod.timespan || (prod.part || []).map((p) => p.timespan).find(Boolean) || {};
  const tsNames = ts.identified_by || [];
  const begin = parseInt(String(ts.begin_of_the_begin || '').slice(0, 5), 10);
  const row = [
    Number(String(d.id).split('/').pop()), objnum,
    pickName(names, NL), pickName(names, EN),
    makers(prod, 'nl'), makers(prod, 'en'),
    pickName(tsNames, NL), pickName(tsNames, EN),
    Number.isFinite(begin) ? begin : null, iiif,
  ];
  if (!row[2] && !row[3]) return null;
  return row;
}

// Image width/height from IIIF, rounded to 2 decimals.
export async function ratio(iiif) {
  const info = await getJSON(`https://iiif.micr.io/${iiif}/info.json`, { accept: 'application/json' });
  return info && info.width && info.height ? Math.round((info.width / info.height) * 100) / 100 : null;
}

// Material and technique as on a museum label ("olieverf op doek" / "oil on canvas").
const MATERIAL_STATEMENT = 'http://vocab.getty.edu/aat/300435429';
export function techOf(d) {
  const st = [].concat((d && d.referred_to_by) || []).filter((r) => has(r, MATERIAL_STATEMENT));
  const pick = (lang) => clean((st.find((r) => langOf(r).includes(lang)) || {}).content);
  const nl = pick(NL), en = pick(EN);
  return [nl || en, en || nl];
}
