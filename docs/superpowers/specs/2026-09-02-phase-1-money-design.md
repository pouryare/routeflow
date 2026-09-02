# RouteFlow Phase 1 — Money — Design

**Date:** 2026-09-02 · **Branch:** `phase-1-money` (off `phase-0b-foundations`)
**Spec source:** `docs/crm-erp-plan.md` Part 3 M3, Part 0 decisions 3 · `docs/crm-erp-source-extract.md` §3 (inventory/payment rules), §8 #2–#3
**Predecessors:** Phase 0a (tenancy) + Phase 0b (foundations, `lib/repo`, M2) — both done, unmerged.

---

## Goal

Make the app trustworthy for cash. Today a delivery writes a single lump into
`orders.paid_toman` and that is the whole payment story — no method, no record, no
partial-later, no cheques, and `customers.debt_*` is frozen at the last Excel import
(the importer was removed in Phase 0b). Phase 1 adds:

1. **`payments`** — one row per sum of money received, with a method and (for POS /
   card-to-card) an optional receipt image.
2. **`payment_allocations`** — a payment settles one or more orders, or sits on the
   customer's account as an unallocated credit.
3. **`cheques`** — a full Iranian cheque lifecycle
   (issued → in_hand → deposited → cleared → bounced → replaced) as a transition
   machine, not a status field. A bounced cheque re-opens the debt it had settled.
4. **Derived debt** — `orders.paid_toman` becomes a cache recomputed from allocations;
   `customers.debt_0_7 / debt_8_30 / debt_30_plus` are replaced by figures computed
   from unpaid, aged order balances, plus a per-customer `opening_balance_toman` that
   starts at **0** (the current frozen `debt_*` values are demo data — user
   confirmation 2026-09-02 — so there is nothing real to carry forward; a genuine
   pre-app balance can be entered per customer later).
5. **Credit-approval workflow wiring** — Phase 0b built `credit_approvals` (table +
   repo + manual decide). Phase 1 connects it: creating an order that breaches a
   direct customer's limit records the approval request and marks the order; a
   decision releases or holds it. (The *automatic* 12-state `PENDING_CREDIT`
   transition still waits for Phase 3; Phase 1 does it within the current 4-state
   `draft/confirmed/delivered/cancelled` model.)

## Global constraints (unchanged)

- **Branch `phase-1-money`.** Never `main`. No `npm run build` / `systemctl restart`.
  Merges with the whole stack after Phase 10.
- **Money is whole Toman in `INTEGER`** (`lib/money.ts`). Every amount column is
  `INTEGER NOT NULL`. No `REAL`.
- **Dates ISO/Gregorian stored, Jalali shown.** Cheque due dates included.
- **Migrations idempotent, `PRAGMA`/constraint-guarded, table-rebuild style.** Run
  against live data on the next deploy.
- **New DB access goes through `lib/repo/`** (Phase 0b). `tests/repo-boundary.test.ts`
  enforces it; the allowlist only shrinks.
- **A row from another tenant answers 404, not 403.** Persian user-facing text.
- `npx tsc --noEmit && npx eslint app/ lib/ && npx vitest run` green before each
  commit (full `eslint` OOMs in the sandbox — see the Phase 0b handoff).

---

## Data model

### `payments` (tenant table)

```sql
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount_toman INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN
    ('CASH','POS','CARD_TO_CARD','CHEQUE','CREDIT_NOTE','OTHER')),
  received_at TEXT NOT NULL,               -- when the money changed hands (device/entry time)
  received_by INTEGER NOT NULL REFERENCES users(id),
  reference TEXT,                          -- POS terminal ref, card-to-card tracking no, etc.
  receipt_photo_stem TEXT,                 -- -> photos.file_stem, entity_type 'payment'
  cheque_id INTEGER REFERENCES cheques(id),-- set iff method = 'CHEQUE'
  note TEXT,
  voided_at TEXT, voided_by INTEGER REFERENCES users(id), void_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_payments_customer ON payments (organization_id, customer_id, received_at);
```

