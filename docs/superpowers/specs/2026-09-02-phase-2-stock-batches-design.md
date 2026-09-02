# RouteFlow Phase 2 — Stock & Batches — Design

**Date:** 2026-09-02 · **Branch:** `phase-2-stock` (off `phase-1-money`)
**Spec source:** `docs/crm-erp-plan.md` Part 3 M4, Part 5 row 2 · `docs/crm-erp-source-extract.md` §Inventory, §Traceability, §8 #9
**Predecessors:** Phases 0a, 0b, 1 — code-complete, unmerged.

---

## Goal

Today stock is a single derived number per product — everything purchased minus
everything delivered (`lib/purchases.ts` `stockPosition`). It is checkable but blind:
no idea *which* physical lot a customer received, no expiry, no way to answer "batch
1405-0612 is suspect — who has it?" without an afternoon of phone calls. For a company
selling dairy fat that is the missing food-safety floor.

Phase 2 adds:

1. **`batches`** — a received lot: code, supplier ref, production/expiry date, quantity,
   a small status machine (`active / quarantined / recalled / expired / depleted`).
2. **`stock_movements`** — a signed, append-only ledger. Every `PURCHASE_IN`,
   `DELIVERY_OUT`, `TRANSFER_*`, `RETURN_IN`, `ADJUSTMENT`, `WRITE_OFF`, `COUNT`,
   `SAMPLE_OUT` is one row. **On-hand becomes `SUM(base_qty)` over this table** — still
   derived, never a stored counter, but now per batch and per facility.
3. **`delivery_line_batches`** — which batch actually went out on which delivery line, so
   forward traceability is one query.
4. **`quality_complaints`** — a complaint tied to a customer, order, product and batch;
   clustering on a batch raises an alert.
5. **FEFO picking** — when a delivery is recorded, the delivered quantity is drawn from
   the earliest-expiry batches with stock (First-Expired-First-Out, the correct default
   for dairy fat). Shortfall is a `batch_id = NULL` movement so negative stock still
   shows rather than being hidden.
6. **Expiry alerts** — batches within a configurable fraction of their shelf life, or
   already past `expiry_date`.
7. **Traceability, both directions** — forward (batch → deliveries → customers) and
   backward (complaint → order → batch → purchase line → supplier ref).

## Global constraints (unchanged)

- **Branch `phase-2-stock`.** Never `main`. No `npm run build` / `systemctl restart`.
  Merges with the whole stack after Phase 10.
- **Money is whole Toman in `INTEGER`.** Quantities are `REAL` in the product's
  `base_unit` (عدد), the same unit `purchase_lines.base_qty` and `on_hand` already use.
- **Dates ISO/Gregorian stored, Jalali shown.** `expiry_date`, `produced_at` included.
- **Migrations idempotent, `PRAGMA`/constraint-guarded, table-rebuild style.**
- **New DB access goes through `lib/repo/`.** `tests/repo-boundary.test.ts` enforces it;
  the allowlist only shrinks. `lib/purchases.ts` and `lib/delivery.ts` are grandfathered
  and may keep raw SQL, but new stock logic goes in `lib/repo/stock.ts` etc.
- **A row from another tenant answers 404, not 403.** Persian user-facing text.
- `npx tsc --noEmit && npx eslint app/ lib/ && npx vitest run` green before each commit.

---

## Data model

### `batches` (tenant table)

```sql
CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_code TEXT NOT NULL,
  supplier_batch_ref TEXT,
  purchase_line_id INTEGER REFERENCES purchase_lines(id),
  produced_at TEXT,
  expiry_date TEXT,
  qty_received_base REAL NOT NULL,
  unit_cost_toman INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN
    ('active','quarantined','recalled','expired','depleted')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, product_id, batch_code)
);
CREATE INDEX ix_batches_product ON batches (organization_id, product_id, expiry_date);
```

- `unit_cost_toman` is carried for traceability and per-batch valuation display. Product
  cost stays **moving-average** (`lib/stockMath.ts`) — the business does not run a
  per-unit-to-receipt warehouse process (`crm-erp-plan.md` M4 note, and `stockMath.ts`
  header). Batches do not change how margin is snapshotted onto an order line.
