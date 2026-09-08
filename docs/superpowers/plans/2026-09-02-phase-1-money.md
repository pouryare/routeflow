# RouteFlow Phase 1 — Money — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a real money ledger — a `payments` table with methods and receipts, a full Iranian `cheques` lifecycle, and customer debt computed from unpaid orders instead of a frozen imported number.

**Architecture:** A payment is an append-only row; it settles orders through `payment_allocations` (FIFO auto-split, remainder on account). `orders.paid_toman` becomes a cache recomputed from allocations by `recomputeOrderPayment`. Cheques are a state machine (`lib/chequeStates.ts`) whose `bounced` transition reverses the linked payment's allocations. Debt is `opening_balance + Σ delivered order totals − Σ allocations`, aged into three buckets by `customerDebt`. All new SQL lives in `lib/repo/`.

**Tech Stack:** Next.js 16 (see `AGENTS.md` — read `node_modules/next/dist/docs/` before touching routes), TypeScript, `node:sqlite` (`DatabaseSync`), vitest. Money = whole Toman in `INTEGER` via `lib/money.ts`.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-1-money-design.md`

## Global Constraints

- **Branch `phase-1-money`.** Never commit to `main`. Never run `npm run build` or `systemctl restart routeflow`. The whole branch stack merges and deploys after Phase 10.
- **Money is whole Toman in `INTEGER NOT NULL`.** No `REAL` money columns. Use `sumToman` / `roundToman` from `lib/money.ts`.
- **Dates:** ISO/Gregorian stored, Jalali shown (`lib/jalali.ts`, `lib/format.ts`).
- **Migrations** are idempotent and `PRAGMA table_info` / constraint-guarded, table-rebuild style (`PRAGMA foreign_keys = OFF; BEGIN; CREATE new; INSERT…SELECT; DROP; ALTER RENAME; recreate indexes; COMMIT; PRAGMA foreign_keys = ON`). They run against live data on the next deploy.
- **All new DB access goes through `lib/repo/`.** `tests/repo-boundary.test.ts` fails the build if `.prepare(` / `.exec("<sql>")` appears in a new `app/` or `lib/` file not on `tests/fixtures/raw-sql-allowlist.txt`. Put hand-written SQL inside a repo module and expose a function.
- **A row from another tenant answers 404, not 403.** User-facing text is Persian; identifiers are English.
- **Before every commit:** `npx tsc --noEmit` green, `npx eslint app/ lib/` green (full-repo `eslint` OOMs in the sandbox — lint changed files individually if needed), `npx vitest run` green. After adding/removing a route: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Run vitest in the background and poll (`until grep -qE "Test Files" out; do sleep 5; done`) — the full suite exceeds a 2-minute foreground timeout.

---

### Task 1: `payments` + `payment_allocations` tables; widen `photos.entity_type`

**Files:**
- Modify: `lib/db.ts` (schema block near the other `CREATE TABLE IF NOT EXISTS`; `photos` rebuild alongside the existing `activity_log`/`visit_plans` rebuilds ~line 1360)
- Test: `tests/payments-schema.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `payments` (columns per spec §Data model), `payment_allocations`; `photos.entity_type` CHECK now includes `'payment'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pay-schema-${Date.now()}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("payments schema", () => {
  it("creates payments with an INTEGER amount and a method CHECK", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(payments)").all() as { name: string; type: string; notnull: number }[];
    const amount = cols.find((c) => c.name === "amount_toman");
    expect(amount?.type).toBe("INTEGER");
    expect(amount?.notnull).toBe(1);
    expect(() =>
      db.prepare(
        "INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,1,1000,'WIRE','x',1,'x')"
      ).run()
    ).toThrow();
  });

  it("creates payment_allocations with a nullable order_id", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(payment_allocations)").all() as { name: string; notnull: number }[];
    expect(cols.find((c) => c.name === "order_id")?.notnull).toBe(0);
    expect(cols.find((c) => c.name === "amount_toman")?.notnull).toBe(1);
  });

  it("lets photos.entity_type be 'payment'", () => {
    const db = getDb();
    const sql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='photos'").get() as { sql: string }).sql;
    expect(sql).toContain("'payment'");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/payments-schema.test.ts`
Expected: FAIL — `no such table: payments`.

- [ ] **Step 3: Add the schema**

In `lib/db.ts`, in the main `db.exec(\`…\`)` schema string (with the other `CREATE TABLE IF NOT EXISTS`), add:

```sql
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  amount_toman INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN
    ('CASH','POS','CARD_TO_CARD','CHEQUE','CREDIT_NOTE','OTHER')),
  received_at TEXT NOT NULL,
  received_by INTEGER NOT NULL REFERENCES users(id),
  reference TEXT,
  receipt_photo_stem TEXT,
  cheque_id INTEGER,
  note TEXT,
  voided_at TEXT,
  voided_by INTEGER REFERENCES users(id),
  void_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payments_customer ON payments (organization_id, customer_id, received_at);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  order_id INTEGER REFERENCES orders(id),
  amount_toman INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alloc_order ON payment_allocations (order_id);
```

(`cheque_id` gets its `REFERENCES cheques(id)` in Task 8 when that table exists — a bare column now avoids a forward reference. Note it in a comment.)

Then widen `photos.entity_type`. Follow the existing `visit_plans` rebuild pattern (~line 1360): guard on the CHECK text, `PRAGMA foreign_keys = OFF; BEGIN; CREATE photos_new (… entity_type TEXT NOT NULL CHECK (entity_type IN ('district','customer','payment')) …); INSERT INTO photos_new SELECT … FROM photos; DROP TABLE photos; ALTER TABLE photos_new RENAME TO photos; recreate idx_photos_entity; COMMIT; PRAGMA foreign_keys = ON;`.

```ts
const photosSql = (db.prepare("SELECT sql FROM sqlite_master WHERE name='photos'").get() as { sql: string } | undefined)?.sql ?? "";
if (photosSql && !photosSql.includes("'payment'")) {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE photos_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'payment')),
        entity_id INTEGER NOT NULL,
        file_stem TEXT UNIQUE NOT NULL,
        caption TEXT,
        taken_at TEXT NOT NULL,
        taken_by TEXT
      );
      INSERT INTO photos_new SELECT id, entity_type, entity_id, file_stem, caption, taken_at, taken_by FROM photos;
      DROP TABLE photos;
      ALTER TABLE photos_new RENAME TO photos;
      CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id, taken_at);
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}
```

First verify the exact `photos` column list with `sed -n` on `lib/db.ts` and copy it verbatim into `photos_new` (the block above is the shape as of writing — do not trust it blind).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/payments-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + commit**

Run `npx tsc --noEmit && npx eslint app/ lib/`, then vitest full suite in the background and poll.

```bash
git add lib/db.ts tests/payments-schema.test.ts
git commit -m "Add payments and payment_allocations tables; widen photos.entity_type for receipts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 2: `lib/repo/payments.ts` — record, allocate, FIFO, recompute, void

**Files:**
- Create: `lib/repo/payments.ts`
- Test: `tests/payments-repo.test.ts` (create)

**Interfaces:**
- Consumes: `makeRepo` from `lib/repo/base.ts`; `sumToman` from `lib/money.ts`; `orderTotalToman` + `linesOf`-equivalent — read order totals with a dedicated query inside this module (do **not** import from `lib/orders.ts`, which has no exported per-order total helper; sum `order_lines` via `lib/orderMath.ts`'s `lineTotalToman`).
- Produces:
  - `export class PaymentError extends Error {}`
  - `export interface PaymentRow { id; organization_id; customer_id; amount_toman; method: PaymentMethod; received_at; received_by; reference: string | null; receipt_photo_stem: string | null; cheque_id: number | null; note: string | null; voided_at: string | null; voided_by: number | null; void_reason: string | null; created_at }`
  - `export type PaymentMethod = "CASH" | "POS" | "CARD_TO_CARD" | "CHEQUE" | "CREDIT_NOTE" | "OTHER"`
  - `export interface AllocationInput { order_id: number | null; amount_toman: number }`
  - `export const paymentsRepo` (`makeRepo<PaymentRow>("payments", { tenant: true })`)
  - `export function recordPayment(organizationId: number, input: { customer_id; amount_toman; method; received_at; received_by; reference?; receipt_photo_stem?; cheque_id?; note?; allocations?: AllocationInput[] }): number` — inserts the payment, then either uses `input.allocations` (validated) or calls `autoAllocateFIFO`; one transaction; calls `recomputeOrderPayment` for each touched order. Returns payment id.
  - `export function autoAllocateFIFO(organizationId: number, customerId: number, amount_toman: number): AllocationInput[]` — oldest unpaid **delivered** orders first (`order_date`, then `id`), each filled up to its outstanding balance (`total − paid_toman`), remainder as `{ order_id: null, amount_toman: rest }`. Pure-ish: reads DB, returns the split, writes nothing.
  - `export function voidPayment(organizationId: number, id: number, voidedBy: number, reason: string): void` — sets `voided_at/voided_by/void_reason`, deletes its allocations, recomputes every previously-touched order. Throws `PaymentError` if already voided or not found.
  - `export function recomputeOrderPayment(organizationId: number, orderId: number): void` — `paid = SUM(amount_toman)` over `payment_allocations a JOIN payments p ON p.id = a.payment_id` where `a.order_id = ?` and `p.voided_at IS NULL` and `p.organization_id = ?`; `UPDATE orders SET paid_toman = ?, payment_status = ? WHERE id = ? AND organization_id = ?` with status `paid` if `paid >= total && total > 0`, `partial` if `paid > 0`, else `unpaid`.
  - `export function allocationsOfPayment(organizationId: number, paymentId: number): { order_id: number | null; amount_toman: number }[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pay-repo-${Date.now()}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { recordPayment, autoAllocateFIFO, voidPayment, recomputeOrderPayment, allocationsOfPayment, PaymentError } =
  await import("@/lib/repo/payments");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

/** A delivered order worth `total` Toman: one line, price = total, one pack. */
function deliveredOrder(total: number, dateISO = "2026-01-01"): number {
  const db = getDb();
  const now = new Date().toISOString();
  const orderId = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id) VALUES (?,?,?,'delivered',?,?,?,?,1)"
    ).run(`o-${Math.random().toString(36).slice(2)}`, custId, dateISO, dateISO, userId, now, now).lastInsertRowid
  );
  // product + packaging + price so lineTotalToman(row) === total
  const productId = Number(db.prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)").run(`p${orderId}`, `s${orderId}`, now, now).lastInsertRowid);
  const packId = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,?,1,?)").run(productId, "box", now).lastInsertRowid);
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at) VALUES (?,?,?,1,1,?,0,1,1,0,?)"
  ).run(orderId, productId, packId, total, now);
  return orderId;
}

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;");
  const now = new Date().toISOString();
  userId = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)").run(`u${Date.now()}`, "x:y", "م", now).lastInsertRowid);
  custId = Number(db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)").run(`C${Date.now()}`, "x").lastInsertRowid);
});