- A payment is **never edited** after creation — a mistake is `voided_at` + a fresh
  payment, so the ledger is append-only. A voided payment's allocations are removed and
  the affected `orders.paid_toman` caches recomputed.
- `photos.entity_type` CHECK is widened to include `'payment'` (table rebuild).

### `payment_allocations` (reaches a tenant through `payments` → exempt)

```sql
CREATE TABLE payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id),  -- NULL = sits on the customer's account
  amount_toman INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_alloc_order ON payment_allocations (order_id);
```

- Invariant enforced in the repo, not the schema: `SUM(allocations.amount) == payment.amount`
  for a non-voided payment, and per order `SUM(allocations for that order) <= order.total_toman`
  unless an explicit overpayment note is given.
- Auto-allocation helper: given a payment and a customer, fill oldest unpaid delivered
  orders first (FIFO), remainder → `order_id NULL` (on account). The user can override
  the split in the UI before saving.

### `cheques` (tenant table)

```sql
CREATE TABLE cheques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount_toman INTEGER NOT NULL,
  cheque_no TEXT NOT NULL,
  bank_name TEXT,
  due_date TEXT NOT NULL,                  -- سررسید, ISO
  status TEXT NOT NULL DEFAULT 'in_hand' CHECK (status IN
    ('issued','in_hand','deposited','cleared','bounced','replaced','cancelled')),
  received_at TEXT NOT NULL,
  received_by INTEGER NOT NULL REFERENCES users(id),
  deposited_at TEXT, cleared_at TEXT, bounced_at TEXT,
  replaced_by_cheque_id INTEGER REFERENCES cheques(id),
  note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (organization_id, customer_id, cheque_no)
);
```

- **`issued`** is for a cheque *we* wrote (rare — supplier payments later); the normal
  entry point for a customer cheque is **`in_hand`**.
- Recording a cheque payment (`payments.method = 'CHEQUE'`) creates the `cheques` row
  in `in_hand` and a `payments` row linked by `cheque_id`, allocated like any payment —
  the debt is considered settled while the cheque is live.
- **Bounce**: `bounced` transition voids the linked payment's allocations and
  recomputes the affected orders' `paid_toman` — the debt comes back — and raises a
  reminder/alert for follow-up. `replaced` links the new cheque and closes the old.

### `lib/chequeStates.ts` — the transition table

```
in_hand    -> deposited | bounced | replaced | cancelled
deposited  -> cleared   | bounced
cleared    -> (terminal)
bounced    -> replaced  | (terminal)
replaced   -> (terminal)
cancelled  -> (terminal)
issued     -> in_hand   | cancelled
```

`advanceCheque(organizationId, id, to, actor)` in `lib/repo/cheques.ts`: enforces the
table, stamps the matching timestamp, and on `bounced` calls the allocation-reversal +
alert. Illegal transition → `ChequeError` → 409.

### Derived `orders.paid_toman`

Keep the column (a cache read all over the app) but stop writing it by hand. A single
`recomputeOrderPayment(db, orderId)` in `lib/repo/payments.ts` sets
`paid_toman = SUM(non-voided allocations for this order)` and
`payment_status = unpaid | partial | paid` from `paid_toman` vs `total_toman`. Called
after every allocation change, void, and cheque bounce. `recordDelivery` stops setting
`paid_toman` directly — a driver collecting cash at the door creates a `CASH` payment
allocated to that order instead (same effect, now a real ledger row).

### Derived customer debt (replaces `debt_0_7 / debt_8_30 / debt_30_plus`)

Table-rebuild migration on `customers`:

- **Drop** `debt_0_7`, `debt_8_30`, `debt_30_plus` outright. Their values are demo
  data (user confirmation 2026-09-02), so no backfill — nothing real is lost.
- **Add** `opening_balance_toman INTEGER NOT NULL DEFAULT 0`. It stays 0 for every
  existing customer at migration time; it exists so a real pre-app balance can be set
  per customer through the normal patch path afterwards.