- `status`: `active` is sellable. `quarantined` is held (FEFO skips it). `recalled` is a
  safety event — FEFO skips it and an alert fires. `expired` / `depleted` are **derived
  states written by a sweep**: `expired` when `expiry_date < today`, `depleted` when
  on-hand ≤ 0. `lib/batchStates.ts` allows the manual moves only.

### `lib/batchStates.ts`

```
active      -> quarantined | recalled | expired | depleted
quarantined -> active | recalled | depleted
recalled    -> depleted
expired     -> depleted
depleted    -> active            (a correcting RETURN_IN can revive a batch)
```

`canTransitionBatch(from, to)`. `expired`/`depleted` targets are reachable only through
the sweep, not the API (`advanceBatchStatus` rejects them with a "computed status" error;
the sweep writes them directly).

### `stock_movements` (tenant table)

```sql
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),          -- NULL = unbatched (shortfall / legacy)
  base_qty REAL NOT NULL,                            -- signed: + in, - out
  kind TEXT NOT NULL CHECK (kind IN
    ('PURCHASE_IN','TRANSFER_OUT','TRANSFER_IN','DELIVERY_OUT','SAMPLE_OUT',
     'RETURN_IN','ADJUSTMENT','COUNT','WRITE_OFF')),
  ref_type TEXT,                                     -- 'purchase_line' | 'delivery_stop' | 'complaint' | ...
  ref_id INTEGER,
  occurred_at TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_stock_mv ON stock_movements
  (organization_id, product_id, batch_id, facility_id, occurred_at);
```

- Append-only. A mistake is a compensating `ADJUSTMENT` or `WRITE_OFF`, never an edit.
- **On-hand** = `SUM(base_qty)` filtered by any of `product_id` / `batch_id` /
  `facility_id`. Allowed to be negative (same rule as `stockMath.stockAfter` today — the
  books lag reality while the paper backlog drains; the UI flags it).
- `COUNT` is a physical stock-take: it does not carry a delta, it records the counted
  figure in `notes`/`base_qty` as an absolute and the repo writes the `ADJUSTMENT` that
  reconciles. (v1: a `COUNT` movement's `base_qty` is the *delta* the counter entered;
  keeping it a delta keeps the invariant `on_hand = SUM(base_qty)` with no special case.)

### `delivery_line_batches` (tenant table)

```sql
CREATE TABLE delivery_line_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  delivery_stop_id INTEGER NOT NULL REFERENCES delivery_stops(id),
  order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
  batch_id INTEGER REFERENCES batches(id),          -- NULL = unbatched shortfall
  base_qty REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_dlb_batch ON delivery_line_batches (batch_id);
CREATE INDEX ix_dlb_stop ON delivery_line_batches (delivery_stop_id);
```

- `delivery_stop_id` rather than the plan's `delivery_id`: the `deliveries` table is
  Phase 3 (M6). A comment marks the rename. One row per (line, batch) split.

### `quality_complaints` (tenant table)

```sql
CREATE TABLE quality_complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id INTEGER REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  product_id INTEGER REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),
  reported_at TEXT NOT NULL,
  reported_by INTEGER REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN
    ('spoilage','packaging','foreign_object','short_weight','wrong_product','other')),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN
    ('open','investigating','resolved','dismissed')),
  resolution TEXT,
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX ix_complaints_batch ON quality_complaints (organization_id, batch_id, reported_at);
```

- Clustering: `complaintClusters(orgId)` returns batches with ≥ 2 open/investigating
  complaints in the last 30 days → an alert surface. The spec is explicit that software
  does **not** replace a QA specialist (`source-extract §Traceability`); this is a
  signal, not a verdict.

### `products.shelf_life_days`

The plan says `products.shelf_life` exists — it does not. Add
`shelf_life_days INTEGER` (nullable, plain `ADD COLUMN`). Used to (a) default a batch's
`expiry_date` to `produced_at + shelf_life_days` when the receipt does not give one, and
(b) drive the expiry-alert fraction.

