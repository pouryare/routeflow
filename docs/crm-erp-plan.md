# RouteFlow — CRM+ERP Development Plan (v2)

**Revised:** 2026-09-01 · **Codebase:** `/root/pourya/coverage-map` → `github.com/pouryare/routeflow`
**Companion:** [`crm-erp-source-extract.md`](./crm-erp-source-extract.md)

> **v2 supersedes v1.** v1 was written believing this was a ~45-order-per-day business.
> The real figure is **200+ orders/day per group across at least two groups, growing fast,
> with the app being sold to other companies.** That is a different system. Every YAGNI
> call in v1 has been re-decided against the real number, and most are reversed.

---

## Part 0 — Decisions locked

| # | Decision | Status |
|---|---|---|
| 1 | Multi-tenancy: **one database, `organization_id`** | ✅ locked |
| 2 | **`platform_owner`** role with full cross-org access — RouteFlow is sold as a product; you support every tenant | ✅ locked |
| 3 | Credit: **warn + record override, and require manager approval to proceed** | ✅ locked |
| 4 | Product name: **RouteFlow** | ✅ **done** — see Part 1 |
| 5 | Weather drives **stops-per-driver**, all adverse conditions, not only heat | ✅ locked — designed in §4.1 |
| 6 | Representatives get **their own role and their own tab** | ✅ locked |
| 7 | **12-state order machine** | ✅ locked (reversed from v1) |
| 8 | **Route optimisation / VRP** | ✅ locked (reversed from v1) |
| 9 | **Batch / lot traceability** | ✅ locked (reversed from v1) |
| 10 | `Delivery` as an entity distinct from `delivery_stops` | ✅ locked (reversed from v1) |
| 11 | Remove `APP_PASSWORD` | ✅ **done** |
| 12 | **Stay on SQLite**; Postgres is a later migration | ✅ locked — repository layer is the condition, see Part 2 |
| 13 | **Offline-first**: optimistic UI, local write, background sync | ✅ locked — designed in §4.5 |
| 14 | Undo bar on notifications, shrinking, with undo | ✅ locked — designed in §4.6 |

---

## Part 1 — Already executed

**Renamed to RouteFlow.** GitHub repo is now `pouryare/routeflow`; the old URL redirects
indefinitely, and `origin` points at the new one. Changed: login header, PWA manifest name
and description, README title, `MASTER.md` title, Excel export creator, two outbound
User-Agents, `package.json`.

**Deliberately not renamed** — and the README now says why, so the next reader does not
assume it was missed:

| Thing | Left alone because |
|---|---|
| systemd unit `coverage-map` | Live service. Renaming is a maintenance-window job. |
| Directory `/root/pourya/coverage-map` | Breaks the unit's WorkingDirectory, the auto-commit hook path, and a hardcoded path in `scripts/build-traffic-zones.mjs`. |
| `COVERAGE_DB_PATH`, `data/coverage.db` | The env var and eleven backup files. A filename is not a brand. |
| `docs/superpowers/plans/*` | Historical records of work done. Rewriting history to match a new name makes the record a lie. |

**`APP_PASSWORD` removed** from `.env.local` and from the dead assignment at the top of
eleven test files. Two explanatory comments remain in `app/api/login/route.ts` and
`tests/api/login.test.ts` — those document *why* it is gone and are worth keeping.

**Verification:** `npx tsc --noEmit` clean; `npm test` → **79 files, 1061 tests, all passing**.
Committed as `8296c07` and pushed.

---

## Part 2 — Storage: SQLite now, offline-first client, Postgres later

**Decided: stay on SQLite. Build offline-first instead. Postgres is a later migration.**

That is a coherent choice, and for a field app it is arguably the better order — but it
only works if two things are true, so they are requirements, not suggestions:

1. **A repository layer goes in during Phase 0.** Every query moves behind `lib/repo/*.ts`.
   Without it, the later Postgres cut is a rewrite of ~55 API routes; with it, it is a
   driver swap. This is the same "cheap now, expensive later" logic that decided tenancy,
   and it costs about two days now.
2. **No unbounded query runs in a request.** `DatabaseSync` is synchronous — one slow scan
   freezes every concurrent request on the server. Analytics reads precomputed snapshot
   tables written by a background job; raw `orders` is never scanned to render a page.

With those two in place, SQLite comfortably carries 400+ orders/day, and the day it stops
being right, the migration is contained.

### Why offline-first genuinely changes the storage picture

Offline-first moves read load off the server entirely: a driver's whole run is on the
device, so the 200 reads that route would have served become zero. It also converts writes
from *interactive* (a user waiting on a lock) to *batched* (a queue draining in the
background), which is exactly the shape SQLite's single-writer model handles best. The
choice to go offline-first before Postgres is defensible on its own terms, not merely a
deferral.

## Part 3 — Data model

### M1 — Tenancy

```sql
CREATE TABLE organizations (
  id, name, slug UNIQUE, plan, active, created_at,
  contact_name, contact_phone, subscription_status, trial_ends_at
);
```

`organization_id` added to every business table: `groups, users, customers, districts,
facilities, orders, order_lines, products, packagings, product_prices, purchases,
purchase_lines, delivery_runs, delivery_stops, lead_lists, saved_locations, reminders,
visit_plans, photos, activity_log, commission_rates, commission_payments,
driver_commission_*, manager_commission_*`.

Existing rows backfill to org 1.

**Roles** become:

