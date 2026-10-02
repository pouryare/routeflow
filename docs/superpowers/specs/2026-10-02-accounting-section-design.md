# Accounting Section — a double-entry ledger the business owns

**Date:** 2026-10-02
**Status:** Approved in six sections (user: "Approve" × 6). No code written yet.
**Scope:** The accounting engine (chart of accounts, journals, ledger entries, fiscal periods),
the cutover of the existing payment path, accounts payable, expenses, six reports, and the
rebuilt payments screen. Excludes VAT, tax filing, budgets, multi-currency.

---

## The problem

There is no accounting page. Nothing in the repository matches `accounting` — the money work is
scattered across five sibling pages (`/sales/payments`, `/sales/cheques`, `/sales/commission`,
`/sales/stock`, plus analytics), and the accounting primitives — double entry, a chart of
accounts, supplier payables, expenses, period close — do not exist anywhere.

Two concrete gaps:

1. **Only money IN is recorded.** A customer pays → one row in `payments` plus rows in
   `payment_allocations`. A purchase records goods (`purchases`, `purchase_lines`) and then the
   money side simply vanishes. There is no accounts payable, no expenses, no ledger.
2. **`components/sales/PaymentsPanel.tsx` is 235 lines** — a single-card form and one flat
   recent-payments table. No filters, no totals, no pagination, no export, no grouping by
   period, and allocation is FIFO and **invisible**.

**Two facts that shape everything below, both verified:**

- **The money foundation is good and is not rebuilt.** `lib/money.ts` — INTEGER whole Toman,
  `toToman` parses Persian/Arabic digits, `roundToman` rounds half-away-from-zero, `sumToman`
  **throws** on a fraction. `payments` is append-only (`voided_at` + a fresh row, never an edit).
- **`recordPaymentTxn()` is already a single funnel.** `INSERT INTO payments` appears in exactly
  two places (`lib/repo/payments.ts:271`, and the one-shot legacy backfill at `lib/db.ts:407`),
  with exactly two callers: `lib/delivery.ts:400` (cash collected at the door) and
  `lib/repo/cheques.ts:94` (cheque clearing). The risky "rewrite twenty screens" fear does not
  apply; there is one chokepoint.

---

## What was deliberately NOT built, and why

| Not built | Why |
|---|---|
| VAT / ارزش افزوده, tax periods, tax-office numbering, e-invoicing | The user chose "internal books now, built so formal reporting can be added later **without rewriting the ledger**". Deferred, not forgotten. |
| Cheques **payable** (the `issued` stub) | The state exists; the write path does not. Building it would add a second money-OUT path before AP exists. |
| Retroactive recompute of historical cost | `product_costs` is effective-dated and new. Today's average is not what goods cost two years ago. |
| Multi-currency, multi-entity, consolidation | One tenant, whole Toman, forever. |
| Bank reconciliation (import + auto-match) | Real and wanted; not in slice 1. |
| Recurring / auto-posted entries | Auto-posting raises "was this right?" questions and should not ride along with a cutover. |
| Dropping the legacy `purchases.supplier` TEXT column | Irreversible data loss for tidiness — see the migration note. |

---

## The load-bearing decisions

Six were decided in conversation. Each is a fork a future implementer must not re-open.

### 1. The ledger is the truth

A receipt writes **only** ledger postings. Every figure the payments screen shows is `SUM`ed
from postings. `payments` survives as a projection maintained inside the same transaction —
never as an independent source.

**Rejected alternatives, and why:**

- *Extend `payments` into the ledger* (add debit/credit columns). A payment is a **transaction
  with 2+ legs**, not a leg. One-row-per-leg breaks the `method` CHECK or duplicates `method`
  onto rows that no longer have a single method. A working demo and an unmaintainable ledger.
- *Keep `payments` as-is and add a ledger beside it.* Two sources of truth that drift — and it
  directly contradicts the "no rewrite later" answer.

### 2. Corrections are reversals, never edits