describe("recordPayment", () => {
  it("auto-allocates FIFO across delivered orders, remainder on account", () => {
    const o1 = deliveredOrder(30_000, "2026-01-01");
    const o2 = deliveredOrder(50_000, "2026-01-05");
    const pid = recordPayment(1, { customer_id: custId, amount_toman: 100_000, method: "CASH", received_at: "2026-02-01", received_by: userId });
    const allocs = allocationsOfPayment(1, pid);
    expect(allocs).toEqual([
      { order_id: o1, amount_toman: 30_000 },
      { order_id: o2, amount_toman: 50_000 },
      { order_id: null, amount_toman: 20_000 },
    ]);
    const db = getDb();
    expect((db.prepare("SELECT paid_toman,payment_status FROM orders WHERE id=?").get(o1) as any).payment_status).toBe("paid");
    expect((db.prepare("SELECT payment_status FROM orders WHERE id=?").get(o2) as any).payment_status).toBe("paid");
  });

  it("honours an explicit allocation split and rejects one that overshoots the payment", () => {
    const o1 = deliveredOrder(30_000);
    const pid = recordPayment(1, {
      customer_id: custId, amount_toman: 20_000, method: "POS", received_at: "2026-02-01", received_by: userId,
      allocations: [{ order_id: o1, amount_toman: 20_000 }],
    });
    expect((getDb().prepare("SELECT payment_status FROM orders WHERE id=?").get(o1) as any).payment_status).toBe("partial");
    expect(() =>
      recordPayment(1, {
        customer_id: custId, amount_toman: 20_000, method: "POS", received_at: "2026-02-01", received_by: userId,
        allocations: [{ order_id: o1, amount_toman: 25_000 }],
      })
    ).toThrow(PaymentError);
  });

  it("rejects a non-integer amount", () => {
    expect(() =>
      recordPayment(1, { customer_id: custId, amount_toman: 10.5, method: "CASH", received_at: "x", received_by: userId })
    ).toThrow(PaymentError);
  });
});