---

## `lib/repo/stock.ts` — the ledger

- `export type MovementKind = 'PURCHASE_IN' | ... ` (the CHECK list)
- `export interface MovementInput { facility_id; product_id; batch_id: number | null; base_qty; kind; ref_type?; ref_id?; occurred_at; created_by?; notes? }`
- `export function recordMovement(organizationId, input: MovementInput): number` — one insert; validates `facility_id` and `product_id` belong to the org (NULL org tolerated for hand-seeded rows, like Phase 1).
- `export function recordMovementsTxn(db, organizationId, inputs: MovementInput[]): number[]` — for callers already in a transaction (`recordPurchase`, `recordDelivery`).
- `export function onHand(organizationId, filter: { product_id?; batch_id?; facility_id? }): number` — `SUM(base_qty)`.
- `export function batchStock(organizationId, productId, facilityId?): Array<{ batch_id: number; expiry_date: string | null; status: string; on_hand: number }>` — one row per batch of the product, FEFO-ordered (`expiry_date` asc, NULLs last, then `id`), on-hand computed.
- `export function allocateFEFO(organizationId, productId, baseQty, facilityId): Array<{ batch_id: number | null; base_qty: number }>` — walk `batchStock` for `status = 'active'` and `on_hand > 0`, taking from each until satisfied; any remainder is one `{ batch_id: null, base_qty: rest }` entry. Reads only.
- `export function defaultFacilityId(organizationId): number` — the `warehouse` facility, else `home_base`, else the lowest-id facility. Throws if the org has none.
- `export function stockLevels(organizationId): Array<{ product_id; on_hand; value_toman; negative; earliest_expiry: string | null }>` — the movement-derived replacement for `stockPosition`'s core, joined to `products` by the caller.

## `lib/repo/batches.ts`

- `export interface BatchRow { ...schema... }`
- `export const batchesRepo`
- `export function createBatch(organizationId, input: { product_id; batch_code?; supplier_batch_ref?; purchase_line_id?; produced_at?; expiry_date?; qty_received_base; unit_cost_toman?; notes? }): number` — `batch_code` defaults to `<YYMMDD>-<n>` where `n` makes it unique per (org, product). `expiry_date` defaults to `produced_at + products.shelf_life_days` when both are known. Does **not** write a movement — the caller pairs it with a `PURCHASE_IN`.
- `export class BatchError extends Error {}`
- `export function advanceBatchStatus(organizationId, id, to: BatchStatus, actor: number): void` — enforces `lib/batchStates`; refuses `expired`/`depleted` ("این وضعیت خودکار محاسبه می‌شود"). On `recalled`, raise a `reminders` row per affected customer (from `delivery_line_batches` → `delivery_stops` → `orders`).
- `export function sweepBatchStatuses(organizationId?): { expired: number; depleted: number }` — sets `expired` where `expiry_date < today` and status `active`/`quarantined`; sets `depleted` where computed on-hand ≤ 0 and status not already terminal. Idempotent. Called from `getDb()` once per boot **and** exposed for a cron later.
- `export function expiringBatches(organizationId, opts?: { withinDays?: number; asOf?: string }): Array<BatchRow & { on_hand: number; days_to_expiry: number | null }>` — `active`/`quarantined` batches with `on_hand > 0` whose `expiry_date` is past, or within `withinDays` (default: `products.shelf_life_days * 0.25`, floored at 7).
- `export function batchTrace(organizationId, batchId): { batch: BatchRow; purchase: {...} | null; deliveries: Array<{ delivery_stop_id; order_id; order_no; customer_id; customer_name; base_qty; delivered_at }>; complaints: BatchRow[] }` — forward trace, one call.

## `lib/repo/complaints.ts`

