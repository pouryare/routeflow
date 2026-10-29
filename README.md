# RouteFlow — سامانه فروش، پخش و مدیریت مسیر

A private, password-gated web app showing customers and Tehran-province delivery
territory (visited / needs coverage / not allowed) on an interactive OpenStreetMap
map. Customer data flows one-way from the `سیستم فروش و انبار.xlsx` workbook;
district coverage status is tracked here, not in Excel.

## UI rules

Phone-first patterns and how to build them: [`docs/mobile-first-principles.md`](docs/mobile-first-principles.md) (flows that record what happened: [`docs/tap-flow-principles.md`](docs/tap-flow-principles.md)). Run `npm run check:mobile` before committing UI changes.

## Stack

- Next.js 16 (App Router, TypeScript, Turbopack)
- PostgreSQL (self-hosted; see `db/README.md` and `docs/postgres-server.md`)
- MapLibre GL (`@vis.gl/react-maplibre`) over our own Protomaps tiles of Tehran province, served by the app; no foreign tile host (see `docs/map-tiles.md`)
- `exceljs` to read the workbook server-side (not the unmaintained `xlsx` npm package —
  it has unpatched high-severity CVEs with no fix available via npm)

## Local development

```bash
npm install
npm run dev       # http://localhost:3000
```

Sessions are signed cookies (`SESSION_SECRET`), 30-day expiry. Who you are is in the
cookie; what you may see is decided per request against the database — see below.

## Accounts and groups

Everyone signs in as themselves. There are three roles:

| Role | Sees |
|---|---|
| `owner` | Everything, every group. Only role that can reach `/admin/*`, run an import, or read the sales ledger and analytics. |
| `group_manager` | Only their own group's customers, districts, pins, lists, photos, reminders and plans. Plus the company-wide sites (the warehouse), which every group routes out of. |
| `driver` | Only `/driver`. Any other page sends them back there. |

A row belonging to another group answers **404, not 403** — a 403 would confirm it exists,
which by itself says how the province is carved up.

Manage accounts at **`/admin/users`** and groups and territory at **`/admin/groups`**, both
owner-only.

### The first owner

That one account cannot be made through `/admin/users`, because that screen needs you to
already be signed in as an owner. Start the app once so it can create and migrate the
database, then:

```bash
node scripts/create-user.mjs <username> <password> "<Display Name>" owner
```

A `group_manager` or `driver` additionally needs a group id as the fifth argument — an
account with a role but no group can reach nothing at all, so the script refuses to make one.

### `staff_code`

Free text, and it must match the شناسه column in the `همکاران` sheet of the workbook
**exactly** (`DRV1`, `SP2`, …). It is the join key for commission; a typo there does not
error, it just silently pays nobody.

### There is no shared password

`APP_PASSWORD` is gone. It used to open the app on its own, as an owner, so that adding
accounts could not lock the team out mid-migration — that job is done, and a password
several people know is not one anybody can be held to. Nothing reads the variable any more;
you can delete the line from `.env.local`.

The consequence worth knowing: **a named account is now the only way in.** If every owner
password is lost, the way back is SSH to the server and `scripts/create-user.mjs`, which
writes straight to the database and does not need anyone to be logged in.

Session cookies minted by the old shared login carry `uid: 0`, match no account, and are
rejected at the proxy — their holders are sent to the login form rather than into an app
where every page loads and nothing on it works.

## District data (one-time setup, already done)

`districts` is pre-seeded from two open datasets (cloned into `data/`, gitignored —
only the derived `data/mahalle.geojson` is kept):

- `rferdosi/tehran-districts` — the 22 official منطقه (municipal district) polygons.
- `mehdimeskin/tehran-map` — 369 محله (neighborhood)-level polygons, converted from
  KML via `data/convert-kml.mjs`.

The loader scripts for these polygons wrote to the old SQLite file and were removed with it
(Wave P, phase 5; they are in git history). The demo seed (`npm run seed:demo`) builds its own
geography. Loading the real polygons into PostgreSQL needs a new script when it is wanted.

Coverage isn't 100% complete or guaranteed accurate everywhere — use the polygon-draw
tool on the map to add or fix any neighborhood that's missing or wrong.

## The source workbook — where it actually lives

**`سیستم فروش و انبار.xlsx` lives on OneDrive.** That copy is the source of truth; any
copy sitting on this machine is a stale snapshot and must not be trusted. (One found in
`/root/` in August 2026 was missing seven columns of the `فروش` sheet, including every
commission column, which is exactly the kind of wrong answer a local copy gives you.)

The share link is configured server-side as `ONEDRIVE_SALES_FILE_URL` in `.env.local`.
It is an "anyone with the link" share — effectively a credential for the entire customer,
sales and debt dataset — so it stays out of git like every other secret here. Rotating the
link means changing that one variable and nothing else.

- `lib/oneDriveFetch.ts` fetches it (anonymous share-link redeem + manual redirect
  following with a cookie jar — see the comment there for why the obvious API routes
  don't work).
- `app/api/import/onedrive/route.ts` runs the import. It reads the URL from server config
  rather than the request body on purpose: accepting a client-supplied fetch target would
  make it an SSRF and data-injection vector.

To read the live workbook from a one-off script:

```bash
set -a && . ./.env.local && set +a
node --experimental-strip-types your-script.ts
# inside: import { fetchOneDriveFile } from "./lib/oneDriveFetch.ts";
```

## Updating customer data

Use the "به‌روزرسانی از اکسل" panel in the app to upload the current
`سیستم فروش و انبار.xlsx`, or trigger the OneDrive import above to pull it directly.
It reads the `مخاطبین` sheet and upserts by `کد مشتری` — safe to re-run any time the
workbook changes. District/coverage data is a separate table and is never touched by
this import.

## Deployment (already set up on this server)

> Fully renamed on 2026-09-08. The working directory is `/srv/routeflow`, the
> systemd units are `routeflow*`, the database is `data/routeflow.db`, and the env var
> is `ROUTEFLOW_DB_PATH`. Nightly backups are written as `routeflow-<ts>.db`; existing
> ones were renamed to match. Nothing is called `coverage-map` any more.

Runs as systemd service `routeflow` on port **3003**, bound to `127.0.0.1` only
(not reachable from outside the machine directly — only through Caddy):

```bash
systemctl status routeflow
journalctl -u routeflow -f
```

To expose it publicly, add a subdomain block to Caddy — see
`deploy/Caddy-snippet.txt` for the exact block to add (not applied automatically;
add it yourself and run `systemctl reload caddy`).

To deploy a code change:
```bash
npm run build
systemctl restart routeflow
```

## Data safety

The PostgreSQL database is the only source of truth for district status and imported
customer data. It is backed up by pgBackRest to a second machine, with a monthly restore drill
(`docs/postgres-server.md`).
