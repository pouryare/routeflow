# RouteFlow Phase 3 — Order Pipeline (M5 + M6) — Design

**Date:** 2026-09-02 · **Branch:** `phase-3-order-pipeline` (off `phase-2-stock`) · **Status:** design, unimplemented.

Implements `docs/crm-erp-plan.md` Part 5 row 3: *M5 the 12-state order machine · M6 `deliveries` as its own entity · reason codes · sample orders end-to-end*, and closes the Phase 1 loose end (`PENDING_CREDIT` auto-transition wiring `orders.credit_hold`) and the Phase 2 loose end (confirm-time stock reservation).

---

## 1. Goal

Replace the 4-value `orders.status` free-for-all (`draft / confirmed / delivered / cancelled`, advanced by scattered `UPDATE orders SET status = …`) with **one explicit transition table** that every writer, every button and the audit trail derive from. Give delivery its own row between the order and the route stop, so one visit can carry several orders and a failed attempt is a first-class fact with a reason code, not a mutated order.

Non-goals (later phases): offline outbox (Phase 4 — the machine's `offline` column is defined here but nothing consumes it yet), routing/VROOM/weather (Phase 7), the event/task/alert rule engine (Phase 8 — Phase 3 writes `order_events` rows but there is no rule runner reading them).

---

## 2. The 12-state machine (M5)

### 2.1 States

`DRAFT, PENDING_REVIEW, PENDING_CREDIT, ON_HOLD, CONFIRMED, PLANNED, READY, OUT_FOR_DELIVERY, DELIVERED, PARTIALLY_DELIVERED, DELIVERY_FAILED, CLOSED`, plus terminal `CANCELLED` and `RETURNED`.

`CLOSED` = delivered **and** financially settled (no balance owing). Terminal.
`PARTIALLY_DELIVERED` = some lines short at the door; it either closes on settlement or spawns a backorder.
`DELIVERY_FAILED` = nobody home / refused whole order; retryable back to `PLANNED`.

### 2.2 `lib/orderStateMachine.ts` — the single source of truth

Same shape as `lib/batchStates.ts` / `lib/chequeStates.ts` (transition table + guards), but transitions carry `roles` and `effects`:

```ts
export type OrderStatus =
  | "DRAFT" | "PENDING_REVIEW" | "PENDING_CREDIT" | "ON_HOLD" | "CONFIRMED"
  | "PLANNED" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "PARTIALLY_DELIVERED"
  | "DELIVERY_FAILED" | "CLOSED" | "CANCELLED" | "RETURNED";

export type OrderAction =
  | "submit" | "passReview" | "flagCredit" | "approveCredit" | "rejectCredit"
  | "releaseHold" | "confirm" | "plan" | "unplan" | "freeze" | "startRoute"
  | "deliver" | "deliverPartial" | "failDelivery" | "retryDelivery"
  | "settle" | "cancel" | "returnOrder";

export type OrderRole = "salesperson" | "group_manager" | "owner" | "driver" | "system";

export interface OrderTransition {
  from: OrderStatus;
  action: OrderAction;
  to: OrderStatus;
  roles: OrderRole[];         // "system" = only an internal effect may fire it
  effects?: OrderEffect[];    // side-effects run inside the caller's txn, in order
}

export type OrderEffect =
  | "reserveStock"          // allocateFEFO per line -> stock_reservations rows
  | "releaseReservations"   // delete this order's reservations
  | "consumeReservations"   // reservations -> DELIVERY_OUT movements (done in recordDelivery)
  | "createCreditApprovalTask"
  | "clearCreditHold"
  | "spawnBackorder"        // PARTIALLY_DELIVERED settle with shortfall -> new DRAFT order
  | "stampDelivered";       // orders.delivered_at = now
```

**Transitions** (one row per legal edge; anything not listed is a 409):

| from | action | to | roles | effects |
|---|---|---|---|---|
| DRAFT | submit | PENDING_REVIEW | salesperson, group_manager, owner | — |
| DRAFT | cancel | CANCELLED | salesperson, group_manager, owner | releaseReservations |
| PENDING_REVIEW | passReview | CONFIRMED | group_manager, owner | reserveStock |
| PENDING_REVIEW | flagCredit | PENDING_CREDIT | system | createCreditApprovalTask |
| PENDING_REVIEW | cancel | CANCELLED | group_manager, owner | releaseReservations |
| PENDING_CREDIT | approveCredit | CONFIRMED | group_manager, owner | clearCreditHold, reserveStock |
| PENDING_CREDIT | rejectCredit | ON_HOLD | group_manager, owner | — |
| ON_HOLD | releaseHold | CONFIRMED | group_manager, owner | clearCreditHold, reserveStock |
| ON_HOLD | cancel | CANCELLED | group_manager, owner | releaseReservations |
| CONFIRMED | plan | PLANNED | group_manager, owner, system | — |
| CONFIRMED | cancel | CANCELLED | group_manager, owner | releaseReservations |
| PLANNED | unplan | CONFIRMED | group_manager, owner, system | — |
| PLANNED | freeze | READY | group_manager, owner, system | — |
| READY | startRoute | OUT_FOR_DELIVERY | driver, group_manager, owner, system | — |
| READY | unplan | CONFIRMED | group_manager, owner | — |
| OUT_FOR_DELIVERY | deliver | DELIVERED | driver, system | consumeReservations, stampDelivered |
| OUT_FOR_DELIVERY | deliverPartial | PARTIALLY_DELIVERED | driver, system | consumeReservations, stampDelivered |
| OUT_FOR_DELIVERY | failDelivery | DELIVERY_FAILED | driver, system | releaseReservations |
| DELIVERY_FAILED | retryDelivery | PLANNED | group_manager, owner, system | — |
| DELIVERY_FAILED | cancel | CANCELLED | group_manager, owner | releaseReservations |
| DELIVERED | settle | CLOSED | system, group_manager, owner | — |
| DELIVERED | returnOrder | RETURNED | group_manager, owner | — |
| PARTIALLY_DELIVERED | settle | CLOSED | system, group_manager, owner | spawnBackorder |
| PARTIALLY_DELIVERED | returnOrder | RETURNED | group_manager, owner | — |

Exports: `ORDER_TRANSITIONS`, `orderTransition(from, action)`, `legalOrderActions(from, role)`, `canAdvanceOrder(from, action, role)`, `ORDER_STATUS_LABEL` (Persian), `ORDER_STATUS_TONE` (reuses `--good/--warn/--crit/--info` names as strings), `TERMINAL_ORDER_STATUSES`.

Pure module — **no DB import**, so it is unit-tested in isolation and safe to import from `lib/db.ts`-adjacent code without a cycle.

### 2.3 `order_type` and `priority`

`ALTER TABLE orders ADD COLUMN order_type TEXT NOT NULL DEFAULT 'SALE'` — values `SALE | SAMPLE | REPLACEMENT | RETURN`, enforced in `lib/repo/orders.ts` (not a CHECK — keeps the migration a plain ADD).
`ALTER TABLE orders ADD COLUMN priority TEXT NOT NULL DEFAULT 'NORMAL'` — `URGENT | KEY_ACCOUNT | NORMAL | FLEXIBLE`.
`ALTER TABLE orders ADD COLUMN offline INTEGER NOT NULL DEFAULT 0` — reserved for Phase 4; set but unused.

### 2.4 `order_events` — the audit trail

```sql
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,             -- NULL for the creation row
  to_status TEXT NOT NULL,
  action TEXT NOT NULL,         -- OrderAction, or 'create'
  actor_user_id INTEGER REFERENCES users(id),   -- NULL when action fired by 'system'
  reason_code_id INTEGER REFERENCES reason_codes(id),
  note TEXT,
  device_time TEXT,            -- the client's own clock, kept for divergence visibility
  created_at TEXT NOT NULL     -- server clock, authoritative
);
CREATE INDEX idx_order_events_order ON order_events(order_id, id);
```

Append-only. Every `advanceOrder` writes exactly one row; `createOrder` writes the `create` row (`from_status NULL`, `to_status 'DRAFT'`). Child of `orders` for tenancy (exempt set), but carries `organization_id` for cheap filtering — same call as `payment_allocations`.

### 2.5 `lib/repo/orders.ts` — `advanceOrder`

```ts
export function advanceOrder(
  organizationId: number,
  orderId: number,
  action: OrderAction,
  actor: { id: number | null; role: OrderRole },
  opts?: { reason_code_id?: number; note?: string; device_time?: string; db?: DatabaseSync }
): OrderStatus
```

- Loads the order (tenant-scoped; cross-tenant → `OrderError('سفارش پیدا نشد')`, surfaces as 404).
- `orderTransition(current, action)` — missing → `OrderError` listing `legalOrderActions(current, actor.role)`; route maps to **409**.
- Role check against `transition.roles` (`system` in the list means an internal caller passing `role:'system'` is allowed; a real user still needs their own role listed) → `OrderError` → 403… **no** — house rule is cross-tenant→404, but a legal-transition-wrong-role is a real 403 here. Keep 403 for role, 409 for illegal edge, 404 for cross-tenant/missing.
- Runs `transition.effects` in order (see §4), each inside the caller's transaction if `opts.db` is supplied, else opens its own `BEGIN IMMEDIATE`.
- `UPDATE orders SET status = ?, updated_at = ?` + one `order_events` row.
- Returns the new status.

Also: `orderEvents(orgId, orderId)` → rows with actor display-name joined; `legalActionsForOrder(orgId, orderId, role)` for the UI.

`makeRepo<OrderRow>("orders", { tenant: true })` gains `order_events` sibling access through a small raw helper kept in this file (added to `tests/fixtures/raw-sql-allowlist.txt`).

### 2.6 Migration — widen the CHECK

`orders.status` CHECK changes, so a table rebuild (house pattern, guarded on the CHECK text containing `PENDING_REVIEW`). Runs **before** the Phase 1 `credit_hold` ALTER block is fine — but simplest: put it right after the `rebuildForTenantUnique("orders", …)` call and keep that call's `createSql` in sync (add the new CHECK, `order_type`, `priority`, `offline`, `credit_hold`). Value map:

| old | new |
|---|---|
| `draft` | `DRAFT` |
| `confirmed` (no stop) | `CONFIRMED` |
| `confirmed` (on a `delivery_stops` row, stop `pending`) | `PLANNED` |
| `confirmed` (stop `delivered`) | `DELIVERED` |
| `delivered` | `DELIVERED` |
| `cancelled` | `CANCELLED` |

`credit_hold = 1` rows: if `status` maps to `DRAFT`/`CONFIRMED` and a `credit_approvals` row is `pending` → `PENDING_CREDIT`; if that row is `rejected` → `ON_HOLD`. Done as a follow-up `UPDATE` after the rebuild, guarded by the same marker.

A one-shot `backfillOrderEvents(db)` (pure SQL in `lib/db.ts`, `app_meta` `order_events_backfill_done`-guarded) writes a single synthetic `create` row per existing order (`action 'create'`, `to_status` = current status, `created_at` = `orders.created_at`, `actor_user_id` = `orders.created_by`) so the audit view is never blank for legacy rows. Called from `getDb()` after `backfillStockLedger`.

---

## 3. Delivery as its own entity (M6)

### 3.1 Tables

```sql
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  seq INTEGER NOT NULL DEFAULT 1,          -- 1st, 2nd… attempt/split for this order
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN
    ('PLANNED','ASSIGNED','LOADED','IN_TRANSIT','DELIVERED','PARTIAL','FAILED','RETURNED','CANCELLED')),
  route_stop_id INTEGER REFERENCES delivery_stops(id),
  planned_date TEXT,
  planned_arrival TEXT,
  actual_arrival TEXT,        -- server-set on receipt
  completed_at TEXT,          -- server-set on receipt
  fail_reason_id INTEGER REFERENCES reason_codes(id),
  delay_reason_id INTEGER REFERENCES reason_codes(id),
  receiver_name TEXT,
  signature_path TEXT,
  photo_path TEXT,
  gps_lat REAL,
  gps_lng REAL,
  collected_toman INTEGER NOT NULL DEFAULT 0,
  payment_id INTEGER REFERENCES payments(id),
  device_time TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (order_id, seq)
);
CREATE INDEX idx_deliveries_order ON deliveries(order_id, seq);
CREATE INDEX idx_deliveries_stop ON deliveries(route_stop_id);

CREATE TABLE delivery_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
  qty_planned REAL NOT NULL DEFAULT 0,
  qty_delivered REAL NOT NULL DEFAULT 0,
  qty_returned REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_delivery_lines_delivery ON delivery_lines(delivery_id);

CREATE TABLE reason_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = system default, visible to all
  domain TEXT NOT NULL CHECK (domain IN
    ('delivery_fail','delivery_delay','order_cancel','order_return')),
  code TEXT NOT NULL,
  label_fa TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, domain, code)
);
```

`delivery_line_batches` gains `delivery_id INTEGER REFERENCES deliveries(id)` (plain ADD, nullable). `delivery_stop_id` stays (also nullable now — a delivery may exist before its stop). New code writes both when a stop exists, `delivery_id` always.

`TENANT_TABLES` += `deliveries`, `reason_codes`. `delivery_lines` → exempt set (through `deliveries`). `order_events` → exempt set (through `orders`).

### 3.2 Seed reason codes

`seedReasonCodes(db)` — idempotent `INSERT OR IGNORE`, `organization_id NULL`, called from `getDb()` next to `seedFacilities`:

| domain | code | label_fa |
|---|---|---|
| delivery_fail | CUSTOMER_ABSENT | مشتری در محل نبود |
| delivery_fail | CUSTOMER_REFUSED | مشتری تحویل نگرفت |
| delivery_fail | ADDRESS_NOT_FOUND | آدرس پیدا نشد |
| delivery_fail | SHOP_CLOSED | مغازه تعطیل بود |
| delivery_fail | PAYMENT_DISPUTE | اختلاف بر سر مبلغ |
| delivery_delay | TRAFFIC | ترافیک سنگین |
| delivery_delay | VEHICLE_ISSUE | مشکل خودرو |
| delivery_delay | WEATHER | شرایط جوی |
| order_cancel | CUSTOMER_CANCELLED | مشتری لغو کرد |
| order_cancel | DUPLICATE | سفارش تکراری |
| order_cancel | STOCK_SHORTAGE | نبود موجودی |
| order_return | QUALITY_ISSUE | مشکل کیفی کالا |
| order_return | WRONG_ITEM | کالای اشتباه |

### 3.3 `lib/repo/deliveries.ts`

- `planDelivery(orgId, orderId, { route_stop_id, planned_date, db? })` → inserts a `deliveries` row (`seq` = max+1 for the order), snapshots `delivery_lines` from `order_lines` (`qty_planned = packs_ordered`), advances the order `plan` → `PLANNED` (idempotent: a second call for the same stop returns the existing row).
- `assignDelivery` / `loadDelivery` — set `deliveries.status` `ASSIGNED` / `LOADED` (route-desk bookkeeping; no order transition — the order is `PLANNED` until freeze).
- `markReady(orgId, orderId, actor, db?)` → order `freeze` → `READY`; `deliveries.status` → `LOADED` if not already past.
- `startDelivery(orgId, deliveryId, actor, db?)` → `deliveries.status` `IN_TRANSIT`, `actual_arrival = null` still; order `startRoute` → `OUT_FOR_DELIVERY`.
- `completeDelivery(orgId, deliveryId, actor, input, db?)` where `input = { outcome: 'delivered'|'partial'|'failed', lines?: {order_line_id, qty_delivered, qty_returned?}[], fail_reason_id?, delay_reason_id?, receiver_name?, gps_lat?, gps_lng?, device_time?, collected_toman?, notes? }`:
  - server sets `actual_arrival` (if null) and `completed_at` to `now`; stores `device_time` verbatim.
  - `delivered` → `deliveries.status DELIVERED`, write `delivery_lines.qty_delivered`, order `deliver` → `DELIVERED`.
  - `partial` → `deliveries.status PARTIAL`, order `deliverPartial` → `PARTIALLY_DELIVERED`.
  - `failed` → `fail_reason_id` **required** (`DeliveryError` if missing), `deliveries.status FAILED`, order `failDelivery` → `DELIVERY_FAILED`.
  - the order transition's `consumeReservations` + `stampDelivered` effects fire.
- `retryDelivery(orgId, deliveryId, actor, db?)` → order `retryDelivery` → `PLANNED`; a **new** `deliveries` row (`seq+1`, `PLANNED`), old one stays `FAILED` as the record.

### 3.4 Rewire `lib/delivery.ts`

`lib/delivery.ts` keeps its transaction shells and stays the driver-facing entry point; it now calls the repo:

- `addStop(db, runId, orderId, sortOrder)` — after inserting the `delivery_stops` row, calls `planDelivery(orgId, orderId, { route_stop_id: stopId, ..., db })`. Refuses unless the order is `CONFIRMED` (was: `!== 'draft' && !credit_hold`). `credit_hold` refusal message stays as a friendlier early check.
- A new `freezeRun(db, runId, actor)` marks every stop's order `READY` (called from the "شروع مسیر" path, or an explicit freeze button).
- `startRun` (exists) — also advances every `READY` order on the run to `OUT_FOR_DELIVERY` via `startDelivery`.
- `recordDelivery(db, input)` — the door event. Instead of `UPDATE orders SET status = 'delivered'|'cancelled'`, it:
  1. finds/creates the current `deliveries` row for the stop,
  2. calls `completeDelivery(orgId, deliveryId, {id: input.delivered_by, role:'driver'}, { outcome, lines, fail_reason_id, ... , db })` — `outcome` = `failed` when nothing taken, `partial` when some line short, else `delivered`,
  3. keeps its existing payment block (`recordPaymentTxn`, keyed to stop) and existing FEFO `DELIVERY_OUT` block — the latter is what `consumeReservations` defers to (reservations are matched to the movement, then deleted).
  4. On a fully-paid `DELIVERED`/`PARTIALLY_DELIVERED` order, fires `settle` → `CLOSED` (system).

`delivered_at` on `orders` is still written (by the `stampDelivered` effect) so `orderJourney` and every existing report keep working.

### 3.5 Server-side timestamps

`deliveries.actual_arrival` / `completed_at` are only ever `new Date().toISOString()` on the server. Any client-supplied time goes to `deliveries.device_time` / `order_events.device_time`. No API field named `completed_at` is accepted from the body.

---

## 4. Stock reservation (Phase 2 loose end)

```sql
CREATE TABLE stock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  batch_id INTEGER REFERENCES batches(id),   -- NULL = shortfall reservation (still recorded)
  base_qty REAL NOT NULL,                    -- positive
  released_at TEXT,                          -- non-NULL = no longer counts
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stock_reservations_order ON stock_reservations(order_id) WHERE released_at IS NULL;
CREATE INDEX idx_stock_reservations_batch ON stock_reservations(batch_id) WHERE released_at IS NULL;
```

`TENANT_TABLES` += `stock_reservations`.

In `lib/repo/stock.ts`:
- `reserveForOrder(orgId, orderId, db?)` — for each `order_line`, `allocateFEFO(orgId, product_id, packs_ordered * qty_per_pack, facilityId)` and insert one reservation row per returned slice (including the `batch_id: null` shortfall slice). Idempotent: if the order already has un-released reservations, no-op.
- `releaseForOrder(orgId, orderId, db?)` — `UPDATE stock_reservations SET released_at = now WHERE order_id = ? AND released_at IS NULL`.
- `consumeForOrder(orgId, orderId, db?)` — called from `recordDelivery` after the `DELIVERY_OUT` movements are written; just `releaseForOrder` (the movement is now the real record). Kept as its own name so the intent in the effect list reads correctly.
- `availableToPromise(orgId, { product_id, batch_id?, facility_id? })` = `onHand(...) - SUM(base_qty of un-released reservations matching the same filter)`.
- `allocateFEFO` gains an internal option to exclude quantity already reserved, so two orders confirmed back-to-back don't both grab the same units. `batchStock` / `stockLevels` gain an `available` field alongside `on_hand`.

`advancedStockPosition` / `/api/sales/stock` grow a `reserved` column (sum of un-released reservations per product) and `available = on_hand - reserved`.

---

## 5. `PENDING_CREDIT` auto-transition (Phase 1 loose end)

`createOrder` today: inserts `status 'draft'`, and if over-limit sets `credit_hold = 1` + `requestApproval`, leaving the order a draft. New flow:

- `createOrder` inserts `DRAFT` and writes the `order_events` `create` row. It **no longer** does the credit check inline.
- New `submitOrder(orgId, orderId, actor, db?)`:
  1. guard `orderComplete` — at least one non-reversal line, positive total → `OrderError` if not.
  2. `advanceOrder(… 'submit' …)` → `PENDING_REVIEW`.
  3. credit guard: rep → done. Direct customer with `credit_limit_toman` set and `balance + orderTotal > limit` → set `credit_hold = 1`, `advanceOrder(… 'flagCredit', role:'system')` → `PENDING_CREDIT`; the `createCreditApprovalTask` effect calls `requestApproval(...)` **and** inserts a `reminders` row (`CRITICAL`) addressed to the customer's group manager (mirrors the cheque-bounce reminder pattern from Phase 1).
  4. otherwise it stays `PENDING_REVIEW` for a human `passReview`.
- `creditApprovals.decide(orgId, id, verdict, decidedBy, reason)`:
  - `approved` → `advanceOrder(orgId, order_id, 'approveCredit', {id: decidedBy, role:'group_manager'})` → `CONFIRMED` (effect `clearCreditHold` replaces the current inline `UPDATE orders SET credit_hold = 0`; effect `reserveStock` runs).
  - `rejected` → `advanceOrder(… 'rejectCredit' …)` → `ON_HOLD`.
- `hard_credit_block` still refused at `createOrder` (unchanged).
- The existing "auto-confirm on submit for reps / under-limit" behaviour: `submitOrder` does **not** auto-confirm. A manager still clicks تأیید (`passReview`). Rationale: `passReview`'s `reserveStock` effect needs to be a deliberate act, and the plan's diagram has `PENDING_REVIEW` as a real stop. `order_type = 'SAMPLE'` is the one exception — samples skip credit and auto-`passReview` to `CONFIRMED` on submit (they carry no receivable).

---

## 6. API

New / changed routes (all under the existing `/api/sales` auth, role-checked against the transition's `roles`):

| route | method | action |
|---|---|---|
| `/api/sales/orders/[id]/transition` | POST `{action, reason_code_id?, note?, device_time?}` | generic `advanceOrder`; 409 with `{legal: [...]}` on illegal edge, 403 on wrong role |
| `/api/sales/orders/[id]/events` | GET | `orderEvents` |
| `/api/sales/orders/[id]` | PATCH | keeps working: `{status:'confirmed'}` from the board maps to `submit` then (manager) `passReview`; documented as legacy-compat |
| `/api/sales/reason-codes` | GET `?domain=` | list active, org + system |
| `/api/sales/deliveries` | GET `?order_id=` / `?run_id=` | list |
| `/api/sales/deliveries/[id]` | GET | one delivery + lines + events |
| `/api/sales/deliveries/[id]/complete` | POST | `completeDelivery` — server timestamps, never trusts body time |
| `/api/sales/deliveries/[id]/retry` | POST | `retryDelivery` |
| `/api/sales/stock` | GET | response rows gain `reserved`, `available` |

`proxy.ts`: `/api/sales/orders/*/transition` and `/api/sales/deliveries/*` follow the same rule as `/api/sales/orders` (salesperson+); the transition route's own role check is the real gate. `reason-codes` GET open to all non-driver sales roles + driver (the driver needs the fail list).

---

## 7. UI

- **`components/sales/orderStage.ts`** — `StageKey` extended: `draft, review, credit, hold, confirmed, planned, ready, on_route, delivered, closed, cancelled`. `stageOf(status)` becomes a straight map from `OrderStatus` (no more `onRun` bool — the status now says it). `moveRefusal` / `allowedTargets` rewritten off `legalOrderActions`.
- **`components/sales/OrderPipeline.tsx`** — columns follow the new stages; a card shows its `priority` chip and a `PENDING_CREDIT` card shows a red اعتبار badge.
- **`app/sales/orders/[id]/page.tsx`** — a "وضعیت" block with the legal-action buttons (`legalActionsForOrder`), each POSTing `/transition`; the `order_events` timeline underneath.
- **`components/sales/OrderJourney` / `lib/orderJourney.ts`** — `buildJourney` reads the new statuses: `confirmed` node true for `CONFIRMED` onward, `loaded` true for `PLANNED` onward, `settled` true for `CLOSED` (or `DELIVERED` with nothing owing). Add a fifth node `failed` shown only when status is `DELIVERY_FAILED`/`ON_HOLD`/`CANCELLED`/`RETURNED`.
- **`app/sales/board/page.tsx`** — new columns; drag rules from `allowedTargets`.
- **Driver** (`components/driver/DriverRun.tsx`) — the "تحویل نشد" path now needs a reason: a `<select>` of `delivery_fail` reason codes before the button enables.
- **`app/sales/deliveries/page.tsx`** (new) + `components/sales/DeliveriesPanel.tsx` — list of deliveries with attempt seq, status, reason, retry button for `FAILED`.
- **`app/sales/layout.tsx`** — nav tab «تحویل‌ها» (manager/owner).
- **`app/sales/stock/page.tsx`** — the table gains رزرو / قابل‌تخصیص columns.

---

## 8. Tenancy

- `TENANT_TABLES` += `deliveries`, `reason_codes`, `stock_reservations`.
- exempt set += `delivery_lines`, `order_events`.
- `tests/helpers/twoOrgs.ts` `OrgFixture` += `deliveryId`, `reasonCodeId`. `build()` seeds: one `reason_codes` row per org (domain `delivery_fail`, code `SHARED-RC` — colliding), one `deliveries` row per org against the fixture order, and an `order_events` `create` row per order. `seedReasonCodes` also runs (system rows, `organization_id NULL`).
- `tests/tenancy-isolation.test.ts` — new `it("keeps deliveries, order events and reason codes apart", …)`: no `deliveries` / `order_events` leak; the two `SHARED-RC` org rows stay 1-each per org; the system (`NULL`-org) reason codes are visible to both.
- `tests/tenancy-schema.test.ts` exempt set updated.

---

## 9. Migration safety / real-data check

`tests/order-pipeline-migration-realdata.test.ts` (env-gated on `ROUTEFLOW_MIGRATION_CHECK_DB`, `describe.skipIf`):

1. `PRAGMA foreign_key_check` empty after `getDb()`.
2. Every `orders.status` is a valid `OrderStatus`.
3. Row counts: `count(orders before)` == `count(orders after)`; no order lost or duplicated by the rebuild.
4. Every legacy order has ≥1 `order_events` row (the synthetic `create`).
5. `order_events_backfill_done` marker set.
6. `stock_reservations` empty (nothing confirmed by the migration — reservation is forward-only).

Pre-deploy checklist folded into `docs/HANDOFF-2026-09-02-phase-3-order-pipeline.md`.

---

## 10. Deviations anticipated

- `advanceOrder` uses **403** for a legal-edge/wrong-role (not the house 404-for-cross-tenant) — role refusal is a real authorization answer here and the UI needs to tell the two apart.
- `stock_reservations` is a table, not a derived quantity — a reservation is a *claim* (Phase 4 §4.5's own words), and a claim two writers can race needs a row a UNIQUE-ish guard and a transaction can arbitrate.
- `submitOrder` does not auto-confirm under-limit direct orders (except `SAMPLE`) — the plan's diagram makes `PENDING_REVIEW` a real stop and `passReview` carries the `reserveStock` effect.
- `delivery_line_batches` keeps `delivery_stop_id` (now nullable) alongside the new `delivery_id` rather than a hard rename — a rename needs every Phase 2 backfill row re-pointed and buys nothing while `delivery_stops` still exists.