```ts
type Role =
  | "platform_owner"   // you. Every org. Support, billing, cross-tenant analytics.
  | "owner"            // a tenant's owner. Their org only.
  | "group_manager"
  | "rep_manager"      // new — see §3.4
  | "salesperson"
  | "driver";
```

`platform_owner` is a genuine cross-tenant superuser: you are the vendor, you support these
companies, and you cannot support what you cannot see. Two engineering requirements that
come with it, not as ceremony but because they are what makes the access defensible:

- **Every cross-org read is written to `platform_access_log`** (who, which org, which
  entity, when). Support access that leaves a trace is a different thing from support
  access that does not, and if a tenant ever asks, the answer is a query.
- **A one-line clause in whatever they sign** saying the vendor has administrative access
  for support and may use aggregate statistics to improve the product. Standard for every
  SaaS they already use; it costs nothing to say and is awkward to discover later.

`lib/tenant.ts` exposes the only sanctioned data entry point:

```ts
scoped(session).customers.all()        // WHERE organization_id = ? always applied
platform(session).acrossOrgs(...)      // platform_owner only; logs; aggregates by default
```

A test fails the build if `db.prepare` / `sql` appears outside `lib/repo/`.

### M2 — Customers, representatives, credit

```sql
ALTER TABLE customers ADD customer_type TEXT
  CHECK (customer_type IN ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER'));
ALTER TABLE customers ADD lifecycle TEXT NOT NULL DEFAULT 'lead'
  CHECK (lifecycle IN ('lead','qualified','sampled','active','dormant','lost','blocked'));
ALTER TABLE customers ADD parent_customer_id INTEGER REFERENCES customers(id);
ALTER TABLE customers ADD payment_terms_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD hard_credit_block INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD qualified_at TEXT, first_order_at TEXT;

-- A representative IS a wholesale customer, plus a managed relationship.
CREATE TABLE representative_profiles (
  id, organization_id, customer_id UNIQUE REFERENCES customers(id),
  rep_code UNIQUE, manager_user_id REFERENCES users(id),
  contract_signed_at, contract_expires_at, exclusivity_territory_id REFERENCES districts(id),
  stage TEXT CHECK (stage IN
    ('prospect','qualified','negotiating','documents','approved','onboarding','active','dormant','terminated')),
  activated_at, first_order_at, credit_terms_days, discount_tier,
  monthly_target_kg, monthly_target_toman,
  health_score REAL, health_computed_at, notes, created_at, updated_at
);

CREATE TABLE representative_onboarding_steps (
  id, representative_id REFERENCES representative_profiles(id),
  step_code, label_fa, required INTEGER, completed_at, completed_by, notes
);
```

One `Order` table serves both direct customers and reps — same pipeline, same stock, same
delivery. What differs is the price list, the credit terms, and who manages the
relationship. That keeps reporting unified while giving reps the dedicated surface you asked
for.

**Credit approval workflow** (your decision 3):

```sql
CREATE TABLE credit_approvals (
  id, organization_id, order_id REFERENCES orders(id),
  requested_by REFERENCES users(id), requested_at,
  customer_balance_toman, credit_limit_toman, overage_toman,
  status TEXT CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by REFERENCES users(id), decided_at, reason
);
```

Flow: salesperson records an order that breaches the limit → order enters
`PENDING_CREDIT` → a `CRITICAL` task lands on the group manager → approve moves it to
`CONFIRMED`, reject to `ON_HOLD`. `orders.credit_override_by` stays as the historical
record of the pre-approval era.

### M3 — Payments

As v1: `payments` (method `CASH|POS|CARD_TO_CARD|CHEQUE|CREDIT_NOTE|OTHER`),
`payment_allocations` (one payment settles many orders, or sits on account), `cheques`
(built now, no UI in v1). `orders.paid_toman` becomes a derived cache; the three
`customers.debt_*` columns become derived from unpaid, aged order totals instead of being
imported from Excel.

### M4 — Stock, warehouses, batches

```sql
CREATE TABLE batches (
  id, organization_id, product_id REFERENCES products(id),
  batch_code, supplier_batch_ref, purchase_line_id REFERENCES purchase_lines(id),
  produced_at, expiry_date, qty_received_base REAL, unit_cost_toman,
  status TEXT CHECK (status IN ('active','quarantined','recalled','expired','depleted')),
  notes, created_at,
  UNIQUE (organization_id, product_id, batch_code)
);

CREATE TABLE stock_movements (
  id, organization_id, facility_id REFERENCES facilities(id),
  product_id, batch_id REFERENCES batches(id),
  base_qty REAL NOT NULL,            -- signed
  kind TEXT CHECK (kind IN ('PURCHASE_IN','TRANSFER_OUT','TRANSFER_IN','DELIVERY_OUT',
                            'SAMPLE_OUT','RETURN_IN','ADJUSTMENT','COUNT','WRITE_OFF')),
  ref_type, ref_id, occurred_at, created_by, notes, created_at
);
CREATE INDEX ix_stock ON stock_movements (organization_id, facility_id, product_id, batch_id, occurred_at);

CREATE TABLE delivery_line_batches (   -- which batch actually went to which customer
  id, delivery_id REFERENCES deliveries(id), order_line_id REFERENCES order_lines(id),
  batch_id REFERENCES batches(id), base_qty REAL
);

CREATE TABLE quality_complaints (
  id, organization_id, customer_id, order_id, batch_id, product_id,
  reported_at, reported_by, category, severity, description, resolution, resolved_at
);
```

**Traceability, both directions:**

- **Forward** — batch → deliveries → customers → representatives. *"Batch 1405-0612 is
  suspect. Who has it?"* One query, answered in seconds instead of a phone-call afternoon.
