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
| Workbook write-back | The app never writes the workbook. It emits a three-column paste-in block (§4). Direct writing was chosen first, then abandoned on measured evidence — see §4.1. |
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

Read from the **live** workbook. It has 21 columns (A–U):

| Col | Header | Kind |
|---|---|---|
| A | تاریخ | input |
| B | شماره سفارش | input |
| C | مشتری | input |
| D | کالا و بسته‌بندی | input (dropdown from the packaging table) |
| E | تعداد بسته | input |
| F | مقدار کسر شده | formula — `E × qty-per-pack`, in base units; draws down stock |
| G | قیمت فروش هر بسته | input |
| H | جمع فروش | formula |
| I | بهای تمام‌شده | formula |
| J | سود | formula |
| K | وضعیت پرداخت | input |
| L | **وضعیت ارسال** | **input — the app writes this** |
| M | کالا (خودکار) | formula |
| N | واحد (خودکار) | formula |
| O | وزن به کیلوگرم (خودکار) | formula — `F × کالاها!I` |
| P | **فروش فوری** | **input — the app writes this ("بله" or blank)** |
| Q | فروشنده این سفارش (خودکار) | formula |
| R | پورسانت فروشنده | formula |
| S | پورسانت راننده | formula |
| T | **راننده تحویل‌دهنده** | **input — the app writes this** |
| U | راننده مؤثر (خودکار) | formula |

### 1.3 The workbook already computes all commission

This is the most important finding for Phase 1, and it makes the write-back far smaller
and safer than first assumed.

- `O` = `F × INDEX(کالاها!$I$3:$I$6, MATCH(M, کالاها!$A$3:$A$6, 0))` — kilograms, derived
  from base-unit quantity times **`کالاها` column I, «کیلوگرم هر واحد پایه (برای محاسبه
  پورسانت)»** (0.01 kg per عدد for `NMA-VEG`). The weight data exists.
- `Q` = the customer's salesperson from `مخاطبین!L`, **unless `P = "بله"`**, in which case
  it is blank — an instant sale pays no salesperson.
- `R` = `همکاران!D` (salesperson rate) `× O`.
- `S` = `IF(P = "بله", همکاران!E, همکاران!D) × O`, keyed on `U` — the driver's normal or
  فروش فوری rate times kilograms.
- `U` = `IF(ISBLANK(T), همکاران!$C$6, T)` — the effective driver, **defaulting to
  `همکاران` C6 (یوسف / DRV1) whenever `T` is blank.**

**Consequence: the app must never compute or write a commission figure.** It writes three
input cells — `L`, `P`, `T` — and the workbook does every piece of money maths itself.
Writing to `O`, `Q`, `R`, `S` or `U` would destroy a formula.

**Consequence: `T` must always be written once there is more than one driver.** Today a
blank `T` silently attributes the delivery to یوسف. With ten drivers that default becomes
a payroll error, not a convenience.

### 1.4 `ارسال امروز` — the delivery list

A filtered view of `فروش` where `L <> "تحویل‌شده"` — note it is *all* outstanding orders,
not only today's. «مبلغ قابل دریافت» is `IF(K = "پرداخت‌شده", 0, H)`, so the COD figure is
already correct: prepaid orders show zero to collect. The driver app can show this column
verbatim.

### 1.5 `کالاها` and `موجودی انبار` — stock

Four products (`NMA-VEG`, `NMA-ANM`, `MRH-VEG`, `MRH-VEG-BULK`), each with a base unit
(عدد or کیلوگرم), a kg-per-base-unit factor (column I), and a packaging table at rows
9–13 mapping a packaging label to product id, unit and quantity-per-pack (120 عدد per
جعبه بچه, 10 کیلوگرم per بلوک عمده).

`موجودی انبار` is fully derived: `کل ورودی` = `SUMIF(خرید)`, `کل خروجی` =
`SUMIF(فروش!F keyed on فروش!M)`, current stock = in − out, plus a reorder suggestion.

**Consequence — the key insight for van stock:** the workbook tracks stock at *business*
level with no location dimension. A sale draws down the single pool the moment it is
recorded, whether the goods left a warehouse or a van. So the app must not try to own the
total; it owns only the *split* — where inside the business the stock currently sits. Van
stock is a **sub-ledger between "left the warehouse" and "sold to a customer"**, and it
never contradicts the workbook's total. §5 builds on this.

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

## 4. Phase 1b — Getting delivery results into the workbook