A wrong entry is fixed by posting a **reversing entry that references the original**, then
posting the right one. Nothing is deleted. This is the pattern already in the codebase:
`lib/repo/crm/migrate.ts:34` — *"Append-only: a correction is a new row pointing at the one it
corrects"* — with `corrects_activity_id` and no-update/no-delete triggers that make editing
impossible (verified: zero `UPDATE activities` in `lib/` or `app/`).

**Neither `owner` nor `platform_owner` may edit a posted entry.** The user's instinct that
mistakes must be fixable is right; the fix is not an edit permission, because a mutable ledger
is exactly what decision 1 exists to prevent. Immutability is enforced **by the database**, so
there is no role gate to escalate to. `owner` posts corrections within their own organization;
`platform_owner` has cross-tenant *visibility* for support but does not rewrite a customer's
books. A genuine emergency is a migration with a written `app_meta` guard key, never a UI button.

**This must be one click.** If fixing a typo needs a ceremony, people route around the ledger and
the guarantee is worthless. The UI shows the correction inline — struck through, attributed, and
linked to the reversing journal.

### 3. Two tables for journals and entries

A **journal is the transaction**; a **ledger entry is one leg**. A customer paying 5,000,000 is
one event with two legs (Dr Cash / Cr Receivable). Collapsing them is the "one row per leg"
structure that breaks.

### 4. The chart of accounts is GLOBAL; postings are per-tenant

`accounts` has **no `organization_id`**. The chart is the business's structure; the postings are
the tenant's. This is the `product_costs` argument (commit `69a7e25`, where the error was made
once and fixed).

**The counter-example, stated so it is not mistaken for a contradiction:** `commission_rates` and
`commission_tiers` **do** carry `organization_id` — their comment at `lib/db.ts:1608` calls a
plan without a company *"a cross-tenant leak waiting for the first query"*. That reasoning
governs a tenant's **rates**, not a **taxonomy of account names**. By the same distinction,
`suppliers` IS tenant-scoped (a supplier is one business's relationship).

Every other new table carries `organization_id INTEGER NOT NULL REFERENCES organizations(id)`,
per `tests/tenancy-schema.test.ts` and `tests/tenancy-isolation.test.ts`.

### 5. `side` + a positive amount, never a signed column

`side TEXT CHECK (side IN ('D','C'))` with `amount_toman INTEGER NOT NULL CHECK (amount_toman > 0)`.
A negative amount is either a typo or a smuggled reversal; both must be impossible. It also
makes the trial balance `SUM(C) - SUM(D)` with no `CASE`.

### 6. Gapless sequence per organization

A tax office rejects a ledger with holes. `ux_journals_org_seq` blocks duplicates; the next
number is allocated inside the insert's transaction.

---

## Schema

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,          -- '1101' — durable identity that maps to tax lines
  name_fa TEXT NOT NULL,
  name_en TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_id INTEGER REFERENCES accounts(id),
  is_postable INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1)),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE IF NOT EXISTS fiscal_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  period_key TEXT NOT NULL,           -- '1404-06' Jalali
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_at TEXT,
  closed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, period_key)
);