- **Backward** — complaint → order → batch → purchase → supplier lot. *"Three complaints
  this week. Same batch?"*

**FEFO picking.** For dairy fat, First-Expired-First-Out is the correct default, not FIFO.
Allocation at confirm time picks the earliest `expiry_date` with sufficient available
quantity. Expiry alerts fire at a configurable shelf-life fraction (`products.shelf_life`
already exists).

Your house is a `facilities` row with `kind='home_base'`; loading its route is
`TRANSFER_OUT` from the warehouse and `TRANSFER_IN` at home, batch-tracked throughout.

### M5 — The 12-state order machine

```
                    DRAFT
                      │ submit
                      ▼
              PENDING_REVIEW ──────────┐ credit breach
                      │ pass           ▼
                      │          PENDING_CREDIT
                      │ approve   │        │ reject
                      ▼           ▼        ▼
                  CONFIRMED ◄─────┘     ON_HOLD
                      │ plan                │ release
                      ▼                     │
                   PLANNED ◄────────────────┘
                      │ freeze
                      ▼
                    READY
                      │ driver starts
                      ▼
             OUT_FOR_DELIVERY
              │        │        │
     delivered│  partial│   failed│
              ▼        ▼        ▼
        DELIVERED  PARTIALLY_  DELIVERY_FAILED
              │    DELIVERED        │ retry
              │        │            └──► PLANNED
              │        │ backorder → new order
              ▼        ▼
             CLOSED ◄──┘        CANCELLED   RETURNED
```

Twelve states: `DRAFT, PENDING_REVIEW, PENDING_CREDIT, ON_HOLD, CONFIRMED, PLANNED, READY,
OUT_FOR_DELIVERY, DELIVERED, PARTIALLY_DELIVERED, DELIVERY_FAILED, CLOSED`, plus terminal
`CANCELLED` and `RETURNED`.

Implemented as an explicit table, not scattered `if`s:

```ts
// lib/orderStateMachine.ts — one source of truth for what may happen next
const TRANSITIONS: Transition[] = [
  { from: "DRAFT", action: "submit", to: "PENDING_REVIEW", roles: ["salesperson","group_manager","owner"],
    guard: "orderComplete", effects: ["runValidation"] },
  { from: "PENDING_REVIEW", action: "approve", to: "CONFIRMED", roles: ["group_manager","owner"],
    guard: "allChecksPass", effects: ["reserveStock","allocateBatchesFEFO"] },
  { from: "PENDING_REVIEW", action: "flagCredit", to: "PENDING_CREDIT", roles: ["system"],
    guard: "overCreditLimit", effects: ["createCreditApprovalTask"] },
  // ... one row per legal transition
];
```

Everything derives from this table: which API endpoints exist, which buttons a role sees,
which automations fire, and the audit trail. An illegal transition is a 409 with the legal
options listed, not a silent no-op.

`order_type`: `SALE | SAMPLE | REPLACEMENT | RETURN`.
`priority`: `URGENT | KEY_ACCOUNT | NORMAL | FLEXIBLE`.

### M6 — Delivery as its own entity

```sql
CREATE TABLE deliveries (
  id, organization_id, order_id REFERENCES orders(id),
  seq INTEGER,                          -- 1st, 2nd… attempt/split for this order
  status TEXT CHECK (status IN ('PLANNED','ASSIGNED','LOADED','IN_TRANSIT',
                                'DELIVERED','PARTIAL','FAILED','RETURNED','CANCELLED')),
  route_stop_id REFERENCES delivery_stops(id),
  planned_date, planned_arrival, actual_arrival, completed_at,
  fail_reason_id REFERENCES reason_codes(id), delay_reason_id REFERENCES reason_codes(id),
  receiver_name, signature_path, photo_path, gps_lat, gps_lng,
  collected_toman INTEGER, payment_id REFERENCES payments(id),
  notes, created_at
);
CREATE TABLE delivery_lines (
  id, delivery_id, order_line_id, qty_planned REAL, qty_delivered REAL, qty_returned REAL
);
```

Chain: `Order → Delivery → RouteStop → RouteInstance(delivery_runs) → Driver`.
`delivery_runs` and `delivery_stops` keep their names; `deliveries` slots between the order
and the stop. One stop may carry several deliveries (two orders, same customer, one visit).

**Server-side timestamps.** `actual_arrival` and `completed_at` are set by the server on
receipt, never trusted from the device clock. The device's own time is kept in
`metadata.device_time` so a divergence is visible rather than silently authoritative.

### M7 — Routing, capacity, weather