The app records what was delivered and by whom. `پورسانت` pays drivers off `فروش`. Those
two facts have to meet. This section is how — and, first, how *not*.

### 4.1 Why the app does not write the workbook

The original decision was for the app to write the `.xlsx` directly. That was tested and
abandoned. Two independent findings killed it:

**The cell-level Excel API does not support this account.** Microsoft Graph can patch
individual ranges — `PATCH /me/drive/items/{id}/workbook/worksheets('فروش')/range(address='L3')`
— which would have been ideal: Excel's own engine applies the edit, nothing else is
touched. But the workbook sits on **consumer** OneDrive (`onedrive.live.com/personal/…`),
and the Graph docs are explicit: *"Support for workbooks stored in OneDrive Consumer
platform is still not available."* The call returns `FileOpenUserUnauthorized`. Only
OneDrive for Business and SharePoint are supported.

That leaves whole-file download-and-replace as the only automated path — and:

**exceljs cannot round-trip this workbook.** Measured against the live file on
2026-08-25, reading it and writing it back out with a single cell changed:

| Part | Live | After round-trip |
|---|---|---|
| charts | 3 | **0 — destroyed** |
| drawings | 2 | **0 — destroyed** |
| dataValidation | 6 | **12 — mangled** |
| conditionalFormatting | 9 | 9 — survived |
| worksheets | 13 | 13 — survived |

`داشبورد` is blanked and the `فروش` column-D dropdown is corrupted. This is not a risk to
mitigate; it is a measured failure. **No automated write path to this workbook is safe,
and none should be built** until the workbook moves to a Microsoft 365 Business account,
at which point §4.1's first paragraph becomes available and this section can be revisited.

### 4.2 What replaces it: a paste-in block

The app owns delivery status and driver attribution. Excel keeps owning money. The
handover is three columns of plain text.

1. The app reads the live workbook (`lib/oneDriveFetch.ts`, §10) and maps each
   `شماره سفارش` to its `فروش` row number.
2. It emits three single-column blocks covering rows 3–302 — `L` (وضعیت ارسال),
   `P` (فروش فوری), `T` (راننده تحویل‌دهنده) — each carrying the value already in the
   workbook, with the run's results merged in.
3. The owner pastes three times in Excel Online: at `L3`, `P3`, `T3`.
4. `O`, `Q`, `R`, `S` and `U` recalculate on their own. Commission is correct, charts,
   dropdowns and conditional formatting are never touched.

**Full columns rather than only the changed rows**, because scattered single-cell pastes
are error-prone and slow. Emitting the existing value for unchanged rows is safe here and
*only* here: `L`, `P` and `T` are the three input columns of `فروش` with no formulas in
them (§1.2). Nothing else in the workbook may be emitted this way.

**Read-before-emit is mandatory.** The block is only valid against the workbook revision
it was generated from. Record the source SHA-256 on the export and show it on screen; if
the workbook has changed since, regenerate rather than paste a stale block. Row alignment
is the whole correctness argument, and a row inserted in `فروش` invalidates it.

### 4.3 UI

A «خروجی برای اکسل» panel on the dispatch page: pick a date, see the three blocks with a
copy button each, plus a plain-language summary — "۱۴ تحویل، ۲ ناموفق، ۳ فروش فوری" — and
a warning banner if the workbook changed since the block was generated.

Failed stops are excluded entirely, so the order stays on `ارسال امروز` for the next run.

`T` is emitted for **every** delivered stop, never left blank: a blank `T` attributes the
delivery to یوسف (§1.3), which is a payroll error once a second driver exists.

---

## 5. Phase 1c — Van stock and فروش فوری

Built on §1.5: the app owns the *split*, never the total.

### 5.1 Schema

- **`products`** — mirrored from `کالاها` on import: `product_code` (`NMA-VEG` …),
  `name`, `base_unit`, `category`, `kg_per_base_unit` (column I). Plus a `packagings`
  table from `کالاها` rows 10–13: `product_code`, `label`, `qty_per_pack`, so a packaging
  label converts to base units exactly as `فروش!F` does, and to kilograms exactly as
  `فروش!O` does. Mirrored, never authored here — `کالاها` stays the source of truth.
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
5. **Export**: an instant sale has no existing `فروش` row, so unlike §4.2 it cannot be a
   column paste. The app emits it as a **new-row block** — a full A–L row in `فروش`
   column order, with `P` = `بله` and `T` = the driver — to be pasted at the first empty
   row. The formula columns (`F`, `H`, `I`, `J`, `M`, `N`, `O`, `Q`, `R`, `S`, `U`) are
   left out of the block and must be filled down by dragging, exactly as when adding a
   sale by hand. Document that step in the UI; it is the one place the operator has to do
   something more than paste.

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
2. **Nothing may write the workbook automatically** (§4.1 — measured). If a future change
   proposes it, re-run the round-trip test first; the answer is currently "it destroys
   `داشبورد`".
