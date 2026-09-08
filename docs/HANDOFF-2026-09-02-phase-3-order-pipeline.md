# RouteFlow Phase 3 (Order Pipeline — M5 + M6) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-3-order-pipeline` (off `phase-2-stock`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-3-order-pipeline-design.md`
Plan: `docs/superpowers/plans/2026-09-02-phase-3-order-pipeline.md` (13 tasks, all done)

## What shipped

| Area | Detail |
|---|---|
| `lib/orderStateMachine.ts` | The single source of truth: 12 live + 2 terminal states, one `ORDER_TRANSITIONS` row per legal edge with `roles` and `effects`. `orderTransition`, `legalOrderActions`, `canAdvanceOrder`, `ORDER_STATUS_LABEL/TONE`, `TERMINAL_ORDER_STATUSES`, plus `FULFILLED_ORDER_STATUSES` / `PRICED_ORDER_STATUSES` / `sqlStatusList` for SQL consumers. Pure — no DB import. |
| `orders.status` migration | `rebuildOrdersStatusMachine(db)` — guarded table rebuild (CHECK text names `PENDING_REVIEW`), runs after the Phase 1 `credit_hold` ALTER. Value map: `draft→DRAFT`, `cancelled→CANCELLED`, `delivered→DELIVERED`, `confirmed`→`DELIVERED`/`PLANNED`/`CONFIRMED` by its `delivery_stops` state; then `credit_hold=1` rows reconcile against `credit_approvals` (`pending→PENDING_CREDIT`, `rejected→ON_HOLD`). New cols `order_type` (`SALE/SAMPLE/REPLACEMENT/RETURN`, no CHECK), `priority`, `offline` (Phase 4, unused). |
| `order_events` | Append-only audit trail (`from_status` NULL for the `create` row, `to_status`, `action`, `actor_user_id`, `reason_code_id`, `note`, `device_time` beside the server `created_at`). Child of `orders` (exempt set) but carries `organization_id`. `backfillOrderEvents(db)` gives every legacy order one synthetic `create` row. |
| `lib/repo/orders.ts` | `advanceOrder(orgId, orderId, action, actor, opts?)` — load tenant-scoped (**404** `OrderError`), illegal edge → **409** `OrderTransitionError` (`.legal`), legal edge/wrong role → **403** `OrderRoleError`; runs effects (`reserveStock`/`releaseReservations`/`consumeReservations`/`clearCreditHold`/`stampDelivered` inline; `createCreditApprovalTask`/`spawnBackorder` via `registerOrderEffectHandlers`); `UPDATE orders.status` + one `order_events` row; joins `opts.db` or opens `BEGIN IMMEDIATE`. `orderEvents`, `legalActionsForOrder`, `appendOrderEvent`. `OrderError` is now defined here and re-exported from `lib/orders.ts`. |
| Credit (`PENDING_CREDIT` wiring) | `createOrder` inserts `DRAFT` + a `create` event and does **no** credit check. `submitOrder(orgId, orderId, actor)` — `orderComplete` guard → `advanceOrder('submit')`; rep or `SAMPLE` auto-`passReview` → CONFIRMED; over-limit direct customer → `credit_hold=1` + `requestApproval` + `advanceOrder('flagCredit', system)` → PENDING_CREDIT (effect drops the manager `reminders` row). `creditApprovals.decide` → `advanceOrder('approveCredit')` (→ CONFIRMED, clears hold, reserves stock) / `'rejectCredit'` (→ ON_HOLD). `confirmOrder(db, id)` is now a submit-then-`passReview` wrapper. |
| Reservation (Phase 2 loose end) | `stock_reservations` table; `lib/repo/stock`: `reserveForOrder` (FEFO slices, idempotent, shortfall as `batch_id NULL`), `releaseForOrder`, `consumeForOrder` (= release), `reservedQty`, `availableToPromise`. `allocateFEFO` gains `{ excludeReserved }`. `batchStock`/`stockLevels` gain `available` (and `stockLevels` a `reserved`). `/api/sales/stock` rows gain `reserved` + `available`. |
| Delivery entity (M6) | `deliveries` (9-state, `UNIQUE (order_id, seq)`, server-set `actual_arrival`/`completed_at`, `device_time`), `delivery_lines` (planned/delivered/returned per line), `delivery_line_batches` gains nullable `delivery_id`. `reason_codes` (13 system defaults, `organization_id NULL`, `seedReasonCodes`). `lib/repo/deliveries.ts`: `planDelivery` (row + line snapshot + order → PLANNED, idempotent per stop), `markReady`, `retryDelivery` (fresh row at `seq+1`), `deliveryForStop`, `readDelivery`, `listDeliveries`, and the `spawnBackorder` effect (partial settle → DRAFT for the shortfall at the frozen price). |
| `lib/delivery.ts` rewire | `addStop` plans a delivery (order → PLANNED). `recordDelivery` walks the order `plan → freeze → startRoute` as `system` then fires `deliver` / `deliverPartial` / `failDelivery` as `driver`, keeps the payment + FEFO blocks, updates the `deliveries` row + `delivery_lines` (server timestamps), and settles a fully-paid order to `CLOSED`. New `completeDelivery(orgId, deliveryId, actor, input)` is the API door event (base-unit line qtys, `failed` needs a `fail_reason_id`, body time → `device_time` only). |
| Routes | `POST /api/sales/orders/[id]/transition` (409 `{legal}` / 403 / 404), `GET .../events`, `GET`+`POST /api/sales/reason-codes`, `GET /api/sales/deliveries` (+ `/[id]`), `POST /api/sales/deliveries/[id]/complete` + `/retry`. `proxy.ts` gates `/sales/deliveries` + `/api/sales/deliveries` to owner/manager; `/reason-codes` open to driver too. |
| UI | `components/sales/orderStage.ts` maps the 14 states onto the 4 board lanes + `isPreConfirm`/`isFulfilled`/`statusLabel`. `OrderStatusPanel` (client) on the order page: legal-action buttons → `/transition` + the `order_events` timeline. New `/sales/deliveries` board. «تحویل‌ها» nav tab. Sales dashboards / runs / orders list / detail read the machine vocabulary. |
| Tenancy | `TENANT_TABLES` += `deliveries`, `reason_codes`, `stock_reservations`; exempt set += `order_events`, `delivery_lines`. The two `organization_id IS NULL → 1` backfill sweeps skip `reason_codes` (its NULLs are the shared system rows). `twoOrgs` seeds a `deliveries` row, a `SHARED-RC` reason code and a `create` event per org; `tenancy-isolation` asserts no leak and that the system reason codes are shared. |