```sql
CREATE TABLE vehicles (
  id, organization_id, plate, name, driver_default_id,
  max_weight_kg REAL, max_volume_m3 REAL, max_stops INTEGER,
  has_refrigeration INTEGER NOT NULL DEFAULT 0,
  cost_per_km_toman INTEGER, active
);

ALTER TABLE delivery_runs ADD vehicle_id REFERENCES vehicles(id);
ALTER TABLE delivery_runs ADD planned_distance_km REAL, actual_distance_km REAL;
ALTER TABLE delivery_runs ADD planned_duration_min INTEGER, actual_duration_min INTEGER;
ALTER TABLE delivery_runs ADD capacity_stops INTEGER;      -- after weather adjustment
ALTER TABLE delivery_runs ADD weather_json TEXT;           -- forecast frozen at planning
ALTER TABLE delivery_runs ADD optimisation_json TEXT;      -- VROOM request/response

CREATE TABLE route_templates (
  id, organization_id, code, name, territory_id REFERENCES districts(id),
  default_driver_id, default_vehicle_id,
  max_stops, max_weight_kg, max_volume_m3, max_duration_min,
  service_time_min INTEGER DEFAULT 8, active
);
CREATE TABLE route_schedules (
  id, route_template_id, day_of_week INTEGER,   -- 0 = شنبه
  start_time, end_time, cutoff_time, active
);

CREATE TABLE weather_snapshots (
  id, lat_r REAL, lng_r REAL, forecast_date TEXT,
  temp_min, temp_max, precip_prob INTEGER, precip_mm REAL, snow_mm REAL,
  wind_kmh REAL, gust_kmh REAL, visibility_m INTEGER, weather_code INTEGER,
  fetched_at, raw_json,
  UNIQUE (lat_r, lng_r, forecast_date)
);

CREATE TABLE capacity_factors (      -- tunable, and later learned from actuals
  id, organization_id, condition_code TEXT UNIQUE,
  stop_factor REAL, service_time_factor REAL, speed_factor REAL,
  max_duration_factor REAL, note_fa TEXT, active
);
```

### M8 — Event / Task / Alert / Rule spine, targets, academy

As v1 (`events`, `tasks`, `alerts`, `rule_runs`, `targets`, `lesson_progress`), with
`organization_id` throughout and `events.metadata` as `JSONB` under Postgres. At this
volume `events` is partitioned by month.

---

## Part 4 — Features, designed

### 4.1 Weather → stops per driver

You asked for all adverse weather, and for it to change **how many stops a driver gets**.
That is the right framing, and it turns weather from a decoration into an input.

**Provider: Open-Meteo.** No API key, no account, no sanctions exposure — the same reason
this project chose OpenStreetMap. 16-day forecast, hourly, plus a historical archive
(needed for the learning loop below). Optional second layer: **RainViewer** free radar
tiles, also keyless.

**Six conditions, each with a measured effect on capacity:**

| Condition | Trigger | Stops | Service time | Speed | Note |
|---|---|---|---|---|---|
| Heavy rain | `precip_mm > 7` or `prob > 70%` | ×0.80 | ×1.20 | ×0.85 | Parking, wet handover, slower streets |
| Snow / ice | `snow_mm > 0` or `temp_min < 0` with precip | ×0.55 | ×1.30 | ×0.60 | Tehran's north especially |
| Extreme heat | `temp_max > 35°C` | ×0.85 | ×1.15 | ×1.00 | **Also caps route duration** — see below |
| High wind | `gust > 55 km/h` | ×0.85 | ×1.10 | ×0.90 | Two-wheeler legs unsafe |
| Dust storm | `weather_code` dust/sand | ×0.70 | ×1.10 | ×0.70 | Visibility |
| Fog | `visibility < 1000 m` | ×0.80 | ×1.05 | ×0.75 | |

Factors compose multiplicatively, floored so a bad day reduces rather than cancels:

```
effective_max_stops    = floor(base_stops × Π stop_factor)          , min 40% of base
effective_service_time = base_service × Π service_factor
effective_max_duration = base_duration × Π duration_factor
```

**The cold-chain constraint is a hard one, not a preference.** Above 30 °C, unrefrigerated
product has a maximum time in the van before quality is at risk. So heat does not merely
reduce stops — it caps `max_duration_min`, which is a different and stricter thing. A
vehicle with `has_refrigeration = 1` is exempt, which also gives you a number for what a
refrigerated van would be worth.

**Where it appears**

1. **`/planner`** — a weather band above the schedule. Per day, per territory: icon,
   high/low, precipitation, and the resulting capacity. Explicit, never silent:
   «چهارشنبه ۳۶ درجه — ظرفیت مسیر شرق از ۳۰ به ۲۵ توقف کاهش یافت. ۵ سفارش نیاز به
   جابه‌جایی دارند.»
2. **Map overlay** — toggle beside the existing basemap picker; districts tinted by risk,
   reusing `--good/--warn/--crit` from `MASTER.md` so no new colour work is needed.
   RainViewer radar as an optional animated layer.
3. **`/driver`** — one line at the top of the run: conditions, and a cold-chain note if the
   threshold is crossed.
4. **`delivery_runs.weather_json`** — the forecast **frozen at planning time**, not looked
   up afterwards.

**The learning loop.** The table above starts as honest guesses. Because the forecast is
frozen at planning time and actuals are recorded (`actual_duration_min`,
`actual_distance_km`, failures with reason codes), after one summer and one winter you can
regress actual service time and failure rate against recorded conditions and **replace the
constants with your own numbers, for your own city**. `capacity_factors` is a table rather
than a constant file precisely so that can happen without a deploy. This is the one place
in the plan where prediction is genuinely earned rather than decorative.

### 4.2 Route optimisation

At 200+ orders/day per group, hand-sorting stops is neither feasible nor close to optimal.
This is a **Capacitated Vehicle Routing Problem with Time Windows** — not a simple TSP,
because you have several drivers, vehicle weight/volume limits, customer time windows,
and now weather-adjusted capacity.

**Stack: OSRM + VROOM, both self-hosted, both open source, no API keys.**

```
          orders for a day + territory
                      │
                      ▼
   ┌────────────────────────────────────────┐
   │  planner builds a VROOM job:           │
   │   jobs      = deliveries (kg, m³, TW)  │
   │   vehicles  = driver+vehicle pairs,    │
   │               capacity ADJUSTED FOR    │
   │               WEATHER (§4.1)           │
   │   matrix    = OSRM /table              │
   └────────────────────────────────────────┘
                      │
                      ▼   VROOM solves
        assignment + stop order + ETAs
                      │
                      ▼
     planner reviews on the map → accept / drag → freeze
```

