# Multi-group operations, drivers and live tracking — design

Date: 2026-08-25
Status: approved, not yet implemented.

The business is splitting Tehran province among several groups, each with its own
management, while supply chain and delivery management stay centralised with the owner.
This document covers three phases: identity and group scoping (0), delivery runs with
van stock and workbook write-back (1), and live driver location (2).

## Decisions taken before design

| Question | Decision |
|---|---|
| Tenancy | One app, one database. Every row tagged `group_id`. Owner sees all; group manager sees only their group; driver sees only their own run. |
| Territory | Assign the existing 22 منطقه / 369 محله polygons to groups. Point-in-polygon gives a stop its group. |
| Delivery source | Per-group Excel upload → auto-split proposal by territory and load → human review → publish. |
| Who assigns | Both — group managers within their group, owner anywhere, and the owner can override. |
| Shared password | Retired. Named accounts only, with one migration release where `APP_PASSWORD` still works as an owner login. |
| Tracking | PWA + wake lock + offline queue. Honest "last seen N min ago" when it gaps. No native app for now. |
| Workbook write-back | The app writes the `.xlsx` directly (§4). |
| فروش فوری | In Phase 1, tied to van stock (§5). |

---

## 1. What the workbook actually contains

Read directly from `سیستم فروش و انبار.xlsx` on 2026-08-25. These findings constrain
Phases 1 and 2 and are the reason this design is larger than first sketched.

**Sheets:** `کدهای جغرافیایی` · `مخاطبین` · `همکاران` · `کالاها` · `خرید` · `فروش` ·
`موجودی انبار` · `داشبورد` · `کارهای امروز` · `پورسانت` · `پرداخت پورسانت` ·
`ارسال امروز` · `راهنما`

**Only six sheets hold real input:** `فروش`, `خرید`, `مخاطبین`, `کالاها`, `همکاران`,
`پرداخت پورسانت`. `موجودی انبار`, `پورسانت`, `ارسال امروز` and `داشبورد` are entirely
formula-driven and must never be written to — they recalculate themselves.

### 1.1 `همکاران` — the staff roster

A stable ID scheme already exists: `SP1..SP3` (فروشنده — فاطمه، نازنین، یاسمین) and
`DRV1..DRV10` (راننده — DRV1 = یوسف, the only one filled in). Columns: شناسه، نقش، نام،
نرخ پورسانت عادی (تومان/کیلوگرم)، نرخ پورسانت فروش فوری.

**Consequence:** `users` carries a `staff_code` from the first migration. It is the join
key between an app account and the payroll side of the workbook. Drivers earn per
kilogram, at a higher rate for فروش فوری (یوسف: ۲۴٬۰۰۰ vs ۳۰٬۰۰۰).

### 1.2 `فروش` — the sales ledger, and the write-back target

Actual layout, read from the header row:

| Col | Header |
|---|---|
| A | تاریخ |
| B | شماره سفارش |
| C | مشتری |
| D | کالا و بسته‌بندی |
| E | تعداد بسته |
| F | مقدار کسر شده (formula: `E × pack size`, in base units — this is what draws down stock) |
| G | قیمت فروش هر بسته |
| H | جمع فروش |
| I | بهای تمام‌شده |
| J | سود |
| K | وضعیت پرداخت |
| L | **وضعیت ارسال** |
| M | کالا (خودکار) |
| N | واحد (خودکار) |

**`فروش` stops at column N.** But `پورسانت` computes driver pay as
`SUMIFS(فروش!$S, فروش!$U, name)` and salesperson pay as `SUMIFS(فروش!$R, فروش!$Q, name)`.
Columns Q/R/S/U **do not exist in the workbook today** — they are referenced by the
commission sheet but never populated.

**Consequence: driver commission currently computes to zero.** The write-back does not
merely fill these columns in; it has to establish them. O, P and T have no known
meaning and must be left alone. This is a one-time, explicitly confirmed setup step,
not something the app should infer (§4.3).

### 1.3 `ارسال امروز` — the delivery list