3. **Row alignment is the correctness argument for the paste-in block.** A row inserted
   into `فروش` between generating and pasting silently writes every value one row off.
   The SHA-256 check in §4.2 is what prevents it and is not optional.
4. **A blank `راننده تحویل‌دهنده` silently pays یوسف.** `U` defaults to `همکاران` C6
   whenever `T` is blank (§1.3). Every delivered stop must write `T`, or one driver is
   credited with everyone's work.
5. **Background GPS in a browser is unreliable.** The wake-lock approach is the best a
   PWA can do. If gaps prove unacceptable, the server side and the dispatch map are
   unchanged by a later Capacitor wrapper — only the client collector is replaced.
6. **Per-group Excel files can collide** on `کد مشتری` in the global upsert.
7. **The database becomes materially more valuable** — the only record of what a driver
   did and where. Confirm `scripts/backup.mjs` is on a cron before Phase 2 ships.

## 8. Verification

Per phase, before moving on:

- `npm test`. The new `lib/session.ts` scoping helpers, the auto-split territory
  resolution, the stop state machine, the base-unit conversion (§5.1) and the workbook
  pre-flight checks (§4.2) each need their own suite. Follow `tests/api/login.test.ts`
  and `tests/auth.test.ts` for route-level tests.
- **A scoping test per route** — assert a `group_manager` from group B cannot read or
  write group A's rows, and a `driver` gets 403 on everything except their own run.
- **Migration against a copy of the real DB** — `cp data/routeflow.db /tmp/` and boot with
  `ROUTEFLOW_DB_PATH=/tmp/routeflow.db` before touching production data.
- **Paste-in block alignment**: generate a block, paste it into a *copy* of the live
  workbook, and confirm every `شماره سفارش` still lines up with its own `L`/`P`/`T` value.
  Then confirm `O`/`R`/`S` recomputed to the expected figures and `U` resolved to the
  driver from `T` rather than the یوسف default (§1.3).
- **Staleness guard**: regenerate a block, edit the workbook, and confirm the app refuses
  to present the stale block rather than letting it be pasted.
- **Manual end-to-end on a phone**: create a group, assign districts, upload that group's
  sheet, accept the proposed split, publish, log in as the driver on a real handset,
  accept the consent modal, load the van, start the run, watch the dot move on
  `/dispatch`, record a فروش فوری, mark a stop delivered in airplane mode, restore
  signal, and confirm the queued write and pings both land with correct `recorded_at`.
- Deploy per the standing rule for this app: `npm run build` then
  `systemctl restart routeflow` — source edits alone do not take effect.

## 9. Sequencing

Phase 0 → 1a → 1b → 1c → 2. Phase 0 blocks everything. §3 (1a) and §4 (1b) are
independently useful and can ship before §5 (1c) if needed.

---

## 10. Where the workbook lives

**The canonical `سیستم فروش و انبار.xlsx` is on OneDrive, not on this machine.** Any local
copy is a stale snapshot and must not be trusted — the copy found under `/root/` during
design was missing columns O through U entirely, which inverted several conclusions in
this document before it was checked against the live file.

The share link is configured server-side as **`ONEDRIVE_SALES_FILE_URL`** in `.env.local`
(gitignored, like every other secret in this project). It is read by
`app/api/import/onedrive/route.ts`, which deliberately takes it from server config rather
than the request body so the endpoint cannot be turned into an SSRF vector, and fetched by
`lib/oneDriveFetch.ts`.

The link is an "anyone with the link" share — it is a credential for the whole customer,
sales and debt dataset, which is why it lives in `.env.local` rather than in source. To
read the live workbook from a script:

```bash
set -a && . ./.env.local && set +a
node --experimental-strip-types your-script.ts   # import { fetchOneDriveFile } from "./lib/oneDriveFetch.ts"
```

If the link is ever rotated, `ONEDRIVE_SALES_FILE_URL` is the only place that needs
changing.