- **OSRM** already has a foothold — `lib/osrm.ts` exists and `leaflet-routing-machine` is
  installed. It supplies the duration/distance matrix over a Tehran OSM extract.
- **VROOM** sits on top of OSRM and solves the assignment. It natively handles capacity
  (multi-dimensional: kg *and* m³ *and* stop count), time windows, skills (a refrigerated
  vehicle as a required skill for heat days), priorities, and multiple depots — which is
  what your future multiple Tehran warehouses will need.
- Both run in Docker on the same box. No per-request cost, no key, no sanctions surface.

**Important product rule: the optimiser proposes, the planner disposes.** The suggested
route lands on the map with a summary (stops, km, duration, capacity used) and the planner
can drag stops between drivers before freezing. Optimisers are confidently wrong about
things they cannot see — a customer's loading dock, a road closed this week, a driver who
knows a building. Auto-applying would burn trust in a week.

`delivery_runs.optimisation_json` keeps the request and response, so "why did it route that
way?" is answerable, and so planner overrides can later be compared against the optimiser's
plan — which is itself a signal about which constraints are missing from the model.

**Route freeze** at `route_schedules.cutoff_time`. After freeze, an emergency order needs an
explicit *add to this route* or *move to next route* decision, both audit-logged.

### 4.3 Briefing — «امروز»

One route, `/today`, role-branched; the landing page after login.

| Role | Panels |
|---|---|
| **فروشنده** | Call list (customers overdue against their own purchase interval) · open tasks with outcome buttons · samples awaiting follow-up · month target vs actual as a bullet chart · **commission accrued this month** · reminders · assigned leads |
| **راننده** | Today's run: stops, total kg, cash to collect · weather + cold-chain note · **capacity note if weather reduced the stop count** · start-route · commission accrued · yesterday's failures needing retry |
| **مدیر گروه** | Orders today by state · exceptions (critical/warning/opportunity) · **credit approvals waiting on you** · team target progress · orders not yet planned · unassigned route capacity |
| **مدیر نمایندگان** | Reps by stage · onboarding steps overdue · reps with no order in N days · target achievement · reps whose product coverage dropped |
| **مالک** | All groups · cash collected today by method · stock and expiry risk · critical alerts · margin vs last month |
| **platform_owner** | Per-tenant health: activity, errors, storage, subscription state |

Two rules that stop it becoming another dashboard: **every item is actionable or it is not
on the page** (a number with no action belongs in `/analytics`), and it is **capped at what
fits on a phone without scrolling** — overflow goes behind «موارد بیشتر».

### 4.4 Academy — «آموزش»

**You already own the content.** Turns 4–75 of the same ChatGPT conversation are a
serialized, Iran-adapted Persian adaptation of Kotler's *Marketing Management* — roughly
440,000 characters, written for this business, including the chapter you specifically asked
for on recruiting city representatives. It needs editing and chunking, not writing.

- **Content as MDX in the repo** under `content/academy/`, versioned in git. No CMS.
  `lesson_progress` tracks only who has done what.
- **Modules:** ۱ مبانی بازار و مشتری · ۲ فروش تلفنی · ۳ محصول و قیمت · ۴ نمونه و تبدیل ·
  ۵ نگهداشت مشتری · ۶ جذب و اداره نماینده · ۷ عملیات و تحویل
- **Objection library** — highest ROI. Cards keyed to the *same* `outcome_code` a
  salesperson picks in a task. Someone logs `PRICE_OBJECTION`; the app offers the
  price-objection script on the spot. Training stops being a tab and becomes part of the call.
- **Scripts per `customer_type`** — a hotel purchasing manager and a small restaurant owner
  are not the same conversation.
- **Rep-manager track** — module 6 doubles as the onboarding curriculum for the new role.
- **Coaching loop:** a rule detects Sample→Order conversion below team average for two
  periods → assigns the relevant lesson as a task and notifies the manager.

---

### 4.5 Offline-first

The service worker today caches map tiles, geometry and two read endpoints, and says
plainly in its own header: *"Writes are NOT queued while offline — that's a deliberate
scope boundary, not an oversight."* Moving that boundary is this section.

#### The rule that decides what may go offline

> **An offline write is safe when it records a fact. It is unsafe when it claims a shared
> resource.**

*"I delivered 40 kg to this customer at 10:15"* is a fact. It happened; the server cannot
argue with it, and accepting it four hours late is correct. *"Reserve the last 100 kg of
butter for my customer"* is a claim — two salespeople offline can both make it, and only a
server can arbitrate.

That rule maps cleanly onto the 12-state machine, which is why the state machine was worth
building explicitly:

| Transition | Offline | Why |
|---|:---:|---|
| create / edit `DRAFT` | ✅ | Local intent, claims nothing |
| `submit → PENDING_REVIEW` | ✅ | Queues; server validates on arrival |
| `approve → CONFIRMED` | ❌ | Reserves stock, checks credit — needs authority |
| `plan → PLANNED` | ❌ | Route capacity is shared |
| `freeze → READY` | ❌ | Planner action, desk-bound anyway |
| start route `→ OUT_FOR_DELIVERY` | ✅ | Fact about the driver |
| **deliver / partial / fail + POD** | ✅ | **The case that matters most** |
| record a payment | ✅ | Fact — money changed hands |
| task outcome, note, reminder | ✅ | Fact |
| new lead / customer capture | ✅ | Client UUID, nothing to collide with |
| credit approval | ❌ | An authority decision |