A filtered view of `فروش` where `L <> "تحویل‌شده"` — note it is *all* outstanding
orders, not only today's. «مبلغ قابل دریافت» is `IF(K="پرداخت‌شده", 0, H)`, so the COD
figure is already correct: prepaid orders show zero to collect. The driver app can
show this column verbatim.

### 1.4 `کالاها` and `موجودی انبار` — stock

Four products (`NMA-VEG`, `NMA-ANM`, `MRH-VEG`, `MRH-VEG-BULK`), each with a base unit
(عدد or کیلوگرم) and a packaging table at `کالاها` rows 10–13 mapping a packaging label
to product id, unit and quantity-per-pack.

`موجودی انبار` is fully derived: `کل ورودی` = `SUMIF(خرید)`, `کل خروجی` =
`SUMIF(فروش!F keyed on فروش!M)`, current stock = in − out, plus a reorder suggestion.

**Consequence — and this is the key insight for van stock:** the workbook tracks stock
at *business* level with no location dimension. A sale draws down the single pool the
moment it is recorded, whether it left a warehouse or a van. So the app must not try to
own the total; it owns only the *split* — where inside the business the stock currently
sits. Van stock is a **sub-ledger between "left the warehouse" and "sold to a
customer"**, and it never contradicts the workbook's total. §5 builds on this.

### 1.5 Commission per kilogram is not computable today

The packaging table (`کالاها` rows 9–13) maps a packaging to **base units**, not to
weight:

| بسته‌بندی | کالا | مقدار در هر بسته | base unit |
|---|---|---|---|
| NMA-VEG-CB | NMA-VEG | 120 | عدد |
| NMA-ANM-CB | NMA-ANM | 120 | عدد |
| MRH-VEG-CB | MRH-VEG | 100 | عدد |
| MRH-VEG-BULK-BLK | MRH-VEG-BULK | 10 | کیلوگرم |

Driver commission is تومان/کیلوگرم (§1.1), but three of the four products are counted in
عدد and **no column anywhere in the workbook gives the weight of one عدد**. Commission is
therefore computable only for `MRH-VEG-BULK`.

**This is missing business data, not a design decision, and it blocks §4.4 and §5.**
The recommended fix is one new column in `کالاها` — «وزن هر واحد پایه (کیلوگرم)» — which
makes every product's weight derivable as `مقدار کسر شده × وزن واحد پایه`. Until that
column exists and is filled in, the app must record kilograms as unknown rather than
guess, and must not write a commission figure it cannot justify.

---

## 2. Phase 0 — Identity, roles, groups

Nothing user-visible improves. Everything depends on it, and it is security-critical:
today no API route checks anything beyond "the session cookie is valid" (`proxy.ts`), so
all ~25 routes under `app/api/` return province-wide data to anyone signed in.

### 2.1 Schema

New `groups` table: `id`, `name`, `slug`, `color` (map tint), `active`, `created_at`.

`users` gains `role` (`owner` | `group_manager` | `driver`), `group_id`, `staff_code`
(§1.1), `active`, `token_version`, `phone`, `location_consent_at`. SQLite cannot add
these constraints via `ALTER`, so use the **table-rebuild migration pattern already in
`lib/db.ts`** — `saved_locations` (~line 224), `activity_log` (~line 296) and
`visit_plans` (~line 331) each do exactly this inside `BEGIN`/`COMMIT` with a `ROLLBACK`
guard. Copy that shape.

`districts` gains `group_id INTEGER REFERENCES groups(id)`. Leave the existing
`assigned_to TEXT` alone — it is a free-text person name and means something else.

`customers` gains `group_id`, maintained as a **derived cache**, not a second source of
truth: recomputed from district containment when district→group assignment changes and
on every import. Deriving per query would mean point-in-polygon against 369 polygons per
customer.

### 2.2 Session and authorisation

New `lib/session.ts` beside the existing `lib/auth.ts` (keep `hashPassword`,
`verifyPassword`, `sign` — they are fine):

- `getSession(req)` — verify the HMAC, then load the user row and reject if `active = 0`
  or `token_version` no longer matches the token's. DB-backed rather than trusting the
  claim, so deactivating a driver or changing a role takes effect on the next request
  rather than in 30 days.
