# RouteFlow Phase 1 (Money) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-1-money` (off `phase-0b-foundations`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-1-money-design.md`
Plan: `docs/superpowers/plans/2026-09-02-phase-1-money.md` (14 tasks, all done)

## What shipped

| Area | Detail |
|---|---|
| `payments` | Append-only ledger. Methods `CASH/POS/CARD_TO_CARD/CHEQUE/CREDIT_NOTE/OTHER`. `receipt_photo_stem` for POS/card. `delivery_stop_id` keys a door collection so a retried sync converges. A mistake is `voided_at` + a fresh row, never an edit. |
| `payment_allocations` | Reaches a tenant through `payments` (exempt). `order_id NULL` = on account. `recordPayment` auto-splits FIFO over the customer's oldest unpaid **delivered** orders; the caller can pass an explicit split. |
| `orders.paid_toman` | Now a cache. `recomputeOrderPayment` sets it + `payment_status` from live, non-voided allocations. `recordDelivery` no longer stamps it — a door collection becomes a `CASH` payment allocated to the order. |
| Legacy backfill | `backfillLegacyPayments` (guarded on `app_meta` `legacy_payment_backfill_done`): every pre-Phase-1 order with `paid_toman > 0` and no allocation gets one synthetic `CASH` payment, capped at the order's line total. |
| `cheques` | Full lifecycle as `lib/chequeStates.ts` (`CHEQUE_TRANSITIONS`). `recordChequePayment` = an `in_hand` cheque + a linked `CHEQUE` payment. `advanceCheque` enforces the table, stamps `deposited_at/cleared_at/bounced_at`; **bounce** voids the linked payment (debt re-opens) and raises a customer `reminders` row; **replace** voids any live payment, records the replacement cheque + payment, links the two. |
| Derived debt | `customers.debt_0_7/8_30/30_plus` **dropped** (demo data — user confirmation). `opening_balance_toman INTEGER NOT NULL DEFAULT 0` added (0 for everyone; a real pre-app balance is entered per customer later). `customerDebt(orgId, custId, asOf?)` and `customerDebtsForOrg(orgId, asOf?)` in `lib/repo/payments.ts` compute `total` + three ageing buckets from delivered orders and allocations. Consumers switched: `lib/dashboard`, `lib/customerSummary`, `app/analytics`, `app/report`, `components/CsvExportButton` (values passed in), `CustomerDetailPanel` (`debtTier`), `lib/types` (`debtColor`), `CoverageMap` debt colour + `HeatmapLayer` weight (via `readCustomers(db, scope, { organizationId })` attaching `debt`), `app/sales/orders/new`. Customers API etag folds in the payments ledger. |
| Credit control | `orders.credit_hold` (plain `ADD COLUMN`). `createOrder`: a direct customer's order that would breach a set `credit_limit_toman` is parked (`credit_hold = 1`) with a pending `credit_approvals` row; `hard_credit_block = 1` refuses the order outright. `addStop` refuses a held order. `decide('approved')` clears the hold. Representatives are exempt throughout. |
| Routes | `/api/payments` (GET list `?customer_id=`, POST), `/api/payments/[id]` (GET, POST `?action=void`), `/api/payments/[id]/receipt` (POST multipart, GET webp), `/api/cheques` (GET `?status=`/`?customer_id=`, POST), `/api/cheques/[id]` (GET, PATCH `{action:'advance', to, replacement?}`), `/api/customers/[id]/statement` (GET, scoped). All SQL via `lib/repo`. Cross-tenant → 404; void-after-void / illegal cheque move → 409. |
| UI | `/sales/payments` (record + list + void) — everyone but drivers. `/sales/cheques` (record + status board with legal-move buttons, overdue flag) — owner/group_manager, with a `proxy.ts` rule. `CustomerDetailPanel` gains a "دریافت وجه" link pre-filling the form. Nav tabs added. |
| Tenancy | `payments` + `cheques` on `TENANT_TABLES`; `payment_allocations` exempt. `twoOrgs` seeds a payment + a cheque (colliding `cheque_no`) per org; `tenancy-isolation` asserts no leak. |

Suite: 111 files / 1214 tests green (+1 skipped). `npx tsc --noEmit` and `npx eslint app/ lib/` clean.

## Deviations from the plan

- **`payments.delivery_stop_id`** was added (not in the spec) to make `recordDelivery` idempotent — a retried delivery sync would otherwise stack a second CASH payment.
- The **driver** role was dropped from `POST /api/payments`; door cash is recorded through `recordDelivery`, which already covers the driver path without a raw-SQL run-ownership check in the route.
- Cross-tenant customer/order checks in `lib/repo/payments` **tolerate a NULL `organization_id`** (only ever a hand-seeded test row; the boot backfill sets it in production). A non-null mismatch is still refused.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API (never `cp` — WAL).
2. Against a copy: `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/customer-opening-balance-migration.test.ts tests/legacy-payment-backfill.test.ts tests/tenancy-*` — confirm `debt_*` gone, `opening_balance_toman` present and 0, one synthetic CASH payment per legacy `paid_toman`, `foreign_key_check` empty.
3. `npm run build` + `systemctl restart routeflow` (the standing "never do this mid-development" rule lifts only for the coordinated deploy).

## Next: Phase 2 — Stock / batches

Per `docs/crm-erp-plan.md` Part 5: M4 batch/lot tracking, expiry, FEFO picking, stock moves. Branch off `phase-1-money`.