Which gives three offline profiles rather than one:

- **راننده — fully offline.** The run downloads at start; every stop outcome, signature,
  photo and collected amount queues locally. Vans lose signal; this is the highest-value case.
- **فروشنده — offline drafts and facts.** Orders are created locally and sync as `DRAFT`;
  the server runs validation, stock and credit when it arrives. Never confirmed offline.
- **مدیر / مالک — read-only offline.** Last-seen data, no approvals. Approving a credit
  breach against a balance four hours stale is not an approval.

#### Mechanism

**Client store: IndexedDB, two object stores.**

```ts
// outbox — pending mutations
{
  id: string,               // UUIDv7, client-generated. This IS the idempotency key.
  op: "delivery.complete" | "payment.record" | "order.draft" | "task.outcome" | ...,
  ref: { type, clientUuid?, serverId? },
  payload: {...},
  occurredAt: string,       // device clock — when it actually happened
  clockSkewMs: number,      // measured against the server at last sync
  queuedAt: string,
  attempts: number,
  status: "held" | "pending" | "sending" | "conflict" | "failed",
  dependsOn?: string[],     // a payment on a locally-created order
}
// snapshot — the reads needed to work: today's run, assigned customers, products, prices
```

**Server side:**

```sql
ALTER TABLE <every offline-writable table> ADD client_uuid TEXT UNIQUE;

CREATE TABLE sync_mutations (
  id, organization_id, client_uuid UNIQUE, user_id, device_id,
  op, payload_json, occurred_at, clock_skew_ms,
  received_at, applied_at, status, result_json, error
);
CREATE TABLE deleted_rows (          -- tombstones; without these, deletes never propagate
  id, organization_id, entity_type, entity_id, deleted_at
);
```

`client_uuid UNIQUE` buys idempotency for free — replaying a mutation is a no-op upsert, so
a flaky connection that retries six times produces one delivery, not six.

**Ordering.** A payment against an order created offline references the order's *client*
UUID, not a server id. `dependsOn` guarantees the order is sent first; the server resolves
client UUID → server id at apply time.

**Time — a correction to v2.** v2 said "server-side timestamps, never trust the device
clock." Offline-first makes that impossible: for an event recorded in a basement at 10:15
and synced at 14:00, the device clock is the *only* witness. So both are stored:
`occurred_at` (device, what the receipt says) and `received_at` (server, for audit), plus
`clock_skew_ms` measured at each sync. A device with a wrong clock then becomes **detectable
and correctable** rather than silently corrupting the timeline — which is the honest
version of the original rule, not an abandonment of it.

**Conflicts. The server is authoritative, and never silently drops.**

| Case | Resolution |
|---|---|
| Same `client_uuid` arrives twice | Idempotent no-op |
| Entity changed since the device last saw it | **Fact** → apply and log · **Claim** → reject to `conflict` |
| Order cancelled / customer blocked meanwhile | `conflict` → task for the person who made it |
| Stock goes negative — three drivers delivered offline | **Accept.** Raise a stock-discrepancy alert |

That last row is the important one. **In an ERP, refusing a fact is worse than accepting it
and flagging it.** A driver who has already handed over the butter cannot un-hand it; a
system that rejects the record does not undo the delivery, it only loses the evidence.

**Sync triggers:** `online` event · `visibilitychange` · every 30 s while online ·
Background Sync API where available · on app start.

**Pull side:** `GET /api/sync/pull?since=<watermark>&scope=…` returns rows changed since the
watermark plus tombstones, scoped by org + group + role. Most tables already carry
`updated_at`; the rest gain it.

#### Sync status, in the Island idiom

A small persistent indicator: online/offline, *N* pending, last synced. Tapping opens the
outbox — each pending item readable, and still undoable while it remains local. A queue the
user cannot see is a queue they cannot trust.

### 4.6 The undo bar — and why it is not decoration

You asked for a bar at the bottom of a notification that shrinks and offers undo. The
mechanism is already half-built: `components/ToastProvider.tsx` supports a `ToastAction`,
and its own comment reasons about exactly this problem —

> *"An actionable toast is a deadline, not a notification: once it goes, so does the only
> undo."*

The bar is the missing half — it makes that deadline **visible** instead of secret.

**The design point worth pulling out:** the bar's duration is not a cosmetic timer. It is
the **outbox hold time** — how long the mutation sits locally before the sync engine picks
it up (`status: "held"` → `"pending"`).

```
  toast appears ──────────────────── bar empties ────────────────► flush to server
  │                                                             │
  └── undo here = delete a row from IndexedDB.                  └── undo here = a
      Instant. No round trip. No compensating write.                compensating
      Works identically offline.                                    mutation, which
                                                                    may be refused.
```

So the shrinking bar is an honest display of a real property of the system: *how long this
is still yours to take back.* That is worth building deliberately rather than as a progress
animation that happens to look like one.

**Implementation notes**, against the existing component and `MASTER.md`:

- A 3px track on the island's bottom edge, `rounded-b-[inherit]`, shown only while `open`
  (never on the collapsed pill).
- Animated with `transform: scaleX()`, not `width` — `width` drives layout, and `MASTER.md`
  bans animating it. `transform-origin: right`, so in RTL the remaining time stays anchored
  to the start of the reading direction and drains leftward.
- Coloured with the island's `tone` var. A non-text indicator, so it answers to **3:1**
  against the island surface per `MASTER.md`'s status-fill rule — every tone already clears
  far more.
