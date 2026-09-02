# RouteFlow Phase 2 (Stock & Batches) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-2-stock` (off `phase-1-money`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-2-stock-batches-design.md`
Plan: `docs/superpowers/plans/2026-09-02-phase-2-stock-batches.md` (10 tasks, all done)

## What shipped

| Area | Detail |
|---|---|
| `stock_movements` | Signed, append-only ledger. Kinds `PURCHASE_IN / DELIVERY_OUT / TRANSFER_* / SAMPLE_OUT / RETURN_IN / ADJUSTMENT / COUNT / WRITE_OFF`. **On-hand is `SUM(base_qty)`** filtered by any of product / batch / facility — still derived, may go negative. `lib/repo/stock.ts`: `recordMovement(sTxn)`, `onHand`, `batchStock`, `allocateFEFO`, `defaultFacilityId` (warehouse → home_base → first; lazily creates one if a tenant has none), `stockLevels`, `listMovements`. |
| `batches` | code, `supplier_batch_ref`, `purchase_line_id`, `produced_at`, `expiry_date`, `qty_received_base`, `unit_cost_toman`, status. `UNIQUE (organization_id, product_id, batch_code)`. `lib/batchStates.ts` allows `active ↔ quarantined`, `→ recalled`, `depleted → active`; `expired`/`depleted` are written only by `sweepBatchStatuses` (every boot). `createBatchTxn` auto-codes `YYMMDD-n` per product+date and defaults `expiry_date` to `produced_at + products.shelf_life_days` (new nullable column). A recall raises a `reminders` row per customer that received the lot. `expiringBatches` windows on `max(7, shelf*0.25)` (flat 14 when no shelf life). `batchTrace` = forward (purchase line + delivering customers). |
| `products.shelf_life_days` | New nullable `INTEGER`. Folded into the per-tenant products rebuild's `createSql`. |
| `recordPurchase` | Per line: `createBatchTxn` (+ optional `batch_code` / `supplier_batch_ref` / `produced_at` / `expiry_date` on `PurchaseLineInput`) + a `PURCHASE_IN` movement, inside the existing transaction. Moving-average cost roll unchanged. |
| `recordDelivery` | Per delivered line: `allocateFEFO` → negative `DELIVERY_OUT` movements + `delivery_line_batches` rows. Idempotent on the stop — a retried sync deletes and re-writes these machine-generated rows. A shortfall (oversell) is a `batch_id = NULL` movement so on-hand still goes negative. |
| `stockPosition` / `advancedStockPosition` | On-hand now reads `stock_movements`. Advanced rows gain `earliest_expiry` + `expiring_count` (flat 30-day count; the precise window is `expiringBatches` / `/stock/expiry`). |
| `backfillStockLedger` | One-shot, `app_meta` `stock_ledger_backfill_done`-guarded, **pure SQL in `lib/db.ts`** (avoids a `db.ts ↔ lib/repo` import cycle). Every `purchase_line` → `LEGACY-PL<id>` batch + `PURCHASE_IN`; every delivered `order_line` → oldest-batch-first `DELIVERY_OUT` (+ `delivery_line_batches` where a stop exists). **Verified on `data/backups/pre-tenancy-20260901-224428.db`: `foreign_key_check` empty, `SUM(stock_movements.base_qty)` per product equals the legacy `purchased − delivered` for every product.** |
| `quality_complaints` | `lib/repo/complaints.ts`: `fileComplaint` (infers `batch_id` from the delivered order line), `updateComplaint` (stamps `resolved_at/by`), `listComplaints`, `complaintClusters` (≥ 2 unresolved on a batch in 30 days), `backwardTrace` (complaint → order → batch → purchase line → supplier ref). |
| Routes | `/api/sales/batches` (GET list/`?expiring=1`, POST), `/api/sales/batches/[id]` (GET, PATCH `{action:'status',to}`), `/api/sales/batches/[id]/trace` (GET), `/api/sales/stock/movements` (GET, POST — manual kinds only; `PURCHASE_IN`/`DELIVERY_OUT` rejected), `/api/sales/stock/expiry` (GET — batches + clusters), `/api/sales/complaints` (GET, POST), `/api/sales/complaints/[id]` (GET + backward trace, PATCH). `/api/sales/stock` gains `earliest_expiry` per row + `expiring_count`. Cross-tenant → 404; illegal batch status / duplicate code → 409. |
| UI | `/sales/batches` (create + status buttons + inline forward trace) and `/sales/complaints` (file + cluster banner + manager status control). `proxy.ts` gates `/sales/batches` + `/api/sales/batches` + `/api/sales/stock/movements` to owner/manager (like `/sales/cheques`); `/sales/complaints` stays open to all non-drivers. `/sales/stock` grows an انقضا section; `CustomerDetailPanel` gets a ثبت شکایت کیفی link. Nav tabs «بچ‌ها», «شکایات». |
| Tenancy | `batches`, `stock_movements`, `delivery_line_batches`, `quality_complaints` on `TENANT_TABLES`. `twoOrgs` seeds a facility + batch (`SHARED-BATCH`) + `PURCHASE_IN` + complaint per org; `tenancy-isolation` asserts no leak and the per-tenant `UNIQUE` on `batch_code` holds. |

Suite: 123 files / 1266 tests green (+1 skipped). `npx tsc --noEmit` and `npx eslint app/ lib/` clean.

## Deviations from the plan

- **`backfillStockLedger` is pure SQL in `lib/db.ts`**, not the `lib/repo` helpers the plan sketched — importing `lib/repo/*` into `lib/db.ts` is a cycle (`repo/base` imports `getDb`). The FEFO-lite allocation is reimplemented inline against undated legacy batches (effectively FIFO by `purchase_line_id`).
- **`defaultFacilityId` lazily creates a warehouse** for a tenant with no facility (synthetic `lat/lng` 0,0). Several tests seed users/orgs without a facility; a `PURCHASE_IN` needs one. Matches the source brief ("make the warehouse independent even with one").
- **FEFO runs at delivery, not confirm.** Confirm-time reservation (`reserveStock`) is the 12-state machine's job — Phase 3.
- **`recordPurchase` / `recordDelivery` default a NULL `organization_id` to 1** for the batch/movement writes (NOT NULL columns; only hand-seeded test rows hit this — same precedent as Phase 1).

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API (never `cp` — WAL).
2. Against a copy: `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/stock-migration-realdata tests/tenancy-schema tests/customer-opening-balance-migration tests/legacy-payment-backfill` — confirm `foreign_key_check` empty, `stock_ledger_backfill_done` set, per-product on-hand `SUM(stock_movements.base_qty)` equals legacy `purchased − delivered`.
3. `npm run build` + `systemctl restart coverage-map`.

## Next: Phase 3 — Order pipeline

Per `docs/crm-erp-plan.md` Part 5: M5 the 12-state order machine (`DRAFT → … → DELIVERED`, reason codes, `PENDING_CREDIT` auto-transition wiring the Phase 1 `credit_hold`), M6 the `deliveries` table (which `delivery_line_batches.delivery_stop_id` will be renamed to reference), sample orders end to end. Branch off `phase-2-stock`.