- Debt is now **computed**, never stored: a `customerDebt(db, customerId, asOf?)`
  function in `lib/repo/payments.ts` returns
  `{ total, bucket_0_7, bucket_8_30, bucket_30_plus }` where
  `total = opening_balance + Σ(delivered order.total_toman) − Σ(non-voided allocations to that customer)`
  and the buckets age each still-unpaid delivered order by `now − order.delivered_at`.
  The opening balance ages into `bucket_30_plus` (it is old by definition).
- `lib/dashboard.ts`, `app/report/page.tsx`, `CsvExportButton`, `CustomerDetailPanel`'s
  `debtTier`, and `lib/types.ts`' `debtColor` switch to the computed shape. Dashboard
  sums iterate customers (or a single grouped query the repo owns) rather than
  `SUM(debt_0_7)`.
- `CustomerRow` / `Customer` lose the three `debt_*` fields, gain `opening_balance_toman`
  and an optional computed `debt` object attached by the read layer where a page needs it.

### `credit_approvals` wiring (table exists from Phase 0b)

- `lib/orders.ts` `createOrder`: after insert, if the customer is a **direct** customer
  (no `representative_profiles` row), `hard_credit_block = 0`, and
  `customerDebt(...).total + order.total_toman > credit_limit_toman` (limit set), call
  `requestApproval(...)` and set a new `orders.credit_hold INTEGER NOT NULL DEFAULT 0`
  to 1. A held order cannot be added to a delivery run (`addStop` refuses it).
- `decide(..., 'approved')` clears `credit_hold`; `'rejected'` leaves it held and the
  order effectively parked until cancelled or a payment brings the balance under.
- `hard_credit_block = 1` short-circuits: the order is refused at `createOrder` with a
  Persian error, no approval row.

---

## API surface