CREATE TABLE IF NOT EXISTS journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  seq INTEGER NOT NULL,
  posted_at TEXT NOT NULL,            -- ISO, matching every other table here
  period_key TEXT NOT NULL,
  memo TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN
    ('PAYMENT','CHEQUE','SALE','PURCHASE','SUPPLIER_PAYMENT','EXPENSE','OPENING','MANUAL','REVERSAL')),
  source_id INTEGER,                   -- nullable: some sources legitimately post nothing
  reverses_journal_id INTEGER REFERENCES journals(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_journals_org_seq ON journals(organization_id, seq);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  journal_id INTEGER NOT NULL REFERENCES journals(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  side TEXT NOT NULL CHECK (side IN ('D','C')),
  amount_toman INTEGER NOT NULL CHECK (amount_toman > 0),
  customer_id INTEGER REFERENCES customers(id),   -- only on AR legs
  supplier_id INTEGER REFERENCES suppliers(id),   -- only on AP legs
  memo TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ledger_entries_journal ON ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS ix_ledger_entries_account ON ledger_entries(account_id, posted_at);
```

Immutability triggers, copied from `lib/repo/crm/migrate.ts:64` — **`IF NOT EXISTS` is
mandatory**, because triggers are recreated on every boot and a bare `CREATE TRIGGER` throws
(noted at `lib/db.ts:3583`):

```sql
CREATE TRIGGER IF NOT EXISTS journals_no_update BEFORE UPDATE ON journals
  BEGIN SELECT RAISE(ABORT, 'journals is append-only'); END;
CREATE TRIGGER IF NOT EXISTS journals_no_delete BEFORE DELETE ON journals
  BEGIN SELECT RAISE(ABORT, 'journals is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries
  BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries
  BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
```

**Two migration constraints inherited, stated so they are not rediscovered mid-build:**

- **`PRAGMA foreign_keys = OFF` during migration** (`lib/db.ts:138,185,244`, restored in a
  `finally`). SQLite cannot add a foreign key to an existing table — which is why
  `payments.cheque_id` has no FK today (its comment at `lib/db.ts:1770` says so).
  `purchases.supplier_id` **must** be added by rebuild-and-copy, not `ALTER TABLE ADD COLUMN`.
- **`suppliers` does not exist today.** `purchases.supplier` is a free-text `TEXT` column
  (verified; the only writer is `lib/purchases.ts:71`). Accounts payable is impossible without
  supplier identity, so this is a **precondition**, not garnish.

---

## The seeded chart of accounts — 24 accounts

**دارایی / ASSETS** (normal balance: DEBIT)

| Code | فارسی | English |
|---|---|---|
| 1101 | صندوق | Cash on hand — the `CASH` method |
| 1102 | بانک | Bank account — `CARD_TO_CARD`, `POS`, transfer |
| 1103 | تنخواه گردان | Petty cash |
| 1201 | حساب‌های دریافتنی | Accounts receivable — the customer debt already tracked |
| 1202 | چک‌های دریافتنی | Cheques receivable — `in_hand`/`deposited` cheques as an ASSET |
| 1203 | موجودی کالا | Inventory — from `purchases` |
| 1301 | پیش‌پرداخت | Prepayments |

**بدهی / LIABILITIES** (normal balance: CREDIT)

| Code | فارسی | English |
|---|---|---|
| 2101 | حساب‌های پرداختنی | Accounts payable — the money side of a purchase |
| 2102 | چک‌های پرداختنی | Cheques payable — seeded, written later |
| 2103 | تعهدات کمیسیون | Commission payable |
| 2104 | مالیات پرداختنی | Taxes payable — seeded only |

**سرمایه / EQUITY** (CREDIT) — 3101 سرمایه Capital · 3102 برداشت/اضافه‌برداشت Owner's equity ·
3103 سود انباشته Retained earnings

**درآمد / REVENUE** (CREDIT) — 4101 فروش Sales revenue · 4102 برگشت از فروش Sales returns

**هزینه / EXPENSE** (DEBIT) — 5101 بهای تمام‌شده COGS · 5102 اجاره Rent · 5103 حقوق Salary ·
5104 سوخت و حمل Fuel & delivery · 5105 تلفن و اینترنت Phone & internet · 5106 سایر Other

**The numbering follows the conventional Iranian trading chart**, in which the leading digit
carries the statement: `1xxx` دارایی · `2xxx` بدهی · `3xxx` سرمایه · `4xxx` درآمد · `5xxx` هزینه.
So an account's type is readable from its code without a lookup, which is the point of a code.

Group headers `1000`/`2000`/`3000`/`4000`/`5000` are seeded with `is_postable = 0`, so nothing can
post to «دارایی‌ها» itself. All seeded rows carry `is_system = 1`: deactivatable, never deletable.

**Two accounts that exist because THIS app needs them, not because a textbook says so:**

- **2103 تعهدات کمیسیون.** The commission subsystem already knows what a rep is owed. Without
  this liability, commission is invisible on the balance sheet — the app knows the number and
  the books do not. **The seed exists; the accrual is NOT in slice 1** (the subsystem pays on its
  own schedule, and posting an accrual it does not yet drive would make the ledger and
  `commission_payments` disagree — a second source of truth, which decision 1 exists to prevent).
- **2104 مالیات پرداختنی.** VAT was deferred. Seeding the *account* costs nothing and is exactly
  the seam the user asked for: a tax line can later map to an account that has existed since day
  one, whereas retrofitting that account is a schema change on posted history.

---

## The posting engine — one write path

New file `lib/repo/ledger.ts`. Two exports, mirroring the convention already in
`lib/repo/payments.ts:327` (`recordPayment` opens a transaction; `recordPaymentTxn` does not):

```ts
/** The ONLY function that writes a journal. Never opens a transaction — the caller owns it. */
export function postJournal(db: DatabaseSync, input: PostInput): number

/** The wrapper for callers that are not already inside one. */
export function postJournalIn(organizationId: number, input: PostInput): number
```

**Why `postJournal` must not open its own transaction** — this is a real hazard, not a style
preference. `recordDelivery` already holds `BEGIN IMMEDIATE` (`lib/delivery.ts:283`) from before
the payment call (`:400`) until `COMMIT` (`:513`), on the same `db` handle. A `BEGIN` inside a
transaction throws in SQLite, so a `postJournal` that opened its own would **crash on every cash
collected at a delivery door** — the single most common money event in the app. The cutover has
exactly one chokepoint, and this is where it would break.

Keeping only `postJournal` as the inserter preserves decision 2's promise (one function writes
journals) while letting `postJournalIn` give standalone callers a safe default.

`postJournal`'s guards, in order — each is a rule that holds for **every** posting, forever:

1. Allocate the gapless `seq`: `SELECT COALESCE(MAX(seq),0)+1 FROM journals WHERE organization_id = ?`,
   inside the caller's transaction. `BEGIN IMMEDIATE` is what makes this read-then-write safe.
2. **Refuse a closed period.** Look up `fiscal_periods` on `period_key`.
   **A MISSING period row is auto-created OPEN, not refused** — the backfill is by definition
   older than any seeded period, and a strict reading would make it refuse its own history.
3. Validate the legs: at least 2; every `account_id` is `is_postable = 1` and `active = 1`; and
   `sumToman(debits) === sumToman(credits)`. `sumToman` already **throws** on a fraction
   (`lib/money.ts:74`), so a float can never enter the ledger.
4. Refuse `amount_toman <= 0` — belt-and-braces behind the table CHECK.
5. Derive `period_key` from `posted_at` via `toJalali()` (`lib/jalali.ts:212`). Never trust a
   caller to compute it.
6. Insert `journals`, then the `ledger_entries` legs.
7. The wrapper commits; any throw rolls back and rethrows.

**Refusals throw; they never return a flag.** This matches `PaymentError` in this repo, and a
posting path that returns `false` invites a caller that ignores it.

### The cutover

`recordPaymentTxn` gains one call, in the same transaction, so the receipt and its postings
commit or fail together:

```
Dr 1101 صندوق  (by method: CASH→1101, CARD_TO_CARD/POS→1102)
   Cr 1201 حساب‌های دریافتنی        (customer_id on this leg)
```

`method` → cash account is an explicit map in code, not a lookup table — there are six methods
and the mapping is accounting policy, not data.

**Blast radius: 2 files.** `lib/repo/payments.ts` and the new `lib/repo/ledger.ts`.
`lib/delivery.ts:400` and `lib/repo/cheques.ts:94` keep calling `recordPaymentTxn` unchanged —
which is the entire point of the funnel.

A void sets `voided_at` **and** posts a `REVERSAL` journal referencing the original, in the same
transaction. This is decision 2 applied to the one write path that exists today.

---

## Recognition — revenue and cost post on DELIVERY

```
On a successful (or partial) delivery, one journal:
  Dr 1201 حساب‌های دریافتنی    ← the delivered value, customer_id set
     Cr 4101 فروش                                   (revenue)
  Dr 5101 بهای تمام‌شده        ← cost of what actually went out
     Cr 1203 موجودی کالا
```

- Revenue uses the **delivered** value: `packs_delivered ?? packs_ordered` per line — the same
  `effectivePacks()` already used at `lib/orderMath.ts:34`. A partial delivery recognises the
  partial amount.
- COGS reads the same cost the margin work built: `lib/repo/productCosts.ts:52` — effective-dated
  override, else `products.avg_cost_toman`, else **null**. When the cost is unknown, **COGS is not
  invented**: the revenue leg posts alone and the cost stays visibly unrecognised. This is the
  same *"refuse rather than invent"* instinct as `lib/margin/solve.ts`.
- The journal keys off `delivery_stops.id` and is guarded by a `NOT EXISTS` clause, so a retried
  sync converges instead of double-posting.

**Cash and revenue are separate journals and stay that way.** When a customer pays 5,000,000
against a 20,000,000 order, the receipt posts Dr Cash / Cr AR; revenue posted when the goods
moved. **Allocating a payment to an order posts nothing** — allocation is a `payment_allocations`
concern and never a journal. A design that recognises revenue on payment is wrong even when the
numbers happen to agree.

---

## The backfill

Modelled on `backfillLegacyPayments` (`lib/db.ts:376`), the correct precedent in this repo:

1. `app_meta` guard key `'ledger_backfill_done'` — check it and return if set.
2. A `NOT EXISTS` clause in the SELECT, so a re-run cannot double-post **even without the guard**.
   Both guards: the key is the fast path, `NOT EXISTS` is the correctness proof. This is how
   `backfillStockLedger` (`:443`) is built too.
3. `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` around the whole thing.
4. Order: **payments** first, then **cheques**, then **orders** — AR must exist before the orders
   that consume it.

### Historical deliveries get NO COGS leg — deliberately

There is no trustworthy historical cost. `product_costs` is effective-dated and new, so today's
`avg_cost_toman` is **not** what the goods cost when they were delivered two years ago.

Backfilled orders therefore post `Dr 1201 / Cr 4101` **with no cost leg**, and any period that
predates the ledger is labelled **cost-incomplete** on the income statement and balance sheet.
Inventing a COGS figure from a current average would put a wrong number on the income statement,
and **a wrong number that looks right is worse than an absent one.** Opening balances
(`customers.opening_balance_toman`, `lib/db.ts:3281`, which already exists and must be reused
rather than duplicated) absorb the difference on the balance sheet.

---

## The reconciliation gate — `tests/ledger-reconciliation.test.ts`

**Nothing user-visible ships until this passes.** It runs against the real backfilled database:

| Check | Assertion |
|---|---|
| Per payment method | `SUM(ledger cash legs)` == `SUM(payments.amount_toman)` for that method, `voided_at IS NULL` |
| Per Jalali month | The same equality grouped by `period_key` — catches a period-key bug a total-only check hides |
| Trial balance | `SUM(D) == SUM(C)` across the whole ledger, always |
| Idempotency | Re-running the backfill changes nothing |
| Reversal | A reversal restores the exact prior balance of every account |
| Tenancy | Org 1's payments never produce org 2's postings |
| Hostile | `UPDATE ledger_entries` throws; `DELETE` throws — decision 2, proven by breaking it |

**If the per-method or per-month check fails, the engine is wrong — not history.** That sentence
exists to stop a future migration "fixing" the numbers to make a test green.

Note that voided payments are excluded from the method total: they have a reversal, not a receipt.
And `source_id` is nullable precisely because some sources legitimately post nothing (a zero-total
purchase, below) — so no check may assume every source row maps 1:1 to a journal.

---

## Suppliers and accounts payable

```sql
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_org_name ON suppliers(organization_id, name);
```

**Tenant-scoped**, unlike the global `accounts` — decision 4's own distinction applied
consistently: a supplier is one business's relationship, not a shared taxonomy.

`purchases` gains `supplier_id INTEGER REFERENCES suppliers(id)`, **nullable**, added by
**rebuild-and-copy** (SQLite cannot add a FK to an existing table), the same shape as the
`organization_id` backfill at `lib/db.ts:3676`:

1. One `suppliers` row per `DISTINCT TRIM(purchases.supplier)` where not null/empty, per org.
2. `UPDATE purchases SET supplier_id = (SELECT id FROM suppliers WHERE name = TRIM(purchases.supplier)) WHERE ...`
3. **Keep the legacy `supplier` TEXT column.** It is the only record of the original string when
   two suppliers share a name after trimming. Dropping it buys tidiness at the price of
   irreversible data loss. Named as a later cleanup, deliberately not now.
4. `lib/purchases.ts` starts writing `supplier_id` — it is the **only** writer (verified), so this
   is a one-file change.

### A purchase posts a payable

```
Dr 1203 موجودی کالا      the purchase total
   Cr 2101 حساب‌های پرداختنی                    (supplier_id on this leg)
```

**A zero-total purchase posts NO journal.** `lib/purchases.ts:57` validates `unit_cost_toman`
with `< 0`, not `<= 0` — so a zero-cost purchase is legal today. `ledger_entries` has
`CHECK (amount_toman > 0)`, so the journal would throw. The purchase still records, still moves
stock, and still rolls the average cost; there is simply nothing to post, and inventing a leg
would be a fabrication. This is *"refuse beats a plausible wrong number"* (`lib/db.ts`) again.

**The total is `roundToman(unit_cost_toman * base_qty)` summed per line.** `purchase_lines.base_qty`
is **REAL**, not INTEGER, so the product genuinely produces fractions. Two consequences:
`roundToman` is required — `Math.round` is wrong here, since `roundToman`'s own comment notes
that `Math.round(-0.5)` yields `-0` and *"would make a reversal 1 Toman off from the sale it
reverses"*. And SQL `ROUND()` must not be used, for the same reason. The per-line rounded values
are then summed with `sumToman`, which throws if anything is still fractional.

### Paying a supplier — the first money-OUT posting in the app's history

```
Dr 2101 حساب‌های پرداختنی       supplier_id on this leg
   Cr 1101 صندوق  /  1102 بانک                  (by method)
```

- Partial payments are normal: the balance **is** the balance, not a flag.
- Posts through the same `postJournal` (`source_type = 'SUPPLIER_PAYMENT'`) — one posting path.
- **Overpaying a supplier posts to 1301 پیش‌پرداخت (prepayment), never a negative 2101.** Since
  `amount_toman > 0` makes negatives impossible, the direction is chosen by which account is used.

---

## Expenses — structured, never free text

```
Dr 5102 اجاره   (or 5103 حقوق, 5104 سوخت, 5105 تلفن, 5106 سایر)
   Cr 1101 صندوق  /  1102 بانک
```

**The category IS an account id.** The dropdown is populated from
`accounts WHERE type = 'EXPENSE' AND is_postable = 1`, so adding a category later is adding a row
— no code change, no migration, no reshaping of history. This is the deliberate lesson from
`purchases.supplier`, where free text made accounts payable impossible.

**5101 COGS is excluded from that dropdown.** It is posted by delivery recognition, never by hand;
otherwise a cost of goods could be expensed manually and the income statement would double-count.

---

## The reports

**Every number on every screen is a query over `journals` / `ledger_entries`. None is stored, none
is cached, none is computed by the UI.** That is what makes a later formal report need no new maths.

| Screen | Route | Notes |
|---|---|---|
| Trial balance | `/accounting/trial-balance` | Debit and credit columns **must be equal** — that equality is the definition of a working ledger. Accounts with no movement hide behind a toggle. |
| General ledger | `/accounting/ledger/[accountId]` | Running balance, plus a **period-opening row** — the answer to "how much was in this account before this period?", which nothing in the app answers today. |
| Journal | `/accounting/journal` | Filterable by period, account, source type, customer, supplier. Each row expands to its legs. |
| Balance sheet | `/accounting/balance-sheet` | دارایی = بدهی + سرمایه. The first one this business has ever had. |
| Income statement | `/accounting/income-statement` | Revenue − COGS − expenses over a period. |
| Aged payables | `/accounting/payables` | The mirror of the AR ageing already in `lib/dashboard.ts:41` (`d0_7`, `d8_30`, `over_30`). |

`lib/dashboard.ts` already computes `revenue_toman` and `margin_toman` (lines 31-35, 245), so the
income statement is a **reshaping, not a rewrite** — the same maths with a period and a cost line.

### Three honesty requirements on the face of the screens

1. **Decision 2's correction must be visible on the journal.** A reversed entry appears struck
   through, labelled «ابطال‌شده توسط X در Y», linked to the reversing journal. A reader sees the
   true figure *and* that it was corrected. One number with a hidden edit behind it is exactly
   what decision 2 refuses.
2. **Periods before the ledger are labelled cost-incomplete**, on both the balance sheet and the
   income statement. The screen must never look more certain than the data underneath it.
3. **A closed period stays READABLE.** Closing hides a period from *posting*, never from reading.
   This is a real trap: closing must never make history disappear.

### Conventions these screens must follow — reuse, do not reinvent

- **Charts are hand-rolled SVG; there is no chart library.** `components/charts/` already contains
  `BarChart`, `DonutChart`, `LineChart`, `LinePlot`, `Sparkline`, `SplineChart`, `SplinePlot`,
  `ChartFrame`, `StatCard`. The trial-balance bars and the ageing donut **reuse these**. New
  hand-rolled SVG in a report is a review failure, not a contribution.
- **`SectionHead` is enforced by test.** `tests/section-headings.test.ts:32` fails on any page or
  component that hand-styles an `<h2>`/`<h3>`. Six new pages means six `SectionHead` usages, and
  the test will say so when one is missed.
- Design system is MASTER.md «مریدین» — light, ocean accent, CarvedCard.

---

## Nav and roles

`APP_GROUPS` (`lib/appNav.ts:31`) has 7 groups today. Six reports inside a group that already
holds orders/products/payments/cheques/commission would be unreadable, so **`accounts` is added as
an 8th group, «حسابداری»**. Its own rule, recorded in that file's header comment — *"every ready
tab lands in exactly one group, no two visible tabs share a label"* — must keep holding. Every
route needs a `pageMetaFor` entry (`lib/pageMeta.ts:163` shows the shape: title, titleEn, overview).

Write screens get their own tabs, because they are not reports: `/accounting/expenses` and
`/accounting/suppliers`.

### Role gates

The `proxy.ts` convention is established: gate at the edge with `deny("/sales")`, **and re-check
in the route**. Its own comment says *"The API re-checks; this keeps the bundle and the tab off
their screen"* (`proxy.ts:129`).

| Action | Roles |
|---|---|
| Trial balance / balance sheet / income statement | `OWNER_ROLES` |
| Journal: read | `OWNER_ROLES` + `group_manager`, scoped to their group via `scopeGroupIds` |
| Journal: post a **manual** entry | `OWNER_ROLES` — a manual journal is the dangerous door |
| Period close / reopen | `OWNER_ROLES` |
| Expenses: enter | `OWNER_ROLES` + `group_manager` (see open question 1) |
| Suppliers: manage | `OWNER_ROLES` |
| Any of the above for `phone_sales` | **DENIED** — matches the `isGroupWide` rule at `proxy.ts:124`; their own figures live at `/sales/me` |

**Every gate names the constant, never `['owner']`.** `lib/roles.ts:46` records that
`platform_owner` is a strict superset of `owner`, and that the fix for 185 hand-written gates was
a single constant so `tsc` propagates it. Writing `claims.role !== "owner"` is precisely the bug
that constant exists to prevent.

---

## The payments screen

`components/sales/PaymentsPanel.tsx` (235 lines) stays, and becomes a friendly view over the
ledger rather than a second source of truth.

| Change | From | To |
|---|---|---|
| Filters | **none at all** | date range / method / customer / voided |
| Pagination | renders every recent payment | paged |
| Totals | nothing sums on screen | today / week / month cards per method |
| Export | none | CSV, Persian headers |
| **Allocation UI** | FIFO and **invisible** | per-order allocation, editable, with the on-account remainder shown as such |
| Grouping | one flat list | Jalali month sections |

**The allocation UI is the change a user would feel most.** Today a customer 40M on account cannot
see which orders it covers; the allocation happens silently. The data model already supports the
answer — `payment_allocations.order_id NULL` means on-account credit — so only the screen is
missing.

**The void button becomes «ابطال + ثبت معکوس»**: one click that sets `voided_at` **and** posts the
reversal in the same transaction. That is decision 2 in practice — the honest path stays the easy
path, or people route around the ledger and the guarantee is worthless.

---

## Resolved questions

1. **May a `group_manager` enter expenses? YES** (user, 2026-10-02). Rent and fuel are real daily
   costs and an owner should not type every line. The accountability control is that every journal
   records `created_by` and the expense report shows who entered what — not a second set of books,
   just attribution.
2. **The chart of accounts was delegated to me.** I chose the conventional Iranian trading layout
   above, and auditing it against its own group headers found a **real defect**: equity was numbered
   `22xx`, revenue `31xx`, and expenses `41xx` — each sitting inside the *previous* category's block,
   while the headers claimed `1000`=assets, `2000`=liabilities, `3000`=equity, `4000`=revenue.
   An account's type must be readable from its code; that was the entire point of a code.
   **Fixed:** equity `31xx`, revenue `41xx`, expenses `51xx`, plus a fifth group header `5000`. This
   is exactly why the question was worth asking — nobody had looked at the codes as a set.
3. **`1103` petty cash and `2102` cheques payable stay** (user, 2026-10-02). Both are seeded and
   unwritten; they make the taxonomy complete, and a seeded account costs nothing while a missing
   one forces a schema change on posted history later.

**If the business's accountant uses a different chart, say so now.** It remains the cheapest moment
in the whole project to change it — before a single posting exists.

---

## Implementation order, and what each step must prove

The dependency order is not negotiable: a screen that reads a ledger which does not exist yet is
worse than no screen.

| # | Step | Gate — it is not done until |
|---|---|---|
| 1 | Schema: `accounts`, `fiscal_periods`, `journals`, `ledger_entries`, triggers, seed the 24 accounts | `tests/tenancy-schema.test.ts` passes; triggers proven by an `UPDATE`/`DELETE` that throws |
| 2 | `postJournal` + `postJournalIn` in `lib/repo/ledger.ts` | a test posts a balanced journal, and an unbalanced one throws |
| 3 | Backfill + **the reconciliation gate** | `tests/ledger-reconciliation.test.ts` green, including idempotency |
| 4 | Cut `recordPaymentTxn` over | every existing payments test still passes — `tests/payments-repo.test.ts`, `tests/delivery-payment.test.ts`, `tests/legacy-payment-backfill.test.ts`, `tests/tenancy-isolation.test.ts` |
| 5 | `suppliers` + the `purchases` rebuild migration | migration is idempotent; two same-named suppliers stay distinct |
| 6 | AP and expenses write paths | zero-cost purchase posts no journal; overpayment goes to 1301 |
| 7 | The six reports | trial balance equal; balance sheet balances; a closed period stays readable |
| 8 | Nav, role gates, the payments screen | `SectionHead` satisfied; `proxy` gates re-checked in the routes |

**Steps 1–3 are invisible to users and are where the risk lives.** Step 4 is the moment money
starts moving through two systems at once, which is why its gate is the whole existing payments
test suite rather than a new test.

### `paid_toman` and `payment_status` are NOT migrated

Worth stating explicitly, because it is the one place the ledger and an existing cache overlap.
`orders.paid_toman` and `orders.payment_status` remain derived from `payment_allocations` via
`recomputeOrderPaymentTxn`, exactly as today. They are an **allocation** concept — which orders a
payment covered — and the ledger answers a different question (which accounts moved).

The cutover therefore does **not** re-derive `paid_toman` from the ledger, and must not: the
allocation is the authority for that column, and it already is. What changes is only that a receipt
now *also* writes postings. Two mechanisms, two questions, no overlap — which is the same reason
revenue is not recognised on payment.