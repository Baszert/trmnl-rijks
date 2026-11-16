// Renders src/*.liquid for each scenario to dev/out/*.html with the real framework, then screenshots them with headless Chrome.
// Scenario data comes from the local art.php (start it with: php -S 127.0.0.1:8765 -t server) and is saved
// in dev/fixtures/, so reruns are stable. Pass --fresh to fetch new works.
// Usage: node dev/build.mjs [filter] [--fresh]
import fs from 'node:fs'; import path from 'node:path'; import { execFile } from 'node:child_process';
import { Liquid } from 'liquidjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const args = process.argv.slice(2);
const fresh = args.includes('--fresh');
const only = args.find((a) => !a.startsWith('--')) || '';
const engine = new Liquid();
engine.registerFilter('base64_encode', (s) => Buffer.from(String(s)).toString('base64'));

const S = {
  paint_nl: { q: 'type=painting', locale: 'nl', cf: {} },
  top_en: { q: 'type=all&top=true', locale: 'en', cf: {} },
  golden: { q: 'type=painting&period=1600', locale: 'nl', cf: { show_info: 'false' } },
  noorient: { q: 'type=painting', locale: 'en', cf: { match_orientation: 'false' } },
  cover: { q: 'type=painting&top=true', locale: 'nl', cf: { image_fit: 'cover' } },
  print: { q: 'type=print&period=1600', locale: 'nl', cf: {} },
  photo: { q: 'type=photograph', locale: 'en', cf: {} },
  long: { locale: 'nl', cf: {}, data: { ok: 1, pick: { o: 'SK-C-1611', t: 'Portret van Philippina Staunton, echtgenote van Roelof van Arkel (1632-1709), Heer van Broeckhuijsen, bekend als de dame met de waaier', te: 'x', m: 'Meester van de Heilige Verwantschap (II) en werkplaats van Jan van Scorel', me: '', d: 'ca. 1600 - ca. 1699', de: '', k: 'olieverf op paneel, verguld en beschilderd met tempera op doek', ke: '', i: 'PJEZO', r: 1.2 }, fit: [] } },
  down: { locale: 'nl', cf: {}, data: { ok: 0 } },
};
const DEV = {
  og: ['screen--og screen--1bit screen--md screen--no-bleed', 800, 480],
  x: ['screen--v2 screen--4bit screen--lg screen--no-bleed', 1872, 1404],
  xp: ['screen--v2 screen--4bit screen--lg screen--portrait screen--no-bleed', 1404, 1872],
  frame: ['screen--frame screen--1bit screen--lg screen--no-bleed', 2560, 1440],
  framec: ['screen--frame screen--color-6a screen--lg screen--no-bleed', 2560, 1440],
};
const MASH = { half_horizontal: ['mashup--1Tx1B', 2], half_vertical: ['mashup--1Lx1R', 2], quadrant: ['mashup--2x2', 4] };
const C = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

fs.mkdirSync(path.join(root, 'dev/out'), { recursive: true });
fs.mkdirSync(path.join(root, 'dev/fixtures'), { recursive: true });

async function dataFor(name, s) {
  if (s.data) return s.data;
  const f = path.join(root, `dev/fixtures/${name}.json`);
  if (!fresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const d = await (await fetch('http://127.0.0.1:8765/art.php?' + s.q)).json();
  fs.writeFileSync(f, JSON.stringify(d));
  return d;
}

const jobs = [];
for (const [name, s] of Object.entries(S)) {
  const data = await dataFor(name, s);
  const trmnl = { user: { locale: s.locale, utc_offset: 3600 }, plugin_settings: { instance_name: 'Rijksmuseum', custom_fields_values: { type: 'painting', period: 'all', masterpieces: 'false', match_orientation: 'true', image_fit: 'contain', show_info: 'true', ...s.cf } } };
  for (const v of ['full', 'half_horizontal', 'half_vertical', 'quadrant']) for (const [dk, [dc, w, h]] of Object.entries(DEV)) {
    const id = `${name}_${v}_${dk}`;
    if (only && !id.includes(only)) continue;
    const body = await engine.parseAndRender(read('src/shared.liquid') + read(`src/${v}.liquid`), { ...data, trmnl });
    let inner = `<div class="view view--${v}">${body}</div>`;
    const m = MASH[v];
    if (m) inner = `<div class="mashup ${m[0]}">${inner}${`<div class="view view--${v}"><div class="layout"></div></div>`.repeat(m[1] - 1)}</div>`;
    const f = path.join(root, `dev/out/${id}.html`);
    fs.writeFileSync(f, `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://trmnl.com/css/latest/plugins.css"><script src="https://trmnl.com/js/latest/plugins.js"></script></head><body class="environment trmnl"><div class="screen ${dc}">${inner}</div></body></html>`);
    jobs.push([f, w, h, id]);
  }
}

// A few at a time: many parallel Chromes make screenshots fire before the images arrive.
async function shoot([f, w, h, id]) {
  await new Promise((ok) => execFile(C, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=15000', `--window-size=${w},${h}`, '--force-device-scale-factor=1', `--screenshot=${path.join(root, 'dev/out', id + '.png')}`, 'file://' + f], () => ok()));
}
for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(shoot));
console.log('done', jobs.length);