- `requireRole(req, roles)` — returns the session or a 403 JSON response.
- `scopeGroupIds(session)` — `'all'` for owner, `[session.group_id]` otherwise. Every
  list query threads this.

**Bump the cookie name** (`coverage_session` → `coverage_session_v2`). A clean break
costs one re-login and avoids backward-compat parsing for a token shape that no longer
carries enough information.

`proxy.ts` stays a coarse gate — signed-in check plus route-prefix gating (`/driver/*`,
`/admin/*`). The authoritative check lives in each route, because middleware cannot
safely reach SQLite.

### 2.3 Route work

Every route under `app/api/` gets `requireRole` plus a group filter. Representative
cases:

- `app/api/customers/route.ts` — filter by `group_id`.
- `app/api/districts/bulk/route.ts` — reject ids outside the caller's group. Already has
  the transaction + activity-log shape to extend.
- `app/api/import/route.ts` — upserts by `کد مشتری` **globally**. With per-group
  workbooks this can clobber another group's customers; needs a group tag and a guard.
- `app/page.tsx`, `app/planner/page.tsx` and the other server components read the DB
  directly and must scope too.

`getActorName` call sites (`visit-plans`, `photos`, `activity`, `districts/[id]`,
`districts/bulk`) move to `session.display_name` and additionally store `user_id`, so
attribution survives a rename.

### 2.4 Admin UI

`/admin/groups` and `/admin/users`, owner only: create a group; create a user
(username / password / display name / role / group / `staff_code` / phone); reset a
password; deactivate. Replaces day-to-day use of `scripts/create-user.mjs` — keep that
script as the bootstrap for the first owner account.

### 2.5 Retiring the shared password

Two releases. First: accounts work, `APP_PASSWORD` still logs in as owner, and the app
shows a standing warning. Once every account exists, the second release deletes the
`checkPassword` branch from `app/api/login/route.ts` and the function from `lib/auth.ts`.

---

## 3. Phase 1a — Delivery batches, runs and the driver app

### 3.1 Schema

- **`delivery_batches`** — one Excel upload: `group_id`, `run_date`, `source_filename`,
  `uploaded_by`, `row_count`. Gives "which file did this stop come from" and an undo,
  mirroring the existing `import_log` / `import_snapshots` / `/api/import/undo` idea.
- **`delivery_runs`** — `group_id`, `driver_id` (nullable → the unassigned pool),
  `run_date`, `status` (`draft`/`published`/`in_progress`/`completed`/`cancelled`),
  `origin_facility_id`, `published_at`/`started_at`/`completed_at`, `created_by`. Unique
  index on `(driver_id, run_date)` where `driver_id IS NOT NULL`.
- **`delivery_stops`** — `run_id`, `batch_id`, `customer_id`, plus a **snapshot** of the
  order line (`order_no`, `customer_name`, `address`, `phone`, `product`, `qty`,
  `amount`), because that day's sheet row is the contract and must not shift when the
  customer record is later edited. Also `lat`/`lng`, `district_id`, `group_id`,
  `sort_order`, `status` (`pending`/`en_route`/`delivered`/`failed`/`partial`/`skipped`),
  `failure_reason`, `collected_amount`, `arrived_at`, `completed_at`, `completed_lat`,
  `completed_lng` (where the driver actually stood when they pressed the button), `notes`.

Deliberately **not** an extension of `visit_plans`. That table is a thin entity reference
for the sales-visit planner; a delivery carries order numbers, cash to collect, failure
reasons and proof-of-position. Both stay.

### 3.2 Import → auto-split → publish

1. `POST /api/deliveries/batches` — group-scoped upload, reusing the parser in
   `lib/deliveryParse.ts` and the customer matching in
   `app/api/deliveries/parse/route.ts`. `group_id` comes from the session; the owner
   picks it.
2. **Resolve position** per stop: matched customer's `lat`/`lng` → sheet `lat`/`lng` →
   map link via `lib/resolveMapsLink.ts`. Unresolvable stops go to a "needs a pin" list
   rather than being dropped.
