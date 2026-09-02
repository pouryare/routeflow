# Phase 3 — Order Pipeline Implementation Plan

> **For agentic workers:** execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** Replace the 4-value `orders.status` with an explicit 12+2-state machine; give delivery its own entity; wire `PENDING_CREDIT` and confirm-time stock reservation.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-3-order-pipeline-design.md`

## Global Constraints

- Money = whole Toman `INTEGER`. Quantities = `REAL` base units. Dates ISO stored, Jalali shown.
- Persian user-facing text, English identifiers. Cross-tenant row → 404; legal-edge/wrong-role → 403; illegal edge → 409.
- Migrations idempotent, guarded (`PRAGMA table_info` / CHECK text / `app_meta` marker); table-rebuild where a CHECK changes.
- New DB access via `lib/repo/`; raw SQL outside the allowlist fails `tests/repo-boundary.test.ts`.
- Never commit to `main`. Never `npm run build` / `systemctl restart`. Tests use temp `COVERAGE_DB_PATH`.
- Vitest in background + poll. eslint: `npx eslint app/ lib/` + per-file (full repo OOMs). After route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/orderStateMachine.ts` — the transition table

**Files:** Create `lib/orderStateMachine.ts`, `tests/order-state-machine.test.ts`.

- Test: every `OrderStatus` reachable from `DRAFT` except by design; `orderTransition("DRAFT","submit").to === "PENDING_REVIEW"`; `orderTransition("DRAFT","deliver")` undefined; `legalOrderActions("OUT_FOR_DELIVERY","driver")` = `["deliver","deliverPartial","failDelivery"]`; `canAdvanceOrder("PENDING_CREDIT","approveCredit","salesperson")` false, `"group_manager"` true; `ORDER_STATUS_LABEL` covers all 14; `TERMINAL_ORDER_STATUSES` = `{CLOSED,CANCELLED,RETURNED}`.
- Implement per spec §2.2. Pure, no imports from `lib/db` or `lib/repo`.
- Commit.

### Task 2: schema — widen `orders.status`, add columns, `order_events`

**Files:** Modify `lib/db.ts`, `tests/orders-schema.test.ts`; Create `tests/order-events-schema.test.ts`.

- Add `order_type`/`priority`/`offline` ALTERs (guarded on column absence), next to the `credit_hold` block.
- New rebuild `rebuildOrdersStatusMachine(db)` guarded on `orders` CHECK text containing `PENDING_REVIEW`: `PRAGMA foreign_keys=OFF; BEGIN; CREATE orders_sm_new (… full new CHECK, order_type, priority, offline, credit_hold, UNIQUE(organization_id, order_no)); INSERT … SELECT … CASE` value map (spec §2.6, incl. the `delivery_stops` join for `confirmed`→`PLANNED`/`DELIVERED`); `DROP`; `RENAME`; recreate the 3 indexes; `COMMIT`.
- Follow-up guarded `UPDATE`: `credit_hold=1` + pending approval → `PENDING_CREDIT`; + rejected approval → `ON_HOLD`.
- Keep the `rebuildForTenantUnique("orders", …)` `createSql` in sync (new CHECK + 4 new columns) so a fresh DB and a migrated DB converge.
- `order_events` table in the main schema block (after `order_lines`). `TENANT_TABLES` unchanged for it (child); add to `tests/tenancy-schema.test.ts` exempt set.
- `backfillOrderEvents(db)` — pure SQL, `order_events_backfill_done`-guarded: one `create` row per order. Call from `getDb()` after `backfillStockLedger`.
- `tests/orders-schema.test.ts`: expected columns += `order_type,priority,offline`; status CHECK accepts `PENDING_REVIEW`, rejects `foo`.
- `tests/order-events-schema.test.ts`: table exists, FK to orders, append works.
- Run full suite — fix any `status`-string test breakage caused by the rebuild's fresh-DB `createSql` (a fresh test DB now starts orders at the new CHECK; existing tests inserting `status:'confirmed'` will need `'CONFIRMED'`). Grep `tests/` for `status: *['"](draft|confirmed|delivered|cancelled)` and translate.
- Commit.

### Task 3: `reason_codes` + seed + `lib/repo/reasonCodes.ts`

**Files:** Modify `lib/db.ts` (`reason_codes` table, `seedReasonCodes`, `TENANT_TABLES`); Create `lib/repo/reasonCodes.ts`, `tests/reason-codes.test.ts`; Modify `tests/tenancy-schema.test.ts` won't need change (it's on `TENANT_TABLES`).