| Route | Methods | Roles | Purpose |
|---|---|---|---|
| `/api/payments` | GET (`?customer_id=`), POST | owner, group_manager, salesperson (POST); driver (POST, own run's stop only) | list / record a payment with its allocation split |
| `/api/payments/[id]` | GET, POST (`?action=void`) | owner, group_manager | detail; void |
| `/api/payments/[id]/receipt` | POST (multipart), GET | as payments | attach / fetch the POS/card receipt image (reuses the `photos` storage path) |
| `/api/cheques` | GET (`?status=`, `?customer_id=`), POST | owner, group_manager | list / record a customer cheque |
| `/api/cheques/[id]` | GET, PATCH (`{action:'advance', to}`) | owner, group_manager | detail; move through the lifecycle |
| `/api/customers/[id]/statement` | GET | owner, group_manager, salesperson (own) | orders, payments, running balance, aged debt |

All reads scoped through `lib/repo` tenant helpers. `/api/sales/orders/export` gains a
`payment_status` / `balance` column update (already references `payment_status`).

## UI

- **`/sales/payments`** (new tab, `session.role !== "driver"`): a form to record a
  payment — customer, amount, method, date, reference, receipt photo for POS/card, and
  an editable allocation table (auto-filled FIFO, "on account" for the remainder). A
  list below: recent payments, method, allocated vs on-account, void.
- **`/sales/cheques`** (new tab, owner/manager): a board grouped by status
  (`in_hand` / `deposited` / `bounced`), each cheque a card with customer, amount, due
  date (Jalali), and the legal next-status buttons. Overdue (`due_date < today` and
  still `in_hand`) flagged.
- **`CustomerDetailPanel`**: the debt pill switches to the computed figure; a
  "دریافت وجه" button opens the payment form pre-filled for that customer; a small
  statement link.
- **Order journey / dashboard**: `paid_toman` and `payment_status` already shown —
  now backed by real allocations, no code change beyond the derived recompute.
- **`components/report`, `lib/dashboard`**: aged-debt totals from the computed source.

## Testing

- `lib/repo/payments.ts`: allocation-sum invariant, FIFO auto-allocation, `void`
  reverses caches, `recomputeOrderPayment` transitions `payment_status`,
  `customerDebt` bucketing incl. opening balance.
- `lib/chequeStates.ts` + `lib/repo/cheques.ts`: every legal/illegal transition; a
  `bounced` cheque re-opens exactly the orders its payment had settled and raises the
  alert; `replaced` links.
- Migration test: `debt_*` dropped, `opening_balance_toman` present and `0` for every
  row, against a copy of the real 141-customer backup (`ROUTEFLOW_MIGRATION_CHECK_DB`).
- Route tests (model on `tests/api/facilities-route.test.ts`): auth per row above,
  cross-tenant 404, void 409-after-void, driver may only pay against their own stop.
- `credit_approvals`: an over-limit direct order sets `credit_hold` + an approval row;
  `addStop` refuses a held order; approve clears it; a rep customer never triggers it;
  `hard_credit_block` refuses at creation.
- Two-org isolation: extend `tests/helpers/twoOrgs.ts` with a `payments` + `cheques`
  row per org (colliding `cheque_no`), add `payments` and `cheques` to `TENANT_TABLES`,
  `payment_allocations` to the exempt list.

## Sequencing

1. `payments` + `payment_allocations` tables, `lib/repo/payments.ts`
   (`recordPayment`, `allocate`, `autoAllocateFIFO`, `void`, `recomputeOrderPayment`).
2. `recordDelivery` stops writing `paid_toman`; a door collection becomes a `CASH`
   payment. Backfill: existing `orders.paid_toman > 0` → one synthetic `CASH` payment
   per order at `delivered_at`, allocated to it (guarded on an `app_meta` marker).
3. `cheques` table, `lib/chequeStates.ts`, `lib/repo/cheques.ts`, the bounce reversal.
4. Derived customer debt: migration (drop `debt_*`, add `opening_balance_toman DEFAULT 0`),
   `customerDebt`, switch every consumer.
5. `credit_hold` on orders + wire `credit_approvals` into `createOrder` / `addStop`.
6. API routes + `/sales/payments` + `/sales/cheques` UI + panel button.
7. Tenancy wiring (`TENANT_TABLES`, exempt list, `twoOrgs`, isolation assertions).

Each step is one or more commits, TDD, full suite green.

## Explicitly out of scope

- The 12-state order machine and the automatic `PENDING_CREDIT` transition (Phase 3).
- Supplier payments / accounts payable (a cheque we *issue* has a stub status only).
- Bank / payment-terminal integration — method + reference + photo, no external calls.
- Multi-currency. Invoicing / formal `invoices` table (orders carry their own totals).
- Commission payout changes — the commission ledgers are their own subsystem, untouched.

## Risks

1. **Backfilling `paid_toman` into synthetic payments** rewrites history. Guarded on a
   marker, idempotent on an `app_meta` flag, tested against the real backup, backup
   mandatory before deploy. If a synthetic payment's amount exceeds the order total
   (bad legacy data) it is capped and flagged, not rejected.
2. **Dropping `debt_*`** is irreversible, but the values are demo data (user
   confirmation 2026-09-02) so nothing real is lost; the backup is still the recovery
   path. Every consumer must be switched in the same commit or the dashboard shows
   zero debt.
3. **Computed debt is only as complete as the app's order history.** Orders predating
   the app are represented solely by `opening_balance_toman`, which starts at 0 and is
   entered by hand where a real pre-app balance exists; this is the accepted trade-off
   (user decision 2026-09-02).
4. **Cheque bounce touching allocations** is the most error-prone path: it mutates
   several `orders.paid_toman` caches and must be atomic. One transaction, and a test
   that a mid-bounce failure leaves every cache consistent.
5. **Driver-recorded payments offline** are a Phase 4 concern; Phase 1 assumes online.
   The `payments` row a door-collection creates is written server-side at sync/record
   time like everything else today.