3. **Find the owning group**: `pointInRing` (`lib/trafficZones.ts:111`) against district
   geometry gives the containing district, hence its `group_id`. A stop landing in
   another group's territory is *flagged* («متعلق به گروه X») — never silently
   reassigned.
4. **Propose a driver** within the group: reuse the geographic clustering in
   `lib/clusterDays.ts`, which already splits a stop set into coherent geographic
   groups, plus a load-balance pass so drivers get comparable stop counts.
5. **Review UI** (`/dispatch/assign`): map coloured by proposed driver on one side,
   per-driver columns on the other, drag to move a stop. Reorder within a driver using
   `twoOptOrder` / `nearestNeighborOrder` from `lib/geo.ts`, origin = the group's
   default warehouse from `facilities`.
6. **Publish** — runs flip `draft` → `published`; optional web-push via the existing
   `lib/push.ts` and `push_subscriptions`.

### 3.3 Driver app (`/driver`)

One page. Today's run as ordered stop cards: business name, address, tap-to-call phone,
navigation deep link (reuse `lib/navApps.ts` — Waze / Neshan / Google already wired), and
amount to collect taken straight from «مبلغ قابل دریافت» (§1.3). Per stop:
«حرکت به مقصد» / «تحویل شد» / «تحویل نشد» + reason. Position captured at each press.

A driver must **not** see debt aging, other customers, other drivers, the coverage map,
or sales history. Enforced server-side by role — hiding the UI is not the control.