- `reason_codes` per spec §3.1. `seedReasonCodes(db)` — `INSERT OR IGNORE`, `organization_id NULL`, the 13 rows from §3.2. Call from `getDb()` by `seedFacilities`.
- `lib/repo/reasonCodes.ts`: `reasonCodesRepo` (`makeRepo`, tenant), `listReasonCodes(orgId, domain?)` → org rows + `organization_id IS NULL` system rows, `active = 1`; `createReasonCode`, `deactivateReasonCode`.
- `TENANT_TABLES` += `reason_codes`; `twoOrgs` NULL-org tolerance in `reasonCodesRepo` reads (system rows).
- Tests: seed present; `listReasonCodes(1,'delivery_fail')` includes `CUSTOMER_ABSENT`; a tenant row + a system row both returned; other org's row not.
- Commit.

### Task 4: `deliveries` + `delivery_lines` tables

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/deliveries-schema.test.ts`.

- Tables per spec §3.1 in the main schema block after `delivery_stops`. `delivery_line_batches` gains `delivery_id` (guarded ADD). `TENANT_TABLES` += `deliveries`. exempt set += `delivery_lines`.
- Schema test: tables + indexes + `UNIQUE(order_id, seq)` + FK checks; `delivery_line_batches` has `delivery_id`.
- Commit.

### Task 5: `stock_reservations` + `lib/repo/stock.ts` reservation fns

**Files:** Modify `lib/db.ts` (`stock_reservations`, `TENANT_TABLES`), `lib/repo/stock.ts`; Create `tests/stock-reservations.test.ts`.

- `stock_reservations` per spec §4. `TENANT_TABLES` += `stock_reservations`.
- `lib/repo/stock.ts`: `reserveForOrder`, `releaseForOrder`, `consumeForOrder` (= release), `availableToPromise`. `allocateFEFO` gains `{ excludeReserved?: boolean }` — when set, subtract un-released reservation qty per batch before picking. `batchStock`/`stockLevels` rows gain `available`.
- Tests: reserve an order with 2 lines against 2 batches → 2 reservation rows, `availableToPromise` drops by the reserved qty; `reserveForOrder` twice = idempotent; `releaseForOrder` restores `availableToPromise`; a reservation exceeding stock produces a `batch_id NULL` shortfall row.
- Commit.

### Task 6: `lib/repo/orders.ts` — `advanceOrder`, `order_events`

**Files:** Create `lib/repo/orders.ts`, `tests/order-advance.test.ts`; Modify `tests/fixtures/raw-sql-allowlist.txt`.

- `advanceOrder(orgId, orderId, action, actor, opts?)` per spec §2.5 — load (tenant, 404), `orderTransition` (409 semantics via `OrderError` subclass `OrderTransitionError` carrying `.legal`), role check (`OrderRoleError`), run effects, `UPDATE orders`, one `order_events` row. `opts.db` → join caller txn, else `BEGIN IMMEDIATE`.
- Effects dispatch table: `reserveStock`→`reserveForOrder`, `releaseReservations`→`releaseForOrder`, `consumeReservations`→`consumeForOrder`, `clearCreditHold`→`UPDATE orders SET credit_hold=0`, `createCreditApprovalTask`→(delegated; see Task 8 — here a no-op stub that Task 8 fills), `spawnBackorder`→(stub, Task 9), `stampDelivered`→`UPDATE orders SET delivered_at=COALESCE(delivered_at, now)`.
- `orderEvents(orgId, orderId)`, `legalActionsForOrder(orgId, orderId, role)`.
- Tests: `DRAFT --submit--> PENDING_REVIEW` writes an event; illegal `DRAFT --deliver` throws `OrderTransitionError` with `.legal` listing `submit,cancel`; wrong role throws `OrderRoleError`; cross-tenant order → `OrderError` (404 text); `passReview` from `PENDING_REVIEW` creates `stock_reservations`.
- Commit.

### Task 7: `createOrder` writes `DRAFT` + `order_events`; `submitOrder`

**Files:** Modify `lib/orders.ts`, `tests/orders.test.ts`; Create `tests/order-submit.test.ts`.

- `createOrder`: `INSERT … status 'DRAFT'`; drop the inline credit check; write the `create` `order_events` row inside the txn. `confirmOrder` (legacy) → thin wrapper calling `submitOrder` then, if still `PENDING_REVIEW` and caller is manager/owner, `advanceOrder('passReview')` — keeps `PATCH {status:'confirmed'}` working.
- `submitOrder(orgId, orderId, actor, db?)` per spec §5: `orderComplete` guard, `advanceOrder('submit')`, credit branch (rep/`SAMPLE`→ if manager auto-`passReview`; over-limit → `credit_hold=1` + `advanceOrder('flagCredit', system)`).
- Tests: under-limit order → `submitOrder` leaves it `PENDING_REVIEW`; over-limit → `PENDING_CREDIT` + a `credit_approvals` pending row; `SAMPLE` → `CONFIRMED`; empty order → `OrderError`.
- Fix `tests/orders.test.ts` status-string expectations.
- Commit.

### Task 8: `createCreditApprovalTask` effect + `creditApprovals.decide` drives state

**Files:** Modify `lib/repo/orders.ts` (fill the effect), `lib/repo/creditApprovals.ts`, `tests/order-credit-hold.test.ts`; Create `tests/credit-approval-state.test.ts`.

- `createCreditApprovalTask` effect: `requestApproval(...)` + insert a `reminders` row (`kind`/`severity` matching the Phase 1 cheque-bounce reminder; addressed to the customer's group manager). Guard: skip if a pending `credit_approvals` row already exists for the order.
- `decide`: `approved` → `advanceOrder(orgId, order_id, 'approveCredit', {id: decidedBy, role:'group_manager'})`; `rejected` → `advanceOrder('rejectCredit', …)`. Remove the inline `UPDATE orders SET credit_hold = 0` (now the `clearCreditHold` effect).
- Tests: approve → order `CONFIRMED`, `credit_hold = 0`, `stock_reservations` present, a `reminder` was created at flag time; reject → `ON_HOLD`; `releaseHold` → `CONFIRMED`.
- Commit.

### Task 9: `lib/repo/deliveries.ts` + rewire `lib/delivery.ts`

**Files:** Create `lib/repo/deliveries.ts`, `tests/deliveries-repo.test.ts`; Modify `lib/delivery.ts`, `tests/delivery.test.ts`, `tests/delivery-payment.test.ts`, `tests/delivery-batches.test.ts`.

- `lib/repo/deliveries.ts` per spec §3.3: `planDelivery`, `assignDelivery`, `loadDelivery`, `markReady`, `startDelivery`, `completeDelivery`, `retryDelivery`, `listDeliveries`, `readDelivery`. `spawnBackorder` effect (from Task 6 stub) implemented here and imported back — or kept in `lib/repo/orders.ts` reading `delivery_lines`; put it in `orders.ts` to avoid a cycle, reading `delivery_lines.qty_planned - qty_delivered` per line → new `DRAFT` order.
- `lib/delivery.ts`: `addStop` requires `CONFIRMED`, calls `planDelivery(… db)`. `startRun` advances `READY` orders → `OUT_FOR_DELIVERY` via `startDelivery`. New `freezeRun(db, runId, actor)` → `markReady` per stop. `recordDelivery` routes status through `completeDelivery` (outcome computed from lines: none→`failed` w/ a default `CUSTOMER_REFUSED` reason if none supplied, some-short→`partial`, else `delivered`), keeps payment + FEFO blocks, then `settle`→`CLOSED` when nothing owed.
- Tests: `planDelivery` creates a `deliveries` + N `delivery_lines`, order → `PLANNED`; `completeDelivery('failed', fail_reason_id)` → order `DELIVERY_FAILED`, delivery `FAILED`; `retryDelivery` → new `deliveries` seq 2, order `PLANNED`; `recordDelivery` full → order `CLOSED`, `deliveries` `DELIVERED`, reservations released; idempotent retry unchanged.
- Fix the 3 existing delivery test files (status strings, `beforeEach` DELETE order for new tables).
- Commit.

### Task 10: consumers — `orderStage.ts`, `orderJourney.ts`, dashboards, reports

**Files:** Modify `components/sales/orderStage.ts`, `lib/orderJourney.ts`, `lib/dashboard.ts`, `lib/customerSummary.ts`, `lib/commissionLedger.ts`, `lib/driverCommissionLedger.ts`, `lib/purchases.ts`, `lib/repo/payments.ts`, and their tests (`tests/orderStage.test.ts`, `tests/orderJourney.test.ts`, `tests/dashboard.test.ts`, `tests/debt-consumers.test.ts`, `tests/customer-debt.test.ts`, `tests/commission*.test.ts` as needed).

- Grep every `'confirmed'|'delivered'|'cancelled'|'draft'` literal in `app/ lib/ components/` and translate to the new vocabulary. `delivered`-means-fulfilled checks become `status IN ('DELIVERED','PARTIALLY_DELIVERED','CLOSED','RETURNED')`; `confirmed`-means-priced becomes `status NOT IN ('DRAFT','PENDING_REVIEW','PENDING_CREDIT','ON_HOLD','CANCELLED')`.
- `orderStage.ts`: new `StageKey` union + `stageOf(status)` straight map + `moveRefusal`/`allowedTargets` off `legalOrderActions`.
- `orderJourney.ts`: `buildJourney` node predicates on new statuses + a `failed` node.
- Run full suite; fix breakage.
- Commit.

### Task 11: API routes

**Files:** Create `app/api/sales/orders/[id]/transition/route.ts`, `app/api/sales/orders/[id]/events/route.ts`, `app/api/sales/reason-codes/route.ts`, `app/api/sales/deliveries/route.ts`, `app/api/sales/deliveries/[id]/route.ts`, `app/api/sales/deliveries/[id]/complete/route.ts`, `app/api/sales/deliveries/[id]/retry/route.ts`; Modify `app/api/sales/orders/[id]/route.ts`, `app/api/sales/stock/route.ts`, `proxy.ts`; Create `tests/api/order-transition-route.test.ts`, `tests/api/deliveries-route.test.ts`, `tests/api/reason-codes-route.test.ts`.

- `transition`: parse `{action, reason_code_id?, note?, device_time?}`; `advanceOrder`; map `OrderTransitionError`→409 `{error, legal}`, `OrderRoleError`→403, missing/cross-tenant→404.
- `deliveries/[id]/complete`: never read a body `completed_at`; server stamps. Body time → `device_time`.
- `stock` route: add `reserved`/`available` to each row.
- `proxy.ts`: `/api/sales/orders/*/transition`, `/api/sales/deliveries/*` → salesperson+ ; `/api/sales/reason-codes` → + driver.
- `npx next typegen && rm -rf .next/dev/types`.
- Tests: illegal edge → 409 + `legal`; wrong role → 403; happy path advances + returns new status; `complete` ignores body time; cross-tenant → 404.
- Commit.

### Task 12: UI

**Files:** Modify `components/sales/OrderPipeline.tsx`, `app/sales/board/page.tsx`, `app/sales/orders/[id]/page.tsx`, `components/driver/DriverRun.tsx`, `app/sales/layout.tsx`, `app/sales/stock/page.tsx`; Create `app/sales/deliveries/page.tsx`, `components/sales/DeliveriesPanel.tsx`, `components/sales/OrderStatusPanel.tsx`.

- `OrderStatusPanel` — legal-action buttons + `order_events` timeline; POSTs `/transition`.
- Pipeline columns + priority chip + credit badge.
- Driver "تحویل نشد" needs a reason `<select>` (fail codes from `/api/sales/reason-codes?domain=delivery_fail`).
- Deliveries page: seq, status, reason, retry.
- Stock page: رزرو / قابل‌تخصیص columns.
- nav tab «تحویل‌ها».
- eslint per-file (Fragment key pattern, `react-hooks/set-state-in-effect` disable comment as in Phase 1/2 panels).
- Commit.

### Task 13: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/order-pipeline-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-3-order-pipeline.md`; update memory `routeflow-phase-progress`.

- `twoOrgs`: `OrgFixture` += `deliveryId`, `reasonCodeId`; seed a `reason_codes` (`SHARED-RC`), a `deliveries` row, an `order_events` `create` row per org.
- `tenancy-isolation`: new `it` for deliveries / order_events / reason codes; system reason codes visible to both.
- Real-data test per spec §9 (env-gated). Run it against a copy of `data/backups/pre-tenancy-20260901-224428.db`.
- Full suite green, `npx tsc --noEmit`, `npx eslint app/ lib/`.
- `docs/crm-erp-plan.md` Part 5 row 3 → ✅ DONE (branch, date, unmerged).
- Handoff doc: what shipped, deviations, pre-deploy checklist, next = Phase 4.
- Commit.
