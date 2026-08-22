# نقشه پوشش مشتریان (Customer Coverage Map)

A private, password-gated web app showing customers and Tehran-province delivery
territory (visited / needs coverage / not allowed) on an interactive OpenStreetMap
map. Customer data flows one-way from the `سیستم فروش و انبار.xlsx` workbook;
district coverage status is tracked here, not in Excel.

## Stack

- Next.js 16 (App Router, TypeScript, Turbopack)
- SQLite via Node's built-in `node:sqlite` — no native build dependency
- Leaflet + react-leaflet + OpenStreetMap tiles (free, no API key, no sanctions-access risk)
- `exceljs` to read the workbook server-side (not the unmaintained `xlsx` npm package —
  it has unpatched high-severity CVEs with no fix available via npm)

## Local development

```bash
npm install
npm run dev       # http://localhost:3000
```

The app is gated by a single shared password (see `.env.local` — `APP_PASSWORD`).
Change it any time; sessions are signed cookies (`SESSION_SECRET`), 30-day expiry.

## District data (one-time setup, already done)

`districts` is pre-seeded from two open datasets (cloned into `data/`, gitignored —
only the derived `data/mahalle.geojson` is kept):

- `rferdosi/tehran-districts` — the 22 official منطقه (municipal district) polygons.
- `mehdimeskin/tehran-map` — 369 محله (neighborhood)-level polygons, converted from
  KML via `data/convert-kml.mjs`.

To re-seed (safe — never overwrites a status you've already set):
```bash
node --experimental-strip-types scripts/seed-districts.ts
```

Coverage isn't 100% complete or guaranteed accurate everywhere — use the polygon-draw
tool on the map to add or fix any neighborhood that's missing or wrong.

## Updating customer data

Use the "به‌روزرسانی از اکسل" panel in the app to upload the current
`سیستم فروش و انبار.xlsx`. It reads the `مخاطبین` sheet and upserts by `کد مشتری` —
safe to re-run any time the workbook changes. District/coverage data is a separate
table and is never touched by this import.

## Deployment (already set up on this server)

Runs as systemd service `coverage-map` on port **3003**, bound to `127.0.0.1` only
(not reachable from outside the machine directly — only through Caddy):

```bash
systemctl status coverage-map
journalctl -u coverage-map -f
```

To expose it publicly, add a subdomain block to Caddy — see
`deploy/Caddy-snippet.txt` for the exact block to add (not applied automatically;
add it yourself and run `systemctl reload caddy`).

To deploy a code change:
```bash
npm run build
systemctl restart coverage-map
```

## Data safety

`data/coverage.db` (SQLite) is the only source of truth for district status and
imported customer data — it is **not** committed to git (gitignored) and has no
automatic backup yet. Worth copying it somewhere occasionally, same as the Excel
workbook.