describe("voidPayment", () => {
  it("removes allocations and reverts the order caches", () => {
    const o1 = deliveredOrder(30_000);
    const pid = recordPayment(1, { customer_id: custId, amount_toman: 30_000, method: "CASH", received_at: "2026-02-01", received_by: userId });
    voidPayment(1, pid, userId, "خطای ثبت");
    const db = getDb();
    expect(db.prepare("SELECT COUNT(*) n FROM payment_allocations WHERE payment_id=?").get(pid)).toEqual({ n: 0 });
    expect((db.prepare("SELECT paid_toman,payment_status FROM orders WHERE id=?").get(o1) as any)).toMatchObject({ paid_toman: 0, payment_status: "unpaid" });
    expect(() => voidPayment(1, pid, userId, "دوباره")).toThrow(PaymentError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/payments-repo.test.ts`
Expected: FAIL — cannot find module `@/lib/repo/payments`.

- [ ] **Step 3: Implement `lib/repo/payments.ts`**

Write the module to the interface above. Key points:
- Validate every `amount_toman` with `Number.isInteger`; throw `PaymentError("مبلغ باید عدد صحیح تومان باشد")` otherwise.
- `recordPayment`: `db.exec("BEGIN IMMEDIATE")` … `COMMIT` / `ROLLBACK`. Insert payment via `paymentsRepo.insert` is fine, but the allocation inserts + recompute must be in the same transaction, so use `paymentsRepo.db()` and hand-write inside the txn.
- Explicit allocations: `sumToman(allocations.map(a => a.amount_toman))` must equal `amount_toman` → else `PaymentError("جمع تخصیص‌ها با مبلغ دریافت برابر نیست")`. Per order, `existing paid + this allocation` must be `<= order total` unless `input.allow_overpay` (add that optional flag, default false) → `PaymentError("تخصیص از باقی‌ماندهٔ سفارش بیشتر است")`.
- Cross-tenant guard: every `order_id` in an allocation must belong to a customer in `organizationId` → else `PaymentError` (this is the 404-not-403 rule at the data layer).
- Order outstanding balance query (inside the module):

```sql
SELECT o.id, o.order_date, o.paid_toman,
       COALESCE((SELECT SUM(ol.packs_delivered * ol.unit_price_toman)  -- see lineTotalToman for the real formula
                   FROM order_lines ol WHERE ol.order_id = o.id), 0) AS total_toman
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
 WHERE o.customer_id = ? AND c.organization_id = ? AND o.status = 'delivered'
 ORDER BY o.order_date, o.id
```

Use `lineTotalToman` from `lib/orderMath.ts` per line rather than inlining the arithmetic — read that file and mirror it exactly (`effectivePacks` handles `packs_delivered ?? packs_ordered` and reversals).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/payments-repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repo/payments.ts tests/payments-repo.test.ts
git commit -m "Add lib/repo/payments: record, FIFO auto-allocate, void, recompute cache

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 3: `customerDebt` — computed aged debt with opening balance

**Files:**
- Modify: `lib/repo/payments.ts` (add `customerDebt` + a batch helper)
- Test: `tests/customer-debt.test.ts` (create)

**Interfaces:**
- Consumes: the order-total query from Task 2.
- Produces:
  - `export interface CustomerDebt { total: number; bucket_0_7: number; bucket_8_30: number; bucket_30_plus: number }`
  - `export function customerDebt(organizationId: number, customerId: number, asOf?: string): CustomerDebt` — `total = opening_balance_toman + Σ(delivered order total) − Σ(non-voided allocations for that customer's orders + on-account allocations for that customer)`. Buckets: for each still-unpaid **delivered** order, age `asOf − order.delivered_at` in days → `<8` → `bucket_0_7`, `<31` → `bucket_8_30`, else `bucket_30_plus`, adding that order's outstanding (`total − paid_toman`, floored at 0). `opening_balance_toman` is added wholly to `bucket_30_plus`. `asOf` defaults to `new Date().toISOString()`.
  - `export function customerDebtsForOrg(organizationId: number, asOf?: string): Map<number, CustomerDebt>` — one pass for the dashboard, so `lib/dashboard.ts` does not loop `customerDebt` per row.
- NOTE: Task 3 lands **before** the migration in Task 4. Until Task 4, `customers` has no `opening_balance_toman` column — so in Task 3 write `customerDebt` to read it as `COALESCE((SELECT opening_balance_toman FROM customers WHERE id = ?), 0)` guarded by a `PRAGMA table_info` check that falls back to `0`. Task 4 removes the fallback. (Alternative: reorder — do the migration first. Keep this order so the debt maths is tested in isolation.)

- [ ] **Step 1: Write the failing test**

```ts
// setup identical to tests/payments-repo.test.ts (share the deliveredOrder helper — copy it in)
describe("customerDebt", () => {
  it("is opening balance plus unpaid delivered orders, aged by delivered_at", () => {
    const o1 = deliveredOrder(30_000, "2026-01-01"); // delivered_at 2026-01-01
    deliveredOrder(50_000, "2026-02-25");            // recent
    const d = customerDebt(1, custId, "2026-03-01T00:00:00Z");
    // o1 ~59d -> 30_plus ; o2 ~4d -> 0_7
    expect(d.bucket_30_plus).toBe(30_000);
    expect(d.bucket_0_7).toBe(50_000);
    expect(d.total).toBe(80_000);
  });

  it("subtracts allocations and drops an order out of the buckets once paid", () => {
    const o1 = deliveredOrder(30_000, "2026-01-01");
    recordPayment(1, { customer_id: custId, amount_toman: 30_000, method: "CASH", received_at: "2026-01-02", received_by: userId });
    const d = customerDebt(1, custId, "2026-03-01T00:00:00Z");
    expect(d.total).toBe(0);
    expect(d.bucket_30_plus).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/customer-debt.test.ts`
Expected: FAIL — `customerDebt is not a function`.

- [ ] **Step 3: Implement `customerDebt` + `customerDebtsForOrg`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/customer-debt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repo/payments.ts tests/customer-debt.test.ts
git commit -m "Add customerDebt: aged debt computed from orders and allocations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 4: Migration — drop `debt_*`, add `opening_balance_toman DEFAULT 0`

**Files:**
- Modify: `lib/db.ts` (new guarded table-rebuild after the Phase 0b `customers_m2_new` block ~line 1490; also drop `debt_*` from `CustomerRow` ~line 1540 and every intermediate `customers_*_new` CREATE that still lists them is fine — only the *final* shape matters, but the new rebuild must not re-add them)
- Modify: `lib/types.ts` (`CustomerRow`, `Customer` — drop `debt_0_7/8_30/30_plus`, add `opening_balance_toman: number`; `debtColor` rewritten to take `CustomerDebt`)
- Modify: `lib/customers.ts` (row map: drop the three, add `opening_balance_toman`)
- Test: `tests/customer-opening-balance-migration.test.ts` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `customers` has `opening_balance_toman INTEGER NOT NULL DEFAULT 0` and no `debt_0_7/debt_8_30/debt_30_plus`. `customerDebt` (Task 3) drops its `PRAGMA` fallback and reads the column directly.

- [ ] **Step 1: Write the failing test**

```ts
const testDbPath = path.join(os.tmpdir(), `rf-openbal-${Date.now()}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe("opening balance migration", () => {
  it("drops the debt_* columns and adds opening_balance_toman defaulting to 0", () => {
    const cols = (getDb().prepare("PRAGMA table_info(customers)").all() as { name: string; type: string; notnull: number; dflt_value: string }[]);
    const names = cols.map((c) => c.name);
    expect(names).not.toContain("debt_0_7");
    expect(names).not.toContain("debt_8_30");
    expect(names).not.toContain("debt_30_plus");
    const ob = cols.find((c) => c.name === "opening_balance_toman");
    expect(ob).toMatchObject({ type: "INTEGER", notnull: 1 });
    expect(String(ob?.dflt_value)).toBe("0");
  });

  it("seeds every existing customer at 0", () => {
    const db = getDb();
    db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('OB1','x','active','2026-01-01',1)").run();
    const row = db.prepare("SELECT opening_balance_toman FROM customers WHERE customer_code='OB1'").get() as { opening_balance_toman: number };
    expect(row.opening_balance_toman).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/customer-opening-balance-migration.test.ts`
Expected: FAIL — `debt_0_7` still present.

- [ ] **Step 3: Add the migration**

After the `customers_m2_new` block, guard on the *absence* of `debt_0_7` OR presence of `opening_balance_toman`:

```ts
const custDebtCols = (db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name);
if (custDebtCols.includes("debt_0_7")) {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE customers_ob_new (
        <every current customers column EXCEPT debt_0_7/debt_8_30/debt_30_plus, verbatim from PRAGMA/sqlite_master>,
        opening_balance_toman INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO customers_ob_new (<column list without debt_* and without opening_balance_toman>)
        SELECT <same list> FROM customers;
      DROP TABLE customers;
      ALTER TABLE customers_ob_new RENAME TO customers;
      CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
      <recreate every other index that existed on customers — check sqlite_master first>
    `);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  finally { db.exec("PRAGMA foreign_keys = ON;"); }
  console.info("[migrate] customers.debt_* dropped; opening_balance_toman added (0)");
}
```

Get the real column list with `sed -n` on `lib/db.ts` around the `customers_m2_new` CREATE and from `PRAGMA table_info`. `opening_balance_toman` is **not** in the INSERT list — it takes its `DEFAULT 0`.

Then: `lib/types.ts` — remove `debt_0_7/8_30/30_plus` from `CustomerRow` and `Customer`, add `opening_balance_toman: number`. Rewrite `debtColor`:

```ts
import type { CustomerDebt } from "@/lib/repo/payments";
export function debtColor(debt: CustomerDebt): string {
  if (debt.bucket_30_plus > 0) return STATUS_COLOR.not_allowed;
  if (debt.bucket_8_30 > 0) return STATUS_COLOR.needs_coverage;
  return "inherit";
}
```

`lib/customers.ts` — swap the three `debt_*` fields in the row map for `opening_balance_toman: r.opening_balance_toman`.

Finally, in `lib/repo/payments.ts` `customerDebt`, remove the `PRAGMA table_info` fallback and read `opening_balance_toman` directly.

`tsc` will now surface every consumer — Task 5 fixes them. Add a `// @ts-expect-error phase-1 task 5` **only if** a consumer blocks the suite; prefer fixing forward in this same commit if small.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/customer-opening-balance-migration.test.ts tests/customer-debt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (do not push a red `tsc` — if consumers break, fold Task 5 into this commit)

```bash
git add lib/db.ts lib/types.ts lib/customers.ts lib/repo/payments.ts tests/customer-opening-balance-migration.test.ts
git commit -m "Migrate customers: drop demo debt_* columns, add opening_balance_toman

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Switch every `debt_*` consumer to computed debt

**Files:**
- Modify: `lib/dashboard.ts:187` (the `SUM(debt_0_7)` query → `customerDebtsForOrg`)
- Modify: `lib/customerSummary.ts:59,141` (`balance` / `balance_over_30` from `customerDebt`)
- Modify: `app/analytics/page.tsx:49-51`, `app/report/page.tsx:92-94,122-124,288-290`, `components/CsvExportButton.tsx:27-29,68-70`, `components/CustomerDetailPanel.tsx:38-40` (`debtTier`), `components/HeatmapLayer.tsx:36-38`, `app/sales/orders/new/page.tsx:40`
- Test: extend `tests/dashboard*.test.ts` if present; add `tests/debt-consumers.test.ts` for `dashboard` aged totals

**Interfaces:**
- Consumes: `customerDebt`, `customerDebtsForOrg`, `CustomerDebt` from `lib/repo/payments.ts`.
- Produces: no `debt_0_7/8_30/30_plus` reference anywhere (`grep -rn "debt_0_7" app lib components` returns nothing).

- [ ] **Step 1: Write the failing test**

```ts
// tests/debt-consumers.test.ts — temp DB, seed 1 customer + 1 delivered unpaid old order worth 40_000
import { buildDashboard } from "@/lib/dashboard"; // use the real exported entry point — check its name/signature first
it("dashboard aged-debt totals come from computed debt", async () => {
  // ...seed...
  const dash = buildDashboard(/* scope for org 1 */);
  expect(dash.debt.over_30).toBe(40_000);
  expect(dash.debt.d0_7).toBe(0);
});
```

Inspect `lib/dashboard.ts` for the actual exported function and shape first; mirror it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/debt-consumers.test.ts`
Expected: FAIL (still reads the dropped column → SQLite error `no such column: debt_0_7`).

- [ ] **Step 3: Rewrite each consumer**

- `lib/dashboard.ts`: replace the `SELECT COALESCE(SUM(debt_0_7)…)` with a call to `customerDebtsForOrg(organizationId)` and sum the three buckets across the map (respecting the existing group scope — filter the map by the customers in scope, or add an `organizationId`+`groupIds` overload to `customerDebtsForOrg`).
- `lib/customerSummary.ts`: `balance = customerDebt(orgId, id).total`, `balance_over_30 = customerDebt(orgId, id).bucket_30_plus`.
- `app/analytics/page.tsx`, `app/report/page.tsx`: these are server components that currently read `c.debt_0_7` off a customers query — give them the computed figure. Add the org's debt map alongside the customers fetch and index by id: `const debt = customerDebtsForOrg(session.organizationId); … acc.d0_7 += (debt.get(c.id)?.bucket_0_7 ?? 0)`.
- `components/CsvExportButton.tsx`: its `Row` type loses the three fields, gains `debt_0_7`/`debt_8_30`/`debt_30_plus` **as computed numbers passed in by the parent** (keep the CSV columns — the header text is fine — just source the values from `customerDebt`). Simplest: parent (`app/report/page.tsx`) passes `debt_0_7: debt.get(c.id)?.bucket_0_7 ?? 0` etc.
- `components/CustomerDetailPanel.tsx` `debtTier(c)`: takes a `CustomerDebt` now. The panel needs the computed debt — Task 11's `/api/customers/[id]/statement` returns it, but the panel already loads customer data; add `debt` to whatever endpoint feeds it (or fetch the statement). Minimal for this task: change `debtTier` signature to `(debt: CustomerDebt)` and have the caller pass `customer.debt` (a new optional field on the client `Customer` shape, populated in Task 11); until then it renders nothing, which is acceptable mid-stack.
- `components/HeatmapLayer.tsx`: same — needs `c.debt` computed; if the heatmap customer feed does not carry it yet, gate the debt-weight branch on `c.debt` being present.
- `app/sales/orders/new/page.tsx:40`: the inline `COALESCE(debt_0_7,0)+…` in a customers query → replace with a per-customer `customerDebt(session.organizationId, c.id).total` mapped after the fetch, or a subquery-free join. Keep it server-side.

- [ ] **Step 4: Run the full suite**

Run: `npx tsc --noEmit` (must be clean — no `debt_0_7` type refs), then vitest full suite in background + poll.
Expected: PASS. `grep -rn "debt_0_7\|debt_8_30\|debt_30_plus" app lib components` → only comments, if any.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Point every debt consumer at computed customerDebt

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 6: `recordDelivery` stops writing `paid_toman` by hand

**Files:**
- Modify: `lib/delivery.ts:225-245` (the `UPDATE orders SET … paid_toman …`)
- Test: `tests/delivery-payment.test.ts` (create) — or extend `tests/delivery*.test.ts`

**Interfaces:**
- Consumes: `recordPayment` from `lib/repo/payments.ts`.
- Produces: after `recordDelivery` with `collected_toman > 0`, there is a `payments` row (`method='CASH'`, `received_by = input.by`, `received_at = delivered_at`) allocated to that order, and `orders.paid_toman` equals it via `recomputeOrderPayment`. `delivery_stops.collected_toman` is still written as before.

- [ ] **Step 1: Write the failing test**

```ts
it("a door collection becomes a CASH payment allocated to the order", () => {
  // build a confirmed order with a known total, a run, a stop; then:
  recordDelivery(db, stopId, { lines: [{ line_id, packs_delivered: <all> }], collected_toman: 25_000, by: driverId, notes: null });
  const pay = db.prepare("SELECT * FROM payments WHERE customer_id = ?").get(custId) as any;
  expect(pay).toMatchObject({ method: "CASH", amount_toman: 25_000, received_by: driverId });
  const alloc = db.prepare("SELECT order_id, amount_toman FROM payment_allocations WHERE payment_id = ?").get(pay.id);
  expect(alloc).toMatchObject({ order_id: orderId, amount_toman: 25_000 });
  expect((db.prepare("SELECT paid_toman, payment_status FROM orders WHERE id = ?").get(orderId) as any)).toMatchObject({ paid_toman: 25_000 });
});

it("records nothing when collected_toman is 0", () => {
  recordDelivery(db, stopId, { lines: [...], collected_toman: 0, by: driverId, notes: null });
  expect(db.prepare("SELECT COUNT(*) n FROM payments").get()).toEqual({ n: 0 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/delivery-payment.test.ts`
Expected: FAIL — no `payments` row.

- [ ] **Step 3: Rewrite the `orders` UPDATE in `recordDelivery`**

Keep the `delivery_stops` UPDATE. Replace the `orders` UPDATE so it only sets `status`, `delivered_at`, `updated_at` (drop `paid_toman` and `payment_status` from the hand-written SET). Then, still inside the same transaction, if `!nothingTaken && input.collected_toman > 0`:

```ts
recordPayment(orgIdOfThisOrder, {
  customer_id: <order's customer_id>,
  amount_toman: input.collected_toman,
  method: "CASH",
  received_at: now,
  received_by: input.by,
  note: "دریافت درِ محل",
  allocations: [{ order_id: stop.order_id, amount_toman: Math.min(input.collected_toman, total) }],
  // remainder (overpay at the door) -> on account:
  ...(input.collected_toman > total ? {} : {}),
});
```

`recordPayment` opens its own `BEGIN IMMEDIATE`; nested `BEGIN` throws in SQLite. Resolve by **either** (a) refactoring `recordPayment` to detect an existing transaction (`db.prepare("SELECT * FROM sqlite_master LIMIT 0")` won't tell you — instead add an internal `recordPaymentTxn(db, …)` that assumes a transaction and have `recordPayment` wrap it), **or** (b) move the `recordPayment` call to *after* `db.exec("COMMIT")` in `recordDelivery`, accepting a two-transaction window. Choose (a): add `export function recordPaymentTxn(...)` to `lib/repo/payments.ts` and call that here; `recordPayment` becomes `BEGIN IMMEDIATE; recordPaymentTxn(...); COMMIT`. Update Task 2's tests only if signatures change (they should not — `recordPayment` keeps its shape).

Need the order's `customer_id` and `organization_id` — read them in `recordDelivery` (it already reads the stop; extend the SELECT to join `orders`).

If `collected_toman > total` (door overpayment), pass `allocations: [{order_id, total}, {order_id: null, collected - total}]`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/delivery-payment.test.ts` then the full suite (delivery tests, order tests, dashboard).
Expected: PASS. Existing delivery tests that asserted `orders.paid_toman` after `recordDelivery` still pass because `recomputeOrderPayment` sets the same number.

- [ ] **Step 5: Commit**

```bash
git add lib/delivery.ts lib/repo/payments.ts tests/delivery-payment.test.ts
git commit -m "recordDelivery writes a CASH payment instead of stamping paid_toman

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 7: Backfill synthetic CASH payments for legacy `orders.paid_toman > 0`

**Files:**
- Modify: `lib/db.ts` (a one-shot, `app_meta`-guarded backfill after the migrations; new export `backfillLegacyPayments(db)`)
- Test: `tests/legacy-payment-backfill.test.ts` (create)

**Interfaces:**
- Consumes: `payments` / `payment_allocations` tables.
- Produces: for every order with `paid_toman > 0` and no existing allocation, one `payments` row (`method='CASH'`, `received_at = COALESCE(delivered_at, order_date)`, `received_by = created_by`, `note = 'انتقال از سیستم قبلی'`) allocated to it (capped at the order total, flagged in `note` if capped). Guarded on `app_meta` key `legacy_payment_backfill_done`. Idempotent.

- [ ] **Step 1: Write the failing test**

```ts
it("creates one synthetic CASH payment per pre-existing paid order, once", () => {
  const db = getDb();
  // seed an order with paid_toman = 12_000 directly (simulating pre-Phase-1 data), total 12_000
  // trigger the backfill: it runs inside getDb()'s migrate on first open; to re-test, call backfillLegacyPayments(db) directly
  const { backfillLegacyPayments } = await import("@/lib/db");
  backfillLegacyPayments(db);
  const p = db.prepare("SELECT * FROM payments WHERE method='CASH'").all() as any[];
  expect(p).toHaveLength(1);
  expect(p[0].amount_toman).toBe(12_000);
  backfillLegacyPayments(db); // idempotent
  expect(db.prepare("SELECT COUNT(*) n FROM payments").get()).toEqual({ n: 1 });
});

it("caps a synthetic payment at the order total and notes it", () => {
  // order total 10_000 but paid_toman 15_000 (bad legacy data)
  // expect amount_toman 10_000 and note contains a cap marker
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/legacy-payment-backfill.test.ts`
Expected: FAIL — `backfillLegacyPayments` not exported.

- [ ] **Step 3: Implement `backfillLegacyPayments`**

```ts
export function backfillLegacyPayments(db: DatabaseSync): void {
  const done = db.prepare("SELECT value FROM app_meta WHERE key='legacy_payment_backfill_done'").get();
  if (done) return;
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT o.id, o.customer_id, o.organization_id, o.created_by, o.paid_toman,
           COALESCE(o.delivered_at, o.order_date) AS when_paid,
           COALESCE((SELECT SUM(<lineTotalToman formula>) FROM order_lines ol WHERE ol.order_id = o.id), 0) AS total_toman
      FROM orders o
     WHERE o.paid_toman > 0
       AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id)
  `).all() as any[];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const o of rows) {
      const capped = Math.min(o.paid_toman, o.total_toman || o.paid_toman);
      const note = capped < o.paid_toman ? "انتقال از سیستم قبلی (سقف‌گذاری‌شده)" : "انتقال از سیستم قبلی";
      const pid = Number(db.prepare(
        `INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,note,created_at)
         VALUES (?,?,?,'CASH',?,?,?,?)`
      ).run(o.organization_id, o.customer_id, capped, o.when_paid, o.created_by, note, now).lastInsertRowid);
      db.prepare("INSERT INTO payment_allocations (payment_id,order_id,amount_toman,created_at) VALUES (?,?,?,?)")
        .run(pid, o.id, capped, now);
    }
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES ('legacy_payment_backfill_done',?)").run(now);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
```

Call it from the migrate path after the schema + `opening_balance` migration and after `foldLeadPinsIntoCustomers`. Use the real `lineTotalToman` arithmetic — factor a SQL fragment constant if it is reused (Tasks 2, 3, 7 all need it).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/legacy-payment-backfill.test.ts` + full suite.
Expected: PASS.

- [ ] **Step 5: Verify against the real backup, then commit**

```bash
# take a copy of the real DB via the SQLite backup API (never cp — WAL), then:
ROUTEFLOW_MIGRATION_CHECK_DB=/path/to/backup-copy.db npx vitest run tests/legacy-payment-backfill.test.ts
```

(If a `ROUTEFLOW_MIGRATION_CHECK_DB` harness does not already exist in the repo, mirror the Phase 0b migration-check test that used it; otherwise just note in the commit body that the real-data check is deferred to the pre-deploy step.)

```bash
git add lib/db.ts tests/legacy-payment-backfill.test.ts
git commit -m "Backfill synthetic CASH payments for legacy paid_toman, guarded and idempotent

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 8: `cheques` table + `lib/chequeStates.ts` transition machine

**Files:**
- Modify: `lib/db.ts` (`cheques` table; add the deferred `REFERENCES cheques(id)` note to `payments.cheque_id` — SQLite cannot add an FK after the fact without a rebuild, so leave `payments.cheque_id` as a plain column and enforce the link in the repo)
- Create: `lib/chequeStates.ts`
- Test: `tests/cheque-states.test.ts` (create), `tests/cheques-schema.test.ts` (create or fold into payments-schema)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - table `cheques` per spec §Data model (status CHECK `('issued','in_hand','deposited','cleared','bounced','replaced','cancelled')`, `UNIQUE (organization_id, customer_id, cheque_no)`)
  - `export type ChequeStatus = "issued" | "in_hand" | "deposited" | "cleared" | "bounced" | "replaced" | "cancelled"`
  - `export const CHEQUE_TRANSITIONS: Record<ChequeStatus, ChequeStatus[]>` exactly:
    ```ts
    {
      issued: ["in_hand", "cancelled"],
      in_hand: ["deposited", "bounced", "replaced", "cancelled"],
      deposited: ["cleared", "bounced"],
      cleared: [],
      bounced: ["replaced"],
      replaced: [],
      cancelled: [],
    }
    ```
  - `export function canAdvanceCheque(from: ChequeStatus, to: ChequeStatus): boolean`
  - `export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string>` (Persian: `issued`→«صادرشده», `in_hand`→«در دست», `deposited`→«به بانک سپرده شد», `cleared`→«وصول شد», `bounced`→«برگشت خورد», `replaced`→«جایگزین شد», `cancelled`→«باطل شد»)

- [ ] **Step 1: Write the failing test**

```ts
import { CHEQUE_TRANSITIONS, canAdvanceCheque } from "@/lib/chequeStates";
it("allows in_hand -> deposited but not in_hand -> cleared", () => {
  expect(canAdvanceCheque("in_hand", "deposited")).toBe(true);
  expect(canAdvanceCheque("in_hand", "cleared")).toBe(false);
});
it("treats cleared / replaced / cancelled as terminal", () => {
  for (const t of ["cleared", "replaced", "cancelled"] as const) expect(CHEQUE_TRANSITIONS[t]).toEqual([]);
});
it("only lets bounced go to replaced", () => {
  expect(CHEQUE_TRANSITIONS.bounced).toEqual(["replaced"]);
});
```

Plus a `tests/cheques-schema.test.ts` asserting the table + status CHECK + the `UNIQUE` triple (mirror Task 1).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cheque-states.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema + `lib/chequeStates.ts`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cheque-states.test.ts tests/cheques-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/chequeStates.ts tests/cheque-states.test.ts tests/cheques-schema.test.ts
git commit -m "Add cheques table and lib/chequeStates transition machine

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 9: `lib/repo/cheques.ts` — record, advance, bounce reversal

**Files:**
- Create: `lib/repo/cheques.ts`
- Modify: `lib/repo/payments.ts` (export a `reverseAllocationsForPayment(organizationId, paymentId, txn)` helper reused by bounce — or reuse `voidPayment`'s internals; a bounce is a void with `void_reason` `'چک برگشت خورد'`)
- Test: `tests/cheques-repo.test.ts` (create)

**Interfaces:**
- Consumes: `CHEQUE_TRANSITIONS`, `canAdvanceCheque` (Task 8); `recordPaymentTxn` / `voidPayment` (Tasks 2/6).
- Produces:
  - `export class ChequeError extends Error {}`
  - `export interface ChequeRow { id; organization_id; customer_id; amount_toman; cheque_no; bank_name: string | null; due_date; status: ChequeStatus; received_at; received_by; deposited_at: string | null; cleared_at: string | null; bounced_at: string | null; replaced_by_cheque_id: number | null; note: string | null; created_at; updated_at }`
  - `export const chequesRepo` (`makeRepo<ChequeRow>("cheques", { tenant: true })`)
  - `export function recordChequePayment(organizationId, input: { customer_id; amount_toman; cheque_no; bank_name?; due_date; received_at; received_by; note?; allocations?: AllocationInput[] }): { cheque_id: number; payment_id: number }` — one transaction: insert the cheque `in_hand`, insert a `payments` row `method='CHEQUE'` with `cheque_id` set, allocate (explicit or FIFO), recompute. `UNIQUE` violation on `(org, customer, cheque_no)` → `ChequeError("این شمارهٔ چک برای این مشتری قبلاً ثبت شده")`.
  - `export function advanceCheque(organizationId, id, to: ChequeStatus, actor: number, opts?: { replacement?: { cheque_no; due_date; bank_name?; amount_toman?; received_at? } }): void` — enforces `CHEQUE_TRANSITIONS`; stamps `deposited_at` / `cleared_at` / `bounced_at`; on `bounced` voids the linked payment (reversing allocations + recomputing every affected order) and inserts a `reminders` row (check the real table name/shape — `grep -n "CREATE TABLE.*reminder" lib/db.ts`) due today, text «چک {cheque_no} برگشت خورد — پیگیری کنید»; on `replaced` requires `opts.replacement`, creates the new cheque `in_hand` (via `recordChequePayment` semantics minus a second payment if the debt is already re-open — decide: replacement re-settles the same orders), sets `replaced_by_cheque_id`. Illegal transition → `ChequeError` → the route maps to 409.
  - `export function listCheques(organizationId, filter?: { status?: ChequeStatus; customer_id?: number }): ChequeRow[]`
  - `export function chequesByStatus(organizationId): Record<ChequeStatus, ChequeRow[]>` for the board UI.

- [ ] **Step 1: Write the failing tests**

```ts
it("records a cheque payment that settles an order while it is live", () => {
  const o1 = deliveredOrder(40_000);
  const { cheque_id, payment_id } = recordChequePayment(1, {
    customer_id: custId, amount_toman: 40_000, cheque_no: "123", due_date: "2026-03-01",
    received_at: "2026-02-01", received_by: userId,
  });
  expect((getDb().prepare("SELECT status FROM cheques WHERE id=?").get(cheque_id) as any).status).toBe("in_hand");
  expect((getDb().prepare("SELECT payment_status FROM orders WHERE id=?").get(o1) as any).payment_status).toBe("paid");
});

it("a bounce re-opens exactly the orders the cheque had settled and raises a reminder", () => {
  const o1 = deliveredOrder(40_000);
  const { cheque_id } = recordChequePayment(1, { customer_id: custId, amount_toman: 40_000, cheque_no: "124", due_date: "2026-03-01", received_at: "2026-02-01", received_by: userId });
  advanceCheque(1, cheque_id, "deposited", userId);
  advanceCheque(1, cheque_id, "bounced", userId);
  const db = getDb();
  expect((db.prepare("SELECT paid_toman,payment_status FROM orders WHERE id=?").get(o1) as any)).toMatchObject({ paid_toman: 0, payment_status: "unpaid" });
  expect((db.prepare("SELECT voided_at FROM payments WHERE cheque_id=?").get(cheque_id) as any).voided_at).not.toBeNull();
  expect(db.prepare("SELECT COUNT(*) n FROM reminders WHERE note LIKE '%124%'").get()).toMatchObject({ n: 1 });
});

it("rejects an illegal transition", () => {
  const { cheque_id } = recordChequePayment(1, { customer_id: custId, amount_toman: 1000, cheque_no: "125", due_date: "2026-03-01", received_at: "2026-02-01", received_by: userId });
  expect(() => advanceCheque(1, cheque_id, "cleared", userId)).toThrow(ChequeError);
});

it("keeps two orgs' identical cheque_no apart", () => {
  // org 2 setup, same cheque_no "123" for its own customer -> no throw
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cheques-repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/repo/cheques.ts`**

The bounce path must be one transaction (void + recompute + reminder). Reuse `voidPayment` but call an internal txn-aware variant so it participates in the bounce transaction, mirroring the `recordPaymentTxn` split from Task 6.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cheques-repo.test.ts` + full suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/repo/cheques.ts lib/repo/payments.ts tests/cheques-repo.test.ts
git commit -m "Add lib/repo/cheques: record, advance, bounce reversal with reminder

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 10: `orders.credit_hold` + wire `credit_approvals` into `createOrder` / `addStop`

**Files:**
- Modify: `lib/db.ts` (`orders` — add `credit_hold INTEGER NOT NULL DEFAULT 0` via a `PRAGMA table_info`-guarded `ALTER TABLE orders ADD COLUMN` — no CHECK, so no rebuild needed)
- Modify: `lib/orders.ts` (`createOrder` — post-insert credit check), `lib/delivery.ts` (`addStop` — refuse a held order)
- Modify: `lib/repo/creditApprovals.ts` (`decide` — clearing `credit_hold` on approve)
- Test: `tests/order-credit-hold.test.ts` (create)

**Interfaces:**
- Consumes: `customerDebt` (Task 3), `requestApproval` / `decide` (`lib/repo/creditApprovals.ts`).
- Produces: `orders.credit_hold` column; `createOrder` sets it to 1 (and creates an approval row) when a **direct** customer's `customerDebt(...).total + orderTotal > credit_limit_toman` (limit non-null); `hard_credit_block = 1` → `createOrder` throws `OrderError("این مشتری مسدود اعتباری است")` with no approval row; `addStop` throws `DeliveryError("سفارش در انتظار تأیید اعتبار است")` when `credit_hold = 1`; `decide(..., 'approved')` sets `credit_hold = 0` on the approval's order.

- [ ] **Step 1: Write the failing tests**

```ts
it("holds a direct order that breaches the credit limit and files an approval", () => {
  // customer with credit_limit_toman = 50_000, one delivered unpaid order 40_000
  // create a new order worth 20_000 -> total would be 60_000 > 50_000
  const { id } = createOrder(db, { customer_id: custId, order_date: "2026-02-01", created_by: userId, organization_id: 1, lines: [oneLine(20_000)] });
  expect((db.prepare("SELECT credit_hold FROM orders WHERE id=?").get(id) as any).credit_hold).toBe(1);
  expect(db.prepare("SELECT COUNT(*) n FROM credit_approvals WHERE order_id=?").get(id)).toMatchObject({ n: 1 });
  expect(() => addStop(db, runId, id)).toThrow(/اعتبار/);
});

it("does not hold a representative's order", () => {
  // custId has a representative_profiles row -> even over limit, credit_hold stays 0, no approval
});

it("refuses a hard-blocked customer at creation", () => {
  // hard_credit_block = 1
  expect(() => createOrder(db, { ... })).toThrow(/مسدود/);
});

it("decide('approved') releases the hold", () => {
  // ...create held order, get approvalId...
  decide(1, approvalId, "approved", managerId);
  expect((db.prepare("SELECT credit_hold FROM orders WHERE id=?").get(orderId) as any).credit_hold).toBe(0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/order-credit-hold.test.ts`
Expected: FAIL — `no such column: credit_hold`.

- [ ] **Step 3: Implement**

- `lib/db.ts`: `if (!orderCols.some(c => c.name === "credit_hold")) db.exec("ALTER TABLE orders ADD COLUMN credit_hold INTEGER NOT NULL DEFAULT 0");`
- `lib/orders.ts` `createOrder`: after the lines loop, before `COMMIT`, compute `orderTotal` from the just-inserted lines (`orderTotalToman(linesOf(db, orderId))`), read the customer's `hard_credit_block`, `credit_limit_toman`, and whether a `representative_profiles` row exists. If `hard_credit_block` → throw `OrderError` (transaction rolls back). If direct + limit set + `customerDebt(organization_id, customer_id).total + orderTotal > credit_limit_toman` → `db.prepare("UPDATE orders SET credit_hold = 1 WHERE id = ?").run(orderId)` and `requestApproval(...)` — but `requestApproval` opens no transaction of its own (it is a plain INSERT), so it is safe to call inside; pass `customer_balance_toman: customerDebt(...).total`, `credit_limit_toman`. Guard: `requestApproval` throws `CreditApprovalError` for a rep customer — we already excluded reps, so it will not fire, but wrap defensively.
- `lib/delivery.ts` `addStop`: extend the order SELECT to include `credit_hold`; `if (order.credit_hold) throw new DeliveryError("سفارش در انتظار تأیید اعتبار است")`.
- `lib/repo/creditApprovals.ts` `decide`: on `verdict === "approved"`, `creditApprovalsRepo.db().prepare("UPDATE orders SET credit_hold = 0 WHERE id = ? AND organization_id = ?").run(row.order_id, organizationId)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/order-credit-hold.test.ts` + full suite (order tests, delivery tests, credit-approval tests).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts lib/orders.ts lib/delivery.ts lib/repo/creditApprovals.ts tests/order-credit-hold.test.ts
git commit -m "Wire credit_approvals into createOrder/addStop via orders.credit_hold

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 11: API routes — payments, cheques, statement

**Files:**
- Create: `app/api/payments/route.ts`, `app/api/payments/[id]/route.ts`, `app/api/payments/[id]/receipt/route.ts`
- Create: `app/api/cheques/route.ts`, `app/api/cheques/[id]/route.ts`
- Create: `app/api/customers/[id]/statement/route.ts`
- Modify: `tests/fixtures/raw-sql-allowlist.txt` only if unavoidable (it should be — routes call repo functions, no raw SQL)
- Test: `tests/api/payments-route.test.ts`, `tests/api/cheques-route.test.ts`, `tests/api/customer-statement-route.test.ts` (create; model on `tests/api/credit-approvals-route.test.ts`)

**Interfaces:**
- Consumes: everything from `lib/repo/payments.ts`, `lib/repo/cheques.ts`; `requireRole` from `lib/session.ts`; the `photos` storage path (find how `/api/photos` or the customer photo upload writes a file — `grep -rn "file_stem\|writeFile\|photos" app/api`).
- Produces: the routes in spec §API surface. Roles: payments GET/POST → `["owner","group_manager","salesperson"]`; a `driver` may POST only against a stop on their own run (check `readDriverRuns` / the run's `driver_user_id`); payments void → `["owner","group_manager"]`; cheques → `["owner","group_manager"]`; statement GET → `["owner","group_manager","salesperson"]` (salesperson scoped to own customers via `groupFilter`). Cross-tenant id → 404. Illegal cheque transition / void-after-void → 409. Missing fields → 400.

- [ ] **Step 1: Write the failing tests**

One representative test per route file. For `payments-route.test.ts`:

```ts
it("records a payment and auto-allocates", async () => {
  const res = await POST(jreq("/api/payments", { method: "POST", body: JSON.stringify({ customer_id: custId, amount_toman: 30_000, method: "CASH", received_at: "2026-02-01" }) }));
  expect(res.status).toBe(201);
});
it("404s a payment in another org", async () => {
  const res = await GET_ONE(jreq(`/api/payments/${otherOrgPaymentId}`), ctx(otherOrgPaymentId));
  expect(res.status).toBe(404);
});
it("409s a second void", async () => { /* void twice */ });
it("refuses a salesperson voiding", async () => { /* role 403 */ });
```

For `cheques-route.test.ts`: record, `PATCH {action:'advance', to:'deposited'}`, illegal advance → 409, cross-tenant → 404.
For `customer-statement-route.test.ts`: returns `{ orders, payments, balance, debt }`, salesperson sees only their own customer (cross-group → 404).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/api/payments-route.test.ts tests/api/cheques-route.test.ts tests/api/customer-statement-route.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Implement the routes**

Mirror `app/api/admin/credit-approvals/route.ts` exactly for structure (`requireRole` guard → parse body → try/catch mapping `PaymentError`/`ChequeError` to 409, bad input to 400). The receipt route is multipart — find the existing photo-upload route and reuse its file-writing helper; store `receipt_photo_stem` on the payment via `paymentsRepo.patch`. The statement route composes `readOrders` (scoped), `paymentsRepo.list`, and `customerDebt`.

After creating routes: `npx next typegen && rm -rf .next/dev/types`.

- [ ] **Step 4: Run to verify they pass**

Run: the three route tests + `npx tsc --noEmit` + full suite.
Expected: PASS. `npx vitest run tests/repo-boundary.test.ts` still green (no new raw SQL in `app/`).

- [ ] **Step 5: Commit**

```bash
git add app/api/payments app/api/cheques app/api/customers tests/api/payments-route.test.ts tests/api/cheques-route.test.ts tests/api/customer-statement-route.test.ts
git commit -m "Add payments, cheques and customer-statement API routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 12: UI — `/sales/payments`, `/sales/cheques`, nav, panel button

**Files:**
- Create: `app/sales/payments/page.tsx`, `app/sales/cheques/page.tsx`
- Modify: `app/sales/layout.tsx` (two new tabs), `proxy.ts` (allow the two new paths for the right roles)
- Modify: `components/CustomerDetailPanel.tsx` ("دریافت وجه" button → opens the payment form pre-filled; debt pill uses the computed `debt` from Task 11's statement or a lightweight fetch)
- Test: `tests/api/*` already cover behaviour; add `tests/proxy-payments.test.ts` if `proxy.ts` has a test sibling (`ls tests/*proxy*`)

**Interfaces:**
- Consumes: the Task 11 routes.
- Produces: `/sales/payments` (form: customer picker, amount, method `<select>`, date, reference, receipt upload shown only for `POS`/`CARD_TO_CARD`, editable FIFO allocation table; list below with void). `/sales/cheques` (board grouped by `chequesByStatus`, cards with Jalali `due_date`, legal next-status buttons from `CHEQUE_TRANSITIONS`, overdue flag). Both hidden from `driver`. Nav tabs `ready:` guarded like the existing ones (`session.role !== "driver"` for payments; `owner`/`group_manager` for cheques).

- [ ] **Step 1: Write the failing test**

If `proxy.ts` has a test: assert a `salesperson` GET to `/sales/payments` passes and a `driver` gets redirected; a `salesperson` to `/sales/cheques` is refused. Otherwise skip to Step 3 (pages are exercised manually — the user reviews the whole app live after Phase 10) and rely on `tsc` + the route tests.

- [ ] **Step 2: Run it (if written)**

Run: `npx vitest run tests/proxy-payments.test.ts`
Expected: FAIL.

- [ ] **Step 3: Build the pages + wire nav/proxy**

Read `node_modules/next/dist/docs/` for the current app-router page/server-action conventions before writing. Model the client interactivity on `app/sales/admin/representatives/page.tsx` (created in Phase 0b). Keep raw SQL out — pages call the API routes or server helpers.

`npx next typegen && rm -rf .next/dev/types` after adding the pages.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx eslint app/ lib/ components/` (lint the new files individually if the dir lint OOMs) + full suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/sales/payments app/sales/cheques app/sales/layout.tsx proxy.ts components/CustomerDetailPanel.tsx tests/proxy-payments.test.ts
git commit -m "Add payments and cheques screens, nav tabs, panel receive-payment button

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 13: Tenancy wiring — `TENANT_TABLES`, exempt list, two-org isolation

**Files:**
- Modify: `lib/db.ts` (`TENANT_TABLES` += `"cheques"` — `"payments"` was added in Task 1)
- Modify: `tests/tenancy-schema.test.ts` (`"payment_allocations"` was added to the exempt set in Task 1; nothing more needed here unless a new exempt table appears)
- Modify: `tests/helpers/twoOrgs.ts` (`OrgFixture` += `paymentId`, `chequeId`; seed a `payments` row + a `cheques` row per org with a colliding `cheque_no`)
- Modify: `tests/tenancy-isolation.test.ts` (assert payments + cheques stay per-org; colliding `cheque_no` across orgs is allowed)
- Test: the above two test files are the test.

**Interfaces:**
- Consumes: `seedTwoOrgs`.
- Produces: `payments` and `cheques` in `TENANT_TABLES` (so `tests/tenancy-schema.test.ts`'s "every business table has organization_id" check covers them and `orgFilter` scopes them); `payment_allocations` on the exempt list (it reaches a tenant through `payments`); `twoOrgs` seeds and isolation asserts both.

- [ ] **Step 1: Write the failing assertions**

In `tests/tenancy-isolation.test.ts`, extend the "keeps … apart" test:

```ts
it("keeps payments and cheques apart, and allows a shared cheque_no", () => {
  const db = getDb();
  for (const [self, other] of [[a, b], [b, a]] as const) {
    const pays = db.prepare("SELECT id FROM payments WHERE organization_id = ?").all(self.orgId) as { id: number }[];
    expect(pays.map((r) => r.id)).toContain(self.paymentId);
    expect(pays.map((r) => r.id)).not.toContain(other.paymentId);
  }
  const chq = db.prepare("SELECT cheque_no, COUNT(*) n FROM cheques GROUP BY cheque_no").all() as { cheque_no: string; n: number }[];
  expect(chq.find((c) => c.cheque_no === "SHARED-CHQ")?.n).toBe(2);
});
```

Add `payments`/`cheques` to the `TENANT_TABLES` iteration expectations implicitly (the existing "every tenant table" loop picks them up once they are in the array).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/tenancy-isolation.test.ts tests/tenancy-schema.test.ts`
Expected: FAIL — `self.paymentId` undefined / `payment_allocations` "neither tenant-scoped nor exempt".

- [ ] **Step 3: Implement**

- `lib/db.ts`: add `"payments"`, `"cheques"` to `TENANT_TABLES`.
- `tests/tenancy-schema.test.ts`: add `"payment_allocations"` to the `exempt` set with a one-line comment (`reaches a tenant through payments`).
- `tests/helpers/twoOrgs.ts`: in `build`, after the credit-approval insert, add:
  ```ts
  const paymentId = insert(
    `INSERT INTO payments (organization_id, customer_id, amount_toman, method, received_at, received_by, created_at)
     VALUES (?, ?, 10000, 'CASH', ?, ?, ?)`,
    orgId, customerId, NOW, ownerId, NOW
  );
  const chequeId = insert(
    `INSERT INTO cheques (organization_id, customer_id, amount_toman, cheque_no, due_date, status, received_at, received_by, created_at, updated_at)
     VALUES (?, ?, 20000, 'SHARED-CHQ', ?, 'in_hand', ?, ?, ?, ?)`,
    orgId, customerId, NOW, NOW, ownerId, NOW, NOW
  );
  ```
  and add `paymentId`, `chequeId` to the returned fixture + the `OrgFixture` interface.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/tenancy-isolation.test.ts tests/tenancy-schema.test.ts` + full suite.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/db.ts tests/tenancy-schema.test.ts tests/helpers/twoOrgs.ts tests/tenancy-isolation.test.ts
git commit -m "Bring payments and cheques under the two-org isolation suite

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

---

### Task 14: Phase-1 wrap — docs + handoff

**Files:**
- Modify: `docs/crm-erp-plan.md` (mark Phase 1 done in Part 5)
- Modify: `docs/HANDOFF-2026-09-02-tenancy.md` (or create `docs/HANDOFF-2026-09-02-phase-1-money.md`) — what shipped, the deferred merge/deploy note, the pre-deploy checklist (backup, `ROUTEFLOW_MIGRATION_CHECK_DB` run of the migration + backfill tests)

- [ ] **Step 1: Update the plan doc** — Part 5, Phase 1 line → done, with the commit range.
- [ ] **Step 2: Write the handoff** — mirror the Phase 0b handoff structure.
- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "Phase 1 (Money) complete: handoff and plan status

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-1-money
```

- [ ] **Step 4:** Do **not** run `superpowers:finishing-a-development-branch` — the branch stack merges after Phase 10 by standing user decision. Leave `phase-1-money` pushed and unmerged. Report completion.

---

## Self-Review

**Spec coverage:**
- `payments` + allocations → Tasks 1, 2. Cheques + state machine → Tasks 8, 9. Derived `orders.paid_toman` → Tasks 2 (`recomputeOrderPayment`), 6 (`recordDelivery`), 7 (backfill). Derived customer debt + drop `debt_*` → Tasks 3, 4, 5. `credit_approvals` wiring → Task 10. API surface → Task 11. UI → Task 12. Tenancy (`TENANT_TABLES`, exempt, `twoOrgs`) → Task 13. `photos.entity_type` widening → Task 1. Receipt image → Tasks 1, 11, 12.
- Every spec §Testing bullet maps to a task's Step 1.

**Placeholder scan:** the `<…>` markers in Tasks 4 and 7 (column lists, `lineTotalToman` SQL) are deliberate "copy the real thing from the source file" instructions, not TODOs — each names the exact file and symbol to copy from. Acceptable because inlining a guessed 25-column list would be worse than an instruction to read it.

**Type consistency:** `PaymentRow`, `AllocationInput`, `PaymentMethod`, `CustomerDebt`, `ChequeRow`, `ChequeStatus`, `CHEQUE_TRANSITIONS`, `recordPayment` / `recordPaymentTxn` / `voidPayment` / `recomputeOrderPayment` / `customerDebt` / `customerDebtsForOrg` / `recordChequePayment` / `advanceCheque` used consistently Tasks 2 → 14. `recordPaymentTxn` is introduced in Task 6 as the txn-aware core and reused in Task 9 — flagged in both.

**Ordering risk:** Task 3 (`customerDebt`) precedes Task 4 (migration) and carries an explicit `PRAGMA` fallback for the not-yet-existing `opening_balance_toman`, removed in Task 4. Task 8 adds `cheques` before Task 9 needs it. `payments.cheque_id` is a bare column until Task 8 and the FK is never added (enforced in the repo) — noted in Tasks 1, 8.
