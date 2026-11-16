# Rijksmuseum for TRMNL

A public-domain work from the Rijksmuseum on every refresh. No account, no keys.

```
[local, once a month]  dev/harvest.mjs + dev/top.mjs + dev/write.mjs  ->  server/index/*.json
[every refresh]        TRMNL polls  art.php?type=..&period=..&top=..  ->  ~1-2 KB JSON
[at render]            the image comes straight from iiif.micr.io at the exact size of the screen
```

## Layout

| Path | What |
|---|---|
| `src/` | The TRMNL plugin: `settings.yml`, `shared.liquid` (logic and script) and the four views |
| `server/art.php` | Tiny picker for your PHP server (PHP 7.4+, no extensions beyond json) |
| `server/index/` | Static index: one file per type and period, big sets split into parts of max 800 works (largest ~120 KB) |
| `dev/` | Harvest scripts, local renderer, fixtures |

## Settings

| Field | Values |
|---|---|
| Type of work | Paintings (default), Drawings, Prints, Photographs, Everything |
| Masterpieces only | ~200 works with 2+ Wikipedia articles (via Wikidata) |
| Period | Any, before 1500, 16th to 20th century |
| Match screen shape | On: the work whose shape fits the screen or mashup slot best |
| Fit | Contain (whole work) or Cover (fills the screen edge to edge, crops the sides) |
| Show museum label | A small label bottom right: artist, title, year, technique, inventory number (Dutch for `nl` users, English otherwise) |

## Deploy

1. Upload `server/` (or unzip `rijks-server.zip`) to `https://trmnl.achtnegen.nl/rijks/`, so `art.php` and `index/` sit side by side.
2. Check it: `https://trmnl.achtnegen.nl/rijks/art.php?type=painting` should return JSON with `"ok":1`.
3. `trmnlp push` to create the private plugin, add it to a playlist and check the live render on a device.

## Refresh the index

```bash
node dev/harvest.mjs           # resumes from dev/cache/rows.jsonl; only fetches new works
node dev/top.mjs               # masterpieces from Wikidata
node dev/backfill-tech.mjs     # only for caches made before technique was harvested
node dev/write.mjs             # writes server/index/
```

Then upload `server/index/` again. A full harvest from scratch takes about 30 minutes.

## Local preview

```bash
php -S 127.0.0.1:8765 -t server
node dev/build.mjs [filter] [--fresh]    # renders dev/out/*.html and .png for OG, X, X portrait, Frame (gray and colour)
```

## Credits

Images and data: Rijksmuseum, public domain (only works marked Public Domain are indexed). Masterpiece ranking: Wikidata (CC0).