- `export interface ComplaintRow { ...schema... }`
- `export const complaintsRepo`
- `export function fileComplaint(organizationId, input: { customer_id?; order_id?; product_id?; batch_id?; reported_by; category; severity?; description? }): number` — if `order_id` + `product_id` are given and `batch_id` is not, infer `batch_id` from `delivery_line_batches` (the batch that line received).
- `export function updateComplaint(organizationId, id, patch: { status?; severity?; resolution? }, actor): void` — on `status → resolved`/`dismissed`, stamp `resolved_at`/`resolved_by`.
- `export function listComplaints(organizationId, filter?: { status?; batch_id?; customer_id? }): ComplaintRow[]`
- `export function complaintClusters(organizationId, opts?: { sinceDays?; minCount? }): Array<{ batch_id; batch_code; product_id; count; severities: string[] }>` — default `sinceDays = 30`, `minCount = 2`, open/investigating only.
- `export function backwardTrace(organizationId, complaintId): { complaint; order; batch; purchase_line; supplier_batch_ref }` — complaint → order → batch → purchase line → supplier ref.

---

## Integration points

### `lib/purchases.ts` `recordPurchase`

Inside the existing transaction, per line, **after** `insertLine`:
1. `createBatch(...)` (via a txn-aware helper `createBatchTxn(db, orgId, ...)` in
   `lib/repo/batches.ts`) with `purchase_line_id`, `qty_received_base = line.base_qty`,
   `unit_cost_toman = line.unit_cost_toman`, `produced_at`/`expiry_date`/`batch_code`
   from optional new `PurchaseLineInput` fields (`batch_code?`, `produced_at?`,
   `expiry_date?`, `supplier_batch_ref?`).
2. `recordMovementsTxn(db, orgId, [{ kind: 'PURCHASE_IN', facility_id: defaultFacilityId(orgId),
   product_id, batch_id, base_qty: line.base_qty, ref_type: 'purchase_line', ref_id,
   occurred_at: purchase_date, created_by }])`.

Moving-average cost roll is unchanged.

### `lib/delivery.ts` `recordDelivery`

Inside the existing transaction, after `packs_delivered` is written and before/with the
CASH payment: for each line with a positive delivered base quantity
(`effectivePacks * qty_per_pack`):
1. `allocateFEFO(orgId, product_id, baseQty, defaultFacilityId(orgId))`.
2. For each `{ batch_id, base_qty }`: a `DELIVERY_OUT` movement
   (`base_qty` negative, `ref_type: 'delivery_stop'`, `ref_id: stopId`) and a
   `delivery_line_batches` row.
3. Idempotency: keyed on `delivery_stop_id`. A retried `recordDelivery` first deletes the
   stop's `delivery_line_batches` rows and reverses its `DELIVERY_OUT` movements (a
   compensating `RETURN_IN`? no — just `DELETE FROM stock_movements WHERE ref_type =
   'delivery_stop' AND ref_id = ? AND kind = 'DELIVERY_OUT'`, because these rows are
   machine-generated within one atomic delivery record and carry no independent
   history), then re-allocates. Mirrors the Phase 1 payment idempotency.

### `lib/purchases.ts` `stockPosition` / `advancedStockPosition`

`purchased_qty` / `delivered_qty` derivation switches to `stock_movements`:
`purchased_qty = SUM(base_qty) WHERE base_qty > 0`,
`delivered_qty = -SUM(base_qty) WHERE base_qty < 0` — or simply `on_hand = SUM(base_qty)`.
Backfill (below) makes the numbers identical to today's at migration. `value_toman`
still `on_hand * avg_cost_toman`. `advancedStockPosition` gains `earliest_expiry` and an
`expiring` count per product.

### Migration & backfill (`lib/db.ts`, `app_meta` `stock_ledger_backfill_done`)