Suite: 135 files / 1339 tests green (+1 skipped). `npx tsc --noEmit` and `npx eslint app/ lib/` clean. (`tests/jalali.test.ts` "agrees with Intl for every day across 20 Jalali years" flaked once under full-suite parallelism and passes in isolation and on re-run — unrelated to this phase.)

## Deviations from the plan

- **`advanceOrder` uses HTTP 403** for a legal-edge/wrong-role (not the house 404-for-cross-tenant). A role refusal is a real authorization answer and the UI needs to tell it apart from "no such order" (404) and "illegal move" (409).
- **`orders.status` base-table CHECK kept at the pre-Phase-3 four values**; the widening + new columns happen only in `rebuildOrdersStatusMachine`, so a pre-tenancy backup's `rebuildForTenantUnique` copy still validates before the value map runs. The base `CREATE TABLE` and `rebuildForTenantUnique("orders")` `createSql` were reverted to their original text.
- **`submitOrder` does not auto-confirm** an under-limit direct order (except `SAMPLE`) — `PENDING_REVIEW` is a real stop and `passReview` carries the `reserveStock` effect.
- **`recordDelivery` collapses `plan`/`freeze`/`startRoute`** into itself as `system` steps (each still writes its own `order_events` row) — there is no separate "freeze run" / "start route" UI yet.
- **`delivery_line_batches` keeps `delivery_stop_id`** (now nullable) alongside the new `delivery_id`; `recordDelivery` still writes rows keyed to the stop. A hard rename buys nothing while `delivery_stops` exists.
- **`stock_reservations` is a table**, not a derived quantity — a reservation is a claim two writers can race.
- **`spawnBackorder` copies the frozen price snapshot** into the new DRAFT rather than re-resolving today's price.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API (never `cp` — WAL).
2. Against a copy:
   `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/order-pipeline-migration-realdata tests/stock-migration-realdata tests/tenancy-schema tests/customer-opening-balance-migration tests/legacy-payment-backfill` — confirm `foreign_key_check` empty, every `orders.status` a valid `OrderStatus`, order count unchanged, every order has ≥1 `order_events` row, `order_events_backfill_done` set, `stock_reservations` empty.
3. `npm run build` + `systemctl restart routeflow`.

## Next: Phase 4 — Offline-first

Per `docs/crm-erp-plan.md` Part 5 §4.5: `client_uuid` + `sync_mutations` + tombstones, IndexedDB outbox, sync engine, service-worker write queue, the undo bar wired to the outbox hold, sync-status island, conflict surface. The `orders.offline` column defined here is its flag. The 12-state machine's offline-safety table (§4.5) decides what may queue: `create/edit DRAFT` and `submit` yes; `approve`, `plan`, `freeze` no; driver door events yes. Branch off `phase-3-order-pipeline`.