**Offline writes.** `public/sw.js` is currently read-only by explicit design ("Writes ...
are NOT queued while offline -- that's a deliberate scope boundary"). That boundary has
to move: stop-status writes queue in IndexedDB and flush on reconnect. A driver in a
basement loading bay who marks a stop delivered cannot lose it.

---

## 4. Phase 1b — Writing back to the workbook

The app writes `سیستم فروش و انبار.xlsx` directly. This is the riskiest component in the
design: the workbook is the business's accounting system, and the app is not its only
writer.

### 4.1 Known hazards

1. **exceljs re-serialises the whole workbook.** It does not round-trip charts, pivot
   tables, conditional formatting or data validation faithfully. `داشبورد` is the most
   likely casualty.
2. **Formulas are not recalculated** by exceljs; cached results are preserved. A written
   workbook can therefore show stale derived values until opened in Excel.
3. **The file moved during the design session** — from `/root/pourya/` to
   `/root/telepourya/` — without the app's involvement. Its location is not stable and
   other processes touch it.
4. **OneDrive.** `lib/oneDriveFetch.ts` reads the workbook from a share link. If the
   canonical copy lives in OneDrive, a local write races the sync client.

### 4.2 Mandatory guards

These are not optional hardening; without them this feature can destroy the accounting
file.

- **Never write in place.** Read → modify → write to a temporary file → re-open and
  verify → atomic `rename()` over the original. Keep the prior version as a timestamped
  backup under `data/workbook-backups/`.
- **Content-hash guard.** Record the SHA-256 of the workbook at read time; refuse to
  write if it no longer matches, because someone edited it meanwhile. Surface a clear
  "the file changed, re-import first" error.
- **Pre-flight structure check.** Verify sheet names, the header row of `فروش`, and that
  the target row's `شماره سفارش` (column B) matches the stop's `order_no` before touching
  any cell. Refuse the whole write on any mismatch — never a partial write.
- **Write only `فروش`.** Columns L, Q, R, S, U (§4.3). Never the derived sheets.
- **Configured path, not a guess.** A `WORKBOOK_PATH` env var, validated at startup.
- **Dry-run mode first.** The write path reports exactly which cells it would change,
  and the owner confirms, before anything is written.

### 4.3 Establishing the commission columns

Because Q/R/S/U do not exist yet (§1.2), the first write is a schema change to the
workbook, not a data update. Handle it as an explicit one-time setup screen that shows
the intended headers — Q = فروشنده، R = پورسانت فروشنده، S = پورسانت راننده،
U = راننده — and requires the owner to confirm before writing. O, P and T are left
untouched; their meaning is unknown.

**Before this ships**, run the one-time fidelity test: write a *copy* of the real
workbook through the exceljs path, open it in Excel, and confirm `داشبورد`, formatting
and all formulas survived. If they do not, the write-back has to fall back to producing
a paste-in sheet instead, and that outcome should be reported rather than worked around.

### 4.4 What gets written

On run completion, for each delivered stop: `L` = `تحویل‌شده`, `U` = the driver's name
from `همکاران` (matched via `users.staff_code`), and `S` = the driver's commission —
kilograms delivered × the driver's rate, at the فروش فوری rate where the line came from a
van sale. Failed stops leave `L` untouched.

**`S` cannot be computed until the weight column of §1.5 exists.** Until then the write
back fills `L` and `U` only, and leaves `S` empty rather than writing a fabricated
figure. `L` and `U` alone are still worth having: they close the delivery loop and
attribute the sale, and `U` is half of what `پورسانت` needs.

---

## 5. Phase 1c — Van stock and فروش فوری

Built on §1.4: the app owns the *split*, never the total.

### 5.1 Schema

- **`products`** — mirrored from `کالاها` on import: `product_code` (`NMA-VEG` …),
  `name`, `base_unit`, `category`. Plus a `packagings` table from the `کالاها` rows 10–13
  table: `product_code`, `label`, `qty_per_pack`, so a packaging label converts to base
  units exactly as `فروش!F` does.
- **`van_loads`** — one per run: `run_id`, `facility_id` (loaded from), `loaded_by`,
  `loaded_at`, `reconciled_at`, `status`.
- **`van_load_lines`** — `van_load_id`, `product_code`, `qty_base_units`, `qty_returned`.
- **`instant_sales`** — a sale made from the van: `run_id`, `driver_id`, `customer_id`
  (nullable — may be a new customer), `product_code`, `qty_base_units`, `amount`,
  `lat`/`lng`, `sold_at`, plus `exported_at` for the write-back.

### 5.2 Flow

1. **Load** at the depot: the manager (or driver) records what goes on the van, in
   packagings, converted to base units. Van on-hand = loaded − delivered − sold − returned.
2. **Deliver** an assigned stop: draws down van stock for that stop's product lines.
3. **فروش فوری**: the driver records an unplanned sale. The app checks van on-hand and
   refuses to sell what is not on the van. Flagged as فروش فوری so it earns the higher
   commission rate.
4. **Reconcile** at end of day: expected on-hand vs counted returns. A discrepancy is
   recorded, not silently absorbed.
5. **Export**: instant sales become new `فروش` rows via §4. This is the one case where
   the write-back *appends* rather than updates, and it is the highest-risk write —
   gate it behind the same dry-run confirmation.

### 5.3 Scope note

This is the supply-chain phase pulled forward, at the user's explicit direction after
the trade-off was put to them. It roughly doubles Phase 1. It is specified here in full,
but if schedule pressure appears, §5 is the part that can ship separately from §3 and
§4 without stranding them — §3 and §4 are independently useful.

---

## 6. Phase 2 — Live location

### 6.1 Schema

- **`driver_pings`** — `user_id`, `run_id`, `lat`, `lng`, `accuracy`, `heading`, `speed`,
  `battery`, `recorded_at` (device clock at fix time) and `received_at` (server clock).
  The two diverge after an offline flush; keeping both is what makes a replayed trail
  honest.
- **`driver_presence`** — one upserted row per driver, so the dispatch map's live query
  is N rows rather than a `MAX()` over a growing table.

### 6.2 Client

A `DriverTracker` that **subscribes to the existing `useMyPosition()`**
(`components/MyPositionProvider.tsx`) rather than opening a second `watchPosition` — that
provider's own comment is explicit that a second watch means a second wake-up of the same
GPS chip on a phone that spends the day in a van.

- Active only when `role === 'driver'` and a run is `in_progress`.
- Throttle: send when moved > 50 m or > 30 s elapsed; batch ~10 fixes per POST.
- Queue in IndexedDB when offline; flush on reconnect.
- Hold `navigator.wakeLock` while a run is active, and show a persistent
  «در حال ارسال موقعیت» bar. Tracking is never covert.

It gaps when the phone locks. The manager map says «آخرین موقعیت: ۴ دقیقه پیش» rather
than showing a stale dot as though it were live. That is the trade for staying a PWA.

### 6.3 Server and manager view

`POST /api/tracking/ping` (driver only, rate-limited via `lib/rateLimit.ts`),
`GET /api/tracking/live` (group-scoped presence), `GET /api/tracking/trail?driver_id&date`
(breadcrumb replay).

`/dispatch` shows the group's drivers as live markers with a heading arrow, coloured by
run progress, reusing the Leaflet setup in `components/CoverageMap.tsx` and the radar-ping
marker idiom from `MASTER.md`. The manager polls every 5–10 s; that is live enough and
needs no new transport.

### 6.4 Consent

First login as a driver shows a blocking Persian modal stating what is collected, when
(only during an active run), who can see it, and how long it is kept. Accepting writes
`users.location_consent_at`. Declining blocks tracking but **not** the delivery list. The
admin user list shows who has and has not consented.

### 6.5 Retention

Prune `driver_pings` to 30 days from a script in the style of `scripts/backup.mjs`.
Stop-completion coordinates live on `delivery_stops` permanently, so the audit trail
survives the prune. At 4 drivers × 10 h × 1 ping/30 s that is ~5k rows/day — trivial for
SQLite, and still fine an order of magnitude up.

No CSP change is needed; every new endpoint is `'self'` (`next.config.ts`).

---

## 7. Risks

1. **Cross-group leakage is the main danger.** ~25 existing routes plus several server
   components return unscoped data today. Missing one is a silent breach, not a visible
   bug.
2. **The workbook write-back can destroy the accounting file.** §4.1–4.3 exist for this
   reason. The fidelity test in §4.3 is a gate, not a nicety.
3. **Driver commission cannot be paid correctly yet**, for two independent reasons:
   `فروش` Q/R/S/U do not exist (§1.2), and per-kilogram pay is not computable for
   piece-counted products (§1.5). Both must be fixed before any pay figure the app
   produces means anything.
4. **Background GPS in a browser is unreliable.** The wake-lock approach is the best a
   PWA can do. If gaps prove unacceptable, the server side and the dispatch map are
   unchanged by a later Capacitor wrapper — only the client collector is replaced.
5. **Per-group Excel files can collide** on `کد مشتری` in the global upsert.
6. **The database becomes materially more valuable** — the only record of what a driver
   did and where. Confirm `scripts/backup.mjs` is on a cron before Phase 2 ships.

## 8. Verification

Per phase, before moving on:

- `npm test`. The new `lib/session.ts` scoping helpers, the auto-split territory
  resolution, the stop state machine, the base-unit conversion (§5.1) and the workbook
  pre-flight checks (§4.2) each need their own suite. Follow `tests/api/login.test.ts`
  and `tests/auth.test.ts` for route-level tests.
- **A scoping test per route** — assert a `group_manager` from group B cannot read or
  write group A's rows, and a `driver` gets 403 on everything except their own run.
- **Migration against a copy of the real DB** — `cp data/coverage.db /tmp/` and boot with
  `COVERAGE_DB_PATH=/tmp/coverage.db` before touching production data.
- **Workbook fidelity test (§4.3)** against a copy, opened in Excel, before any write to
  the real file.
- **Manual end-to-end on a phone**: create a group, assign districts, upload that group's
  sheet, accept the proposed split, publish, log in as the driver on a real handset,
  accept the consent modal, load the van, start the run, watch the dot move on
  `/dispatch`, record a فروش فوری, mark a stop delivered in airplane mode, restore
  signal, and confirm the queued write and pings both land with correct `recorded_at`.
- Deploy per the standing rule for this app: `npm run build` then
  `systemctl restart coverage-map` — source edits alone do not take effect.

## 9. Sequencing

Phase 0 → 1a → 1b → 1c → 2. Phase 0 blocks everything. §3 (1a) and §4 (1b) are
independently useful and can ship before §5 (1c) if needed.