1. `CREATE TABLE` the four new tables; `ALTER TABLE products ADD COLUMN shelf_life_days`.
2. `TENANT_TABLES += batches, stock_movements, delivery_line_batches, quality_complaints`.
3. Backfill, one transaction, guarded:
   - Per `purchase_line`: `createBatch` (`batch_code = 'LEGACY-PL<id>'`, `expiry_date`
     NULL, `qty = base_qty`, `cost = unit_cost_toman`, `purchase_line_id = id`) + a
     `PURCHASE_IN` movement at the purchase date, `facility = defaultFacilityId`.
   - Per delivered `order_line` with `packs_delivered > 0`: `allocateFEFO` for
     `packs_delivered * qty_per_pack` against that product's legacy batches, writing
     `DELIVERY_OUT` movements + `delivery_line_batches` rows at `delivered_at`,
     `ref = delivery_stop` (found via `delivery_stops.order_id`) or NULL.
   - Net on-hand per product now equals the old `stockAfter(purchased, delivered)`.
4. `sweepBatchStatuses()` after the backfill and every boot.

---

## API surface

| Route | Methods | Roles | Purpose |
|---|---|---|---|
| `/api/sales/batches` | GET (`?product_id=`, `?status=`, `?expiring=1`), POST | owner, group_manager | list / create a batch (a manual batch, e.g. an opening count) |
| `/api/sales/batches/[id]` | GET, PATCH (`{action:'status', to}`) | owner, group_manager | detail + trace; move status |
| `/api/sales/batches/[id]/trace` | GET | owner, group_manager | forward trace |
| `/api/sales/stock/movements` | GET (`?product_id=`, `?facility_id=`), POST | owner, group_manager | ledger view; record an `ADJUSTMENT` / `COUNT` / `WRITE_OFF` / `TRANSFER_*` |
| `/api/sales/stock/expiry` | GET | owner, group_manager, salesperson | expiring / expired batches |
| `/api/sales/complaints` | GET (`?status=`, `?batch_id=`), POST | owner, group_manager, salesperson (POST) | list / file a complaint |
| `/api/sales/complaints/[id]` | GET, PATCH | owner, group_manager | detail (+ backward trace); update status/resolution |
| `/api/sales/stock` (existing) | GET | — | gains `expiring_count` and per-row `earliest_expiry` |

All reads scoped through `lib/repo`. Cross-tenant id → 404. Illegal batch status → 409.

## UI

- **`/sales/stock`** (existing page): a new "انقضا" strip at the top — count of expiring
  + expired batches, expandable to a list (product, batch code, expiry Jalali, on-hand).
  Each product row gains an earliest-expiry chip.
- **`/sales/batches`** (new, owner/manager): a table of batches (product, code, expiry,
  on-hand, status) with a status control (legal moves from `batchStates`), and a "ثبت
  بچ" form for a manual batch. Clicking a batch opens its forward trace (which customers
  hold it).
- **`/sales/complaints`** (new, owner/manager/salesperson): a list (customer, product,
  batch, category, severity, status) + a "ثبت شکایت" form (customer, order optional,
  product, category, severity, description). A cluster banner when
  `complaintClusters` is non-empty. Manager can set status/resolution.
- **`CustomerDetailPanel`**: a small "شکایت کیفی" link → the complaints form pre-filled
  for that customer.
- Nav tabs "بچ‌ها" (owner/manager) and "شکایات" (all non-driver) in `app/sales/layout.tsx`.
  `proxy.ts`: `/sales/batches` + `/api/sales/batches` + `/api/sales/stock/movements`
  manager/owner only (like `/sales/cheques`).

## Testing