- **Pauses on hover, touch and focus.** Currently the lifetime is a fixed `setTimeout`;
  it becomes a pausable timer tracking `remaining` and `startedAt`. Without this, reading a
  long Persian message costs you the undo you were reading about.
- **`prefers-reduced-motion`:** the bar steps in ~8 discrete jumps instead of animating
  continuously. It still communicates a deadline; it just stops moving.
- **Screen readers:** the bar is `aria-hidden`, because a live-updating timer inside an
  `aria-live` region would babble. The deadline goes into the button's accessible name
  («لغو — ۹ ثانیه فرصت»), and the timer **pauses entirely while focus is inside the
  toast** — a keyboard or screen-reader user is never raced by an animation.
- `ACTION_LIFETIME_MS` (9000) becomes the shared constant for both the bar and the outbox
  hold, so the two can never drift apart.

## Part 5 — Build order

| Phase | Contents | Gate |
|---|---|---|
| **0. Foundations — ✅ DONE** (branches `phase-0-tenancy` + `phase-0b-foundations`, 2026-09-02, unmerged) | M1 tenancy + `platform_owner` + access log (Phase 0a). `lib/repo` layer **scoped** — infra + new M2 tables through it + a boundary test blocking new raw SQL; the existing ~69 raw-SQL files pay down incrementally (the full 314-site rewrite is its own pre-Postgres phase). M2 customers (type/lifecycle/credit, `status` retired), representatives (`representative_profiles` + onboarding stage machine, `rep_manager` role), `credit_approvals` (direct customers, manual decide; auto trigger deferred to Phase 3). Excel customer-import + delivery-parse **removed entirely** (Risk 1 killed at the root). Demo purge hardened. | Landed. |
| **1. Money — ✅ DONE** (branch `phase-1-money`, 2026-09-02, unmerged) | M3 `payments` (append-only, method + optional receipt photo) + `payment_allocations` (FIFO auto-split, on-account remainder) + `cheques` (full `lib/chequeStates` machine: in_hand → deposited → cleared / bounced / replaced; a bounce voids the linked payment's allocations and raises a reminder). `orders.paid_toman` is a cache recomputed by `recomputeOrderPayment`; `recordDelivery` writes a CASH payment keyed to the stop instead of stamping it, and a guarded backfill gives every legacy `paid_toman` a payment row. `customers.debt_0_7/8_30/30_plus` dropped (they were demo data) → `opening_balance_toman DEFAULT 0` + `customerDebt` / `customerDebtsForOrg` age unpaid delivered orders live; every consumer switched. `orders.credit_hold` wires `credit_approvals` into `createOrder` / `addStop` (direct customers only; `hard_credit_block` refuses at creation; `decide('approved')` releases). Routes: `/api/payments`, `/api/payments/[id]` (+`/receipt`), `/api/cheques`, `/api/cheques/[id]`, `/api/customers/[id]/statement`. UI: `/sales/payments`, `/sales/cheques`. `payments` + `cheques` on `TENANT_TABLES`; two-org isolation extended. | Landed. |
| **2. Stock + batches — ✅ DONE** (branch `phase-2-stock`, 2026-09-02, unmerged) | M4 `stock_movements` (signed append-only ledger; on-hand = `SUM(base_qty)` per product/batch/facility, replacing `purchased − delivered`), `batches` (code, expiry, `lib/batchStates` machine: active/quarantined/recalled + swept expired/depleted), `delivery_line_batches`, `quality_complaints`. FEFO draw at delivery (`recordDelivery` writes `DELIVERY_OUT` + line-batch rows, idempotent on the stop); `recordPurchase` creates a batch + `PURCHASE_IN`. Guarded backfill converts every legacy purchase line → batch + movement and every delivered line → `DELIVERY_OUT` (verified on the real backup: per-product on-hand unchanged). `expiringBatches` alerts, `batchTrace` forward, `backwardTrace` + `complaintClusters` back. Routes `/api/sales/batches` (+`/[id]`, `/trace`), `/api/sales/stock/movements`, `/api/sales/stock/expiry`, `/api/sales/complaints` (+`/[id]`). UI `/sales/batches`, `/sales/complaints`, an انقضا strip on `/sales/stock`. Four tables on `TENANT_TABLES`; two-org isolation extended. | Landed. |
| **3. Order pipeline — ✅ DONE** (branch `phase-3-order-pipeline`, 2026-09-02, unmerged) | `lib/orderStateMachine.ts` (12+2 states, transition table with roles + effects). `orders.status` widened via a guarded rebuild + value map; `order_events` audit trail + backfill; `order_type`/`priority`/`offline`. `advanceOrder` (409/403/404). `submitOrder` + `PENDING_CREDIT` auto-transition wiring `credit_hold`; `decide` drives the order state. `stock_reservations` + `reserveForOrder`/`availableToPromise` (confirm-time reservation). `deliveries` + `delivery_lines` + `reason_codes` (M6); `lib/repo/deliveries.ts` (`planDelivery`/`retryDelivery`/`spawnBackorder`); `recordDelivery` on the machine, `completeDelivery` API path with server-owned timestamps. Routes `/api/sales/orders/*/transition`, `.../events`, `/api/sales/reason-codes`, `/api/sales/deliveries*`. UI: `OrderStatusPanel` + `/sales/deliveries`. Handoff: `docs/HANDOFF-2026-09-02-phase-3-order-pipeline.md`. | The spine everything else hangs on |
| **4. Offline-first — ✅ DONE** (branch `phase-4-offline-first`, 2026-09-02, unmerged) | `lib/offline/safety.ts` (§4.5 fact/claim table — 7 facts queue, 4 claims refused at the call site). `client_uuid` + partial unique index on orders/payments/deliveries/customers (plain ADD COLUMN, no rebuild); `sync_mutations` (server idempotency log) + `deleted_rows` tombstones. `lib/offline/{uuidv7,clock,outbox,constants}.ts` (time-ordered id, skew math, the pure hold/dependency queue; `OUTBOX_HOLD_MS` shared with the undo bar). `applyMutations` (toposort, idempotent, client-ref → server id, dispatch to Phase 0–3 entry points, conflict → reminder) + `pullSince` (role-scoped rows + tombstones + watermark). Routes `/api/sync/push` + `/api/sync/pull`. Browser glue (not unit-tested, per repo norm): `idbStore` / `net` / `syncEngine` / `SyncStatus` island / `sw.js` `-v3` + Background Sync. Migration verified lossless on the real backup. Handoff: `docs/HANDOFF-2026-09-02-phase-4-offline-first.md`. | Depends on Phase 3: the state machine decides what may go offline |
| **5. Routing** | M7 vehicles, templates, schedules · OSRM + VROOM deployment · planner UI · route freeze | Where 400/day stops hurting |
| **6. Weather** | Open-Meteo + snapshots · `capacity_factors` · weather-adjusted VROOM input · map layer · frozen forecast | Feeds Phase 5 |
| **7. Spine + briefing** | M8 events/tasks/alerts/rules with cooldown + escalation · `/today` for all six roles | Daily habit |
| **8. Reps + academy** | `/reps` tab · rep health, onboarding, stages · `/academy` modules 1–2 + objection library | Growth engine |
| **9. Analysis** | Why-analysis drill-down · health scores · contribution margin per customer/product/salesperson/territory · Action Center · **precomputed KPI snapshots** (the second condition on SQLite) | |
| **10. Prediction** | Demand forecast · churn · **learned `capacity_factors` from a year of actuals** | Only once the data exists |

**Sequencing note.** Offline-first sits at Phase 4, after the order pipeline, because the
rule in §4.5 — facts may go offline, claims may not — is expressed in terms of state
transitions. Building the queue before the state machine means guessing at which mutations
are safe, and guessing wrong there produces double-delivered orders and phantom stock.

**One exception worth taking early:** the **undo bar** (§4.6) is a self-contained change to
an existing component and can ship any time. Building it early with a plain timer, then
re-pointing that timer at the outbox hold in Phase 4, is a one-line change — the component
does not change shape.

**Estimate:** Phases 0–5 are the substance — roughly 10–13 weeks at the current pace.
Phases 6–10 are another 7–9. If time is short, 0–5 is a coherent product.

## Part 6 — Still deliberately not built

| Dropped | Why |
|---|---|
| **DB-driven KPI formula interpreter** | ChatGPT's `kpi_definitions.formula` implies writing an expression evaluator — a large, injection-prone subsystem. KPIs live in `lib/kpi/*.ts`, one tested function each. Revisit only when a non-developer must edit a formula. |
| **Separate `Representative` entity parallel to `Customer`** | Reps buy wholesale through the same pipeline. `representative_profiles` extends rather than duplicates, so orders, payments, stock and delivery stay unified. They still get their own role and tab. |
| **AI anything before Phase 9** | With no history there is nothing to learn from. The one exception is the weather-factor regression, which has a real, measured target variable. |
| **Real-time driver tracking** | Not asked for; significant battery, privacy and consent surface. `users.location_consent_at` exists if it comes up. |

---

## Part 7 — Risks

1. **Excel is still upstream of `customers`.** `import/onedrive` overwrites customer rows
   from the workbook. Once the app owns payments and debt, that import will silently revert
   real data. **Field ownership must be split before Phase 1 ships** — this is the highest
   near-term risk in the plan.
2. **Synchronous SQLite on the event loop** — Part 2. At 400 orders/day it will present as
   "the app is randomly slow," which is the hardest kind of problem to attribute.
3. **`commission_rates` has no org scope** — payroll data is the worst thing to leak between
   tenants. Included in M1, called out because of what it is.
4. **VROOM and OSRM are two more services to run and monitor.** Real ops cost. The
   mitigation is that both are stateless and can be restarted freely; a failed optimiser
   must degrade to manual `sort_order`, never block order entry.
5. **Batch tracking only works if it is entered.** Traceability depends on someone recording
   the batch code at goods-in. If that step is skipped, the whole chain is decorative.
   Make it a required field on `PURCHASE_IN`, not an optional one.
6. **Offline conflicts are a product problem, not only a technical one.** The machinery
   resolves duplicates and stale writes. What it cannot decide is what a human should be
   told when a delivery they recorded three hours ago is rejected. Every conflict class in
   §4.5 needs a Persian message and an owner, or the queue quietly becomes a place
   mutations go to die.
7. **Device clocks.** A driver's phone with the wrong date will write plausible-looking
   deliveries into last week. `clock_skew_ms` makes it visible; a sync that finds skew
   beyond a few minutes should warn on the device rather than only log on the server.
8. **The outbox must survive app updates.** An IndexedDB schema change that drops a pending
   queue loses real deliveries and real money. Outbox migrations get their own tests, and
   the sync engine refuses to start against a version it does not recognise rather than
   guessing.
9. **Rapid scale + one developer.** The plan is sequenced so each phase is independently
   shippable and useful, precisely so that stopping between phases leaves a coherent system
   rather than a half-migration.