- `lib/batchStates.ts`: every legal/illegal transition; `expired`/`depleted` refused via the API path.
- `lib/repo/stock.ts`: `recordMovement` scoping; `onHand` sums signed rows incl. negative; `allocateFEFO` picks earliest expiry, skips quarantined/recalled/empty, puts the shortfall on `batch_id = NULL`; `defaultFacilityId` preference order.
- `lib/repo/batches.ts`: `createBatch` auto-code uniqueness + `expiry_date` default from shelf life; `sweepBatchStatuses` sets `expired`/`depleted` idempotently; `expiringBatches` window; `advanceBatchStatus` recall raises a reminder per customer; `batchTrace` forward.
- `lib/repo/complaints.ts`: `fileComplaint` infers `batch_id` from the delivered line; `complaintClusters` threshold; `backwardTrace` chain; status transitions stamp `resolved_*`.
- `recordPurchase`: creates a batch + a `PURCHASE_IN` per line; on-hand unchanged vs pre-Phase-2 for the same receipt.
- `recordDelivery`: FEFO `DELIVERY_OUT` + `delivery_line_batches`; a retried delivery converges (no doubled movements); `stockPosition` on-hand matches the old derivation for the same data.
- Migration test (`ROUTEFLOW_MIGRATION_CHECK_DB`): new tables present, `shelf_life_days` added, backfill makes `SUM(stock_movements.base_qty)` per product equal the legacy `purchased − delivered`, `foreign_key_check` empty against the real 141-customer backup.
- Route tests: auth per table above, cross-tenant 404, illegal status 409.
- Two-org isolation: `twoOrgs` seeds a batch + a movement + a `delivery_line_batches` row + a complaint per org (colliding `batch_code`); `tenancy-isolation` asserts no leak and the per-tenant `UNIQUE` on `batch_code` holds; the four tables join `TENANT_TABLES`.

## Sequencing

1. Four tables + `products.shelf_life_days` + `TENANT_TABLES` + `tenancy-schema` exempt review + `lib/batchStates.ts`.
2. `lib/repo/stock.ts` — `recordMovement(sTxn)`, `onHand`, `batchStock`, `allocateFEFO`, `defaultFacilityId`, `stockLevels`.
3. `lib/repo/batches.ts` — `createBatch(Txn)`, `advanceBatchStatus`, `sweepBatchStatuses`, `expiringBatches`, `batchTrace`.
4. `recordPurchase` writes a batch + `PURCHASE_IN`; new optional `PurchaseLineInput` fields.
5. `recordDelivery` writes FEFO `DELIVERY_OUT` + `delivery_line_batches`, idempotent on the stop.
6. Backfill (`lib/db.ts`, guarded); `stockPosition` / `advancedStockPosition` derive from movements.
7. `lib/repo/complaints.ts` + `backwardTrace`.
8. API routes (batches, movements, expiry, complaints).
9. UI (`/sales/batches`, `/sales/complaints`, `/sales/stock` strip, panel link, nav, proxy).
10. Tenancy wiring (`twoOrgs`, isolation) + docs/handoff.

Each step is one or more commits, TDD, full suite green.

## Explicitly out of scope

- Confirm-time stock **reservation** and the 12-state `reserveStock` effect (Phase 3).
- Multi-facility on-hand *enforcement* on delivery — deliveries deduct from the default
  facility; `TRANSFER_*` movements are recordable and reported but a delivery is not
  gated on van location (van-stock / فروش فوری is its own later slice).
- Per-batch costing / FIFO valuation — cost stays moving-average.
- Reorder-point automation and demand forecasting (Phase 9/10).
- A formal recall workflow beyond the status flag + customer reminders.

## Risks

1. **Backfill correctness.** The invariant to preserve is per-product on-hand. Tested
   against the real backup; the backfill is guarded and idempotent; a mismatch is a
   blocker, not a warning.
2. **FEFO on legacy data with no expiry dates.** Legacy batches have `expiry_date = NULL`
   → they sort last and are drawn only after dated batches. For the backfill (all legacy)
   this is a stable order by `purchase_line_id`, i.e. effectively FIFO, which is the
   right fallback.
3. **`recordDelivery` now does more inside its transaction.** FEFO allocation is a read
   plus N inserts; kept in the same `BEGIN IMMEDIATE`. A retry deletes and re-writes the
   stop's machine-generated stock rows — covered by an idempotency test.
4. **Negative stock and FEFO.** If a product is oversold, `allocateFEFO` returns a
   `batch_id = NULL` shortfall entry; on-hand goes negative and the UI flags it, matching
   today's behaviour rather than blocking a delivery that physically happened.
5. **Sweep timing.** `sweepBatchStatuses` on every boot is cheap (one UPDATE per
   condition) but a batch expiring mid-day is not flagged until the next boot; acceptable
   until a real scheduler exists (Phase 7 briefing).
