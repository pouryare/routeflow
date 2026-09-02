# RouteFlow Phase 2 — Stock & Batches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Track physical lots. A received batch has a code, an expiry date and a status; every stock change is a signed `stock_movements` row; on-hand is `SUM(base_qty)` per product/batch/facility; deliveries draw FEFO from the earliest-expiry batch; a batch traces forward to the customers who hold it and a complaint traces back to the supplier lot.

**Architecture:** `stock_movements` is an append-only ledger — on-hand is derived from it, never stored, same philosophy as the existing `purchases − delivered` model it replaces. `batches` carry expiry + a small status machine (`lib/batchStates.ts`). `recordPurchase` and `recordDelivery` write ledger rows inside their existing transactions. A one-shot guarded backfill converts every legacy purchase line into a batch + `PURCHASE_IN` and every delivered order line into `DELIVERY_OUT` rows, so per-product on-hand is unchanged at migration.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before touching routes), TypeScript, `node:sqlite`, vitest. Quantities are `REAL` base units (عدد); money is whole-Toman `INTEGER`.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-2-stock-batches-design.md`

## Global Constraints

- **Branch `phase-2-stock`.** Never `main`. Never `npm run build` / `systemctl restart`. Deploys with the whole stack after Phase 10.
- Quantities `REAL` in `products.base_unit`; money `INTEGER` whole Toman. On-hand may be negative (books lag reality — flag, don't block).
- Migrations idempotent, `PRAGMA table_info` / constraint-guarded, table-rebuild where a CHECK changes.
- New DB access through `lib/repo/`. `tests/repo-boundary.test.ts` blocks new raw-SQL files outside `lib/repo/`; `lib/purchases.ts` and `lib/delivery.ts` are grandfathered. Put new logic in `lib/repo/stock.ts` / `batches.ts` / `complaints.ts`.
- Cross-tenant row → 404. Persian user-facing text, English identifiers.
- Before every commit: `npx tsc --noEmit`, `npx eslint app/ lib/`, `npx vitest run` all green (run vitest in the background and poll `until grep -qE "Test Files" out`). After route add/remove: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Four tables, `products.shelf_life_days`, `lib/batchStates.ts`

**Files:**
- Modify: `lib/db.ts` (schema block near `payments`; `TENANT_TABLES`; `ALTER products`)
- Modify: `tests/tenancy-schema.test.ts` (no exempt change — all four are tenant tables)
- Create: `lib/batchStates.ts`
- Test: `tests/stock-schema.test.ts`, `tests/batch-states.test.ts`

**Interfaces produced:**
- Tables `batches`, `stock_movements`, `delivery_line_batches`, `quality_complaints` (columns per spec §Data model).
- `products.shelf_life_days INTEGER` (nullable).
- `export type BatchStatus = "active" | "quarantined" | "recalled" | "expired" | "depleted"`
- `export const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]>` exactly:
  `active: ["quarantined","recalled","expired","depleted"]`, `quarantined: ["active","recalled","depleted"]`, `recalled: ["depleted"]`, `expired: ["depleted"]`, `depleted: ["active"]`
- `export function canTransitionBatch(from: BatchStatus, to: BatchStatus): boolean`
- `export const BATCH_STATUS_LABEL: Record<BatchStatus,string>` (Persian: active→«فعال», quarantined→«قرنطینه», recalled→«فراخوان», expired→«منقضی», depleted→«تمام‌شده»)
- `TENANT_TABLES` gains the four table names.

- [ ] **Step 1: failing tests**

`tests/batch-states.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { BATCH_TRANSITIONS, canTransitionBatch } from "@/lib/batchStates";
it("active can be quarantined but not jump straight to depleted-then-active loops illegally", () => {
  expect(canTransitionBatch("active", "quarantined")).toBe(true);
  expect(canTransitionBatch("recalled", "active")).toBe(false);
  expect(canTransitionBatch("recalled", "depleted")).toBe(true);
});
it("depleted can revive to active (a correcting RETURN_IN)", () => {
  expect(canTransitionBatch("depleted", "active")).toBe(true);
});
```

`tests/stock-schema.test.ts` (temp DB, `getDb()`):
```ts
it("creates the four tables and adds products.shelf_life_days", () => {
  const db = getDb();
  for (const t of ["batches", "stock_movements", "delivery_line_batches", "quality_complaints"]) {
    expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
  }
  const cols = (db.prepare("PRAGMA table_info(products)").all() as { name: string }[]).map((c) => c.name);
  expect(cols).toContain("shelf_life_days");
});
it("batches are unique per (organization_id, product_id, batch_code)", () => {
  const sql = (getDb().prepare("SELECT sql FROM sqlite_master WHERE name='batches'").get() as { sql: string }).sql;
  expect(sql).toContain("UNIQUE (organization_id, product_id, batch_code)");
});
it("stock_movements.kind rejects an unknown kind", () => {
  expect(() => getDb().prepare(
    "INSERT INTO stock_movements (organization_id,facility_id,product_id,base_qty,kind,occurred_at,created_at) VALUES (1,1,1,1,'MAGIC','x','x')"
  ).run()).toThrow();
});
it("batches / stock_movements / delivery_line_batches / quality_complaints are tenant tables", () => {
  const { TENANT_TABLES } = require("@/lib/db"); // or import at top
  for (const t of ["batches","stock_movements","delivery_line_batches","quality_complaints"])
    expect((TENANT_TABLES as readonly string[]).includes(t)).toBe(true);
});
```

- [ ] **Step 2: run — expect FAIL** (`no such table`, module missing)
- [ ] **Step 3: implement**

`lib/batchStates.ts` per the interface. In `lib/db.ts` add the four `CREATE TABLE IF NOT EXISTS` (verbatim from spec §Data model) to the main schema `db.exec(\`…\`)` string, right after `payment_allocations`. Add `ALTER TABLE products ADD COLUMN shelf_life_days INTEGER` guarded on `PRAGMA table_info(products)`. Add the four names to `TENANT_TABLES`.

- [ ] **Step 4: run — expect PASS**, then full suite (the `tenancy-schema` "names every table" test now covers the four automatically; `tenancy-isolation`'s per-table loops run against them with no rows → trivially pass).
- [ ] **Step 5: commit**
```bash
git add lib/db.ts lib/batchStates.ts tests/stock-schema.test.ts tests/batch-states.test.ts tests/tenancy-schema.test.ts
git commit -m "Add batches, stock_movements, delivery_line_batches, quality_complaints + batchStates

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git push -q origin phase-2-stock
```

---

### Task 2: `lib/repo/stock.ts` — the ledger

**Files:** Create `lib/repo/stock.ts`; Test `tests/stock-repo.test.ts`

**Interfaces consumed:** `makeRepo`; `facilities` / `products` tables.
**Interfaces produced:**
- `export type MovementKind` (the 9 CHECK values)
- `export class StockError extends Error {}`
- `export interface MovementInput { facility_id: number; product_id: number; batch_id: number | null; base_qty: number; kind: MovementKind; ref_type?: string | null; ref_id?: number | null; occurred_at: string; created_by?: number | null; notes?: string | null }`
- `export function recordMovement(organizationId: number, input: MovementInput): number` — opens `BEGIN IMMEDIATE`, delegates to `recordMovementsTxn`, commits.
- `export function recordMovementsTxn(db: DatabaseSync, organizationId: number, inputs: MovementInput[]): number[]` — one INSERT each; validates `facility_id` resolves to a facility and `product_id` to a product whose `organization_id` is the arg or NULL (hand-seeded test rows), else `StockError`.
- `export function onHand(organizationId: number, filter: { product_id?: number; batch_id?: number | null; facility_id?: number }): number` — `SELECT COALESCE(SUM(base_qty),0)` with the given equality filters + `organization_id = ?`. `batch_id: null` filters `batch_id IS NULL`.
- `export interface BatchStockRow { batch_id: number; batch_code: string; expiry_date: string | null; status: string; on_hand: number }`
- `export function batchStock(organizationId: number, productId: number, facilityId?: number): BatchStockRow[]` — one row per batch of the product, `on_hand` from movements, ordered `expiry_date IS NULL, expiry_date, id` (FEFO, undated last).
- `export function allocateFEFO(organizationId: number, productId: number, baseQty: number, facilityId: number): Array<{ batch_id: number | null; base_qty: number }>` — walk `batchStock` where `status = 'active' AND on_hand > 0`, take `min(remaining, on_hand)` from each; leftover → one `{ batch_id: null, base_qty: leftover }`. `baseQty <= 0` → `[]`.
- `export function defaultFacilityId(organizationId: number): number` — `SELECT id FROM facilities WHERE kind='warehouse' … UNION … 'home_base' … ORDER BY …` — actually: query `SELECT id, kind FROM facilities WHERE organization_id = ? OR organization_id IS NULL`, prefer `warehouse`, then `home_base`, then min id; `StockError` if none.
- `export interface StockLevel { product_id: number; on_hand: number; earliest_expiry: string | null }`
- `export function stockLevels(organizationId: number): StockLevel[]` — group movements by `product_id`; `earliest_expiry` = min `batches.expiry_date` among batches of that product with `on_hand > 0`.

- [ ] **Step 1: failing tests** — cover: `onHand` sums signed rows incl. negative; `allocateFEFO` picks earliest expiry first, skips `quarantined`, puts shortfall on `batch_id:null`; `defaultFacilityId` prefers `warehouse`.
```ts
// seed: 1 org, 1 facility (kind 'warehouse'), 1 product, 2 batches:
//   B1 expiry 2026-03-01 PURCHASE_IN +10 ; B2 expiry 2026-02-01 PURCHASE_IN +5
it("allocateFEFO draws the earliest-expiry batch first", () => {
  expect(allocateFEFO(1, prod, 7, fac)).toEqual([
    { batch_id: b2, base_qty: 5 },
    { batch_id: b1, base_qty: 2 },
  ]);
});
it("puts an oversell shortfall on batch_id null", () => {
  expect(allocateFEFO(1, prod, 20, fac)).toEqual([
    { batch_id: b2, base_qty: 5 },
    { batch_id: b1, base_qty: 10 },
    { batch_id: null, base_qty: 5 },
  ]);
});
it("skips a quarantined batch", () => {
  getDb().prepare("UPDATE batches SET status='quarantined' WHERE id=?").run(b2);
  expect(allocateFEFO(1, prod, 3, fac)).toEqual([{ batch_id: b1, base_qty: 3 }]);
});
it("onHand nets signed movements", () => {
  recordMovement(1, { facility_id: fac, product_id: prod, batch_id: b1, base_qty: -4, kind: "DELIVERY_OUT", occurred_at: "x" });
  expect(onHand(1, { product_id: prod })).toBe(11); // 10 + 5 - 4
});
```
- [ ] **Step 2: run — FAIL** (module missing)
- [ ] **Step 3: implement `lib/repo/stock.ts`**
- [ ] **Step 4: run — PASS** + full suite
- [ ] **Step 5: commit** (`Add lib/repo/stock: signed movement ledger, onHand, FEFO allocation`)

---

### Task 3: `lib/repo/batches.ts`

**Files:** Create `lib/repo/batches.ts`; Test `tests/batches-repo.test.ts`

**Interfaces consumed:** `lib/repo/stock.ts` (`onHand`, `batchStock`), `lib/batchStates.ts`, `reminders` table.
**Interfaces produced:**
- `export interface BatchRow { id; organization_id; product_id; batch_code; supplier_batch_ref: string|null; purchase_line_id: number|null; produced_at: string|null; expiry_date: string|null; qty_received_base: number; unit_cost_toman: number; status: BatchStatus; notes: string|null; created_at; updated_at }`
- `export const batchesRepo = makeRepo<BatchRow>("batches", { tenant: true })`
- `export class BatchError extends Error {}`
- `export function createBatchTxn(db: DatabaseSync, organizationId: number, input: { product_id; batch_code?; supplier_batch_ref?; purchase_line_id?; produced_at?; expiry_date?; qty_received_base; unit_cost_toman?; notes? }): number` — auto `batch_code` = `<YYMMDD of produced_at|today>-<n>` where `n` is `1 + count of batches for (org, product) with that date prefix`; default `expiry_date` = `date(produced_at, '+<shelf_life_days> days')` when `produced_at` and `products.shelf_life_days` are both set; `UNIQUE` violation → `BatchError`.
- `export function createBatch(organizationId, input): number` — wraps in a transaction.
- `export function advanceBatchStatus(organizationId: number, id: number, to: BatchStatus, actor: number): void` — 404 if not found; `to` in `{expired,depleted}` → `BatchError("این وضعیت خودکار محاسبه می‌شود")`; `!canTransitionBatch` → `BatchError` (409 at route). On `to === 'recalled'`: for each distinct customer that received the batch (`delivery_line_batches` → `delivery_stops` → `orders`), insert a `reminders` row (`entity_type='customer'`, due today, message «بچ {batch_code} فراخوان شد — پیگیری کنید»). One transaction.
- `export function sweepBatchStatuses(organizationId?: number): { expired: number; depleted: number }` — `UPDATE batches SET status='expired', updated_at=? WHERE status IN ('active','quarantined') AND expiry_date IS NOT NULL AND expiry_date < date('now')`; then set `depleted` where `status IN ('active','quarantined','expired')` and computed on-hand ≤ 0 (subquery `SELECT COALESCE(SUM(base_qty),0) FROM stock_movements WHERE batch_id = batches.id`). Idempotent. Scope to `organizationId` when given.
- `export interface ExpiringBatch extends BatchRow { on_hand: number; days_to_expiry: number | null }`
- `export function expiringBatches(organizationId: number, opts?: { withinDays?: number; asOf?: string }): ExpiringBatch[]` — `status IN ('active','quarantined')`, on-hand > 0, and (`expiry_date < asOf` OR `expiry_date <= asOf + withinDays`). Default `withinDays` per batch = `max(7, floor(shelf_life_days * 0.25))`, falling back to a flat 14 when `shelf_life_days` is null.
- `export interface BatchTrace { batch: BatchRow; purchase: { purchase_id: number; supplier: string | null; purchase_date: string; unit_cost_toman: number } | null; deliveries: Array<{ delivery_stop_id: number; order_id: number; order_no: string; customer_id: number; customer_name: string; base_qty: number; delivered_at: string | null }>; complaints: number }`
- `export function batchTrace(organizationId: number, batchId: number): BatchTrace | null`

- [ ] **Step 1: failing tests** — auto-code uniqueness; `expiry_date` defaults from shelf life; `sweepBatchStatuses` sets `expired` (past date) and `depleted` (zero on-hand) idempotently; `advanceBatchStatus` rejects `expired` target, 409s an illegal move, and a recall inserts one reminder per customer; `batchTrace` returns the delivering customers.
- [ ] **Step 2: FAIL** — [ ] **Step 3: implement** — [ ] **Step 4: PASS + full suite** — [ ] **Step 5: commit** (`Add lib/repo/batches: create, status machine, expiry sweep, forward trace`)

---

### Task 4: `recordPurchase` writes a batch + `PURCHASE_IN`

**Files:** Modify `lib/purchases.ts`; Test extend `tests/purchases.test.ts` or new `tests/purchase-batches.test.ts`

**Interfaces consumed:** `createBatchTxn`, `recordMovementsTxn`, `defaultFacilityId`.
**Interfaces produced:** `PurchaseLineInput` gains optional `batch_code?`, `supplier_batch_ref?`, `produced_at?`, `expiry_date?`. After each `insertLine`, inside the existing `BEGIN IMMEDIATE`:
```ts
const batchId = createBatchTxn(db, input.organization_id, {
  product_id: line.product_id,
  batch_code: line.batch_code,
  supplier_batch_ref: line.supplier_batch_ref,
  purchase_line_id: <the id insertLine just wrote — capture it>,
  produced_at: line.produced_at ?? input.purchase_date,
  expiry_date: line.expiry_date,
  qty_received_base: line.base_qty,
  unit_cost_toman: line.unit_cost_toman,
});
recordMovementsTxn(db, input.organization_id, [{
  facility_id: defaultFacilityId(input.organization_id),
  product_id: line.product_id, batch_id: batchId, base_qty: line.base_qty,
  kind: "PURCHASE_IN", ref_type: "purchase_line", ref_id: <purchase_line_id>,
  occurred_at: input.purchase_date, created_by: input.created_by,
}]);
```
`insertLine` currently does not return the id — change it to `const plId = Number(insertLine.run(...).lastInsertRowid)`.

- [ ] **Step 1: failing test** — a receipt of 2 lines creates 2 batches and 2 `PURCHASE_IN` movements; `onHand(org,{product_id})` equals `base_qty`; `stockPosition` on-hand is unchanged for the same receipt (compare to a hand-computed `purchased − delivered`).
- [ ] **Step 2: FAIL** — [ ] **Step 3: implement** — [ ] **Step 4: PASS + full suite** (existing `purchases.test.ts` must stay green — moving-average assertions unaffected) — [ ] **Step 5: commit**

---

### Task 5: `recordDelivery` writes FEFO `DELIVERY_OUT` + `delivery_line_batches`

**Files:** Modify `lib/delivery.ts`; Test `tests/delivery-batches.test.ts`

**Interfaces consumed:** `allocateFEFO`, `recordMovementsTxn`, `defaultFacilityId`.
**Behaviour:** inside `recordDelivery`'s existing transaction, after `packs_delivered` is written (and alongside the Phase 1 CASH payment block), first clear any prior machine rows for this stop:
```ts
db.prepare("DELETE FROM stock_movements WHERE ref_type='delivery_stop' AND ref_id=? AND kind='DELIVERY_OUT'").run(stopId);
db.prepare("DELETE FROM delivery_line_batches WHERE delivery_stop_id=?").run(stopId);
```
then for each `input.lines` entry with `packs_delivered > 0`, look up its `order_lines` row for `product_id` and `qty_per_pack`, compute `baseQty = packs_delivered * qty_per_pack`, and:
```ts
for (const a of allocateFEFO(orgId, product_id, baseQty, facilityId)) {
  recordMovementsTxn(db, orgId, [{ facility_id: facilityId, product_id, batch_id: a.batch_id,
    base_qty: -a.base_qty, kind: "DELIVERY_OUT", ref_type: "delivery_stop", ref_id: stopId,
    occurred_at: now, created_by: input.by }]);
  db.prepare(`INSERT INTO delivery_line_batches (organization_id, delivery_stop_id, order_line_id, batch_id, base_qty, created_at) VALUES (?,?,?,?,?,?)`)
    .run(orgId, stopId, line.line_id, a.batch_id, a.base_qty, now);
}
```
`recordMovementsTxn` is fine inside the txn (no nested BEGIN). Use `stop.organization_id` (already selected in the Phase 1 change).

- [ ] **Step 1: failing test** — a delivery of a line with two batches available draws FEFO, writes `DELIVERY_OUT` (negative) + `delivery_line_batches`; `onHand` drops by the delivered base qty; a **retried** `recordDelivery` for the same stop leaves exactly one set of rows (no doubling); `stockPosition` on-hand matches the legacy `purchased − delivered` for the same data.
- [ ] **Step 2: FAIL** — [ ] **Step 3: implement** — [ ] **Step 4: PASS** + run `tests/delivery.test.ts`, `tests/commissionLedger.test.ts`, `tests/dashboard.test.ts`, `tests/purchases.test.ts` + full suite — [ ] **Step 5: commit**

---

### Task 6: Backfill + `stockPosition` derives from movements

**Files:** Modify `lib/db.ts` (guarded `backfillStockLedger`); Modify `lib/purchases.ts` (`stockPosition`, `advancedStockPosition`); Test `tests/stock-ledger-backfill.test.ts`

**Interfaces produced:**
- `export function backfillStockLedger(db: DatabaseSync): void` — guarded on `app_meta` `stock_ledger_backfill_done`. One transaction: per `purchase_line` → `createBatchTxn` (`batch_code='LEGACY-PL<id>'`, `produced_at`=its purchase's date, `expiry_date` NULL, `qty`/`cost` from the line) + `PURCHASE_IN` at the purchase date; per delivered `order_line` with `packs_delivered > 0` → `allocateFEFO(orgId, product_id, packs_delivered*qty_per_pack, defaultFacilityId(orgId))` writing `DELIVERY_OUT` + `delivery_line_batches` at `orders.delivered_at`, `ref_id` = the `delivery_stops.id` for that order if one exists else NULL. Org per row from `purchases.organization_id` / `orders.organization_id` (fallback 1). Call it from `getDb()` after the Phase 1 backfill call, then `sweepBatchStatuses()`.
- `stockPosition`: replace the `purchased_qty` / `delivered_qty` subqueries with
  `COALESCE((SELECT SUM(base_qty) FROM stock_movements m WHERE m.product_id = p.id AND m.base_qty > 0),0)` and `-COALESCE((SELECT SUM(base_qty) … m.base_qty < 0),0)`. `on_hand = purchased − delivered` still holds. Keep the `negative` flag and `value_toman`.
- `advancedStockPosition`: add `earliest_expiry: string | null` (min `batches.expiry_date` for that product with on-hand > 0) and `expiring_count: number` per row (from `expiringBatches` grouped).

- [ ] **Step 1: failing test** — seed a couple of legacy purchases + a delivered order **directly** (INSERTs, no `recordPurchase`), call `backfillStockLedger`, assert: one batch per purchase line, `SUM(stock_movements.base_qty)` per product equals the old `stockAfter(purchased, delivered)`, idempotent on a second call, `stockPosition` unchanged.
- [ ] **Step 2: FAIL** — [ ] **Step 3: implement** — [ ] **Step 4: PASS + full suite**; then real-data check:
```bash
ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/stock-ledger-backfill.test.ts tests/tenancy-schema.test.ts
```
- [ ] **Step 5: commit** (`Backfill the stock ledger from legacy purchases and deliveries; derive stockPosition from movements`)

---

### Task 7: `lib/repo/complaints.ts`

**Files:** Create `lib/repo/complaints.ts`; Test `tests/complaints-repo.test.ts`

**Interfaces produced:**
- `export interface ComplaintRow { …schema… }`
- `export const complaintsRepo`
- `export class ComplaintError extends Error {}`
- `export function fileComplaint(organizationId, input: { customer_id?; order_id?; product_id?; batch_id?; reported_by; category; severity?; description? }): number` — when `order_id` + `product_id` set and `batch_id` unset, infer it: `SELECT dlb.batch_id FROM delivery_line_batches dlb JOIN order_lines ol ON ol.id = dlb.order_line_id WHERE ol.order_id = ? AND ol.product_id = ? AND dlb.batch_id IS NOT NULL LIMIT 1`.
- `export function updateComplaint(organizationId, id, patch: { status?: ComplaintRow["status"]; severity?; resolution? }, actor: number): void` — 404 if missing; on `status` → `resolved`/`dismissed` stamp `resolved_at = now`, `resolved_by = actor`.
- `export function listComplaints(organizationId, filter?: { status?; batch_id?; customer_id? }): ComplaintRow[]`
- `export function complaintClusters(organizationId, opts?: { sinceDays?: number; minCount?: number }): Array<{ batch_id: number; batch_code: string; product_id: number; count: number; severities: string[] }>` — default `sinceDays = 30`, `minCount = 2`, `status IN ('open','investigating')`, `batch_id IS NOT NULL`, `reported_at >= date('now', '-30 days')`, `GROUP BY batch_id HAVING COUNT(*) >= minCount`.
- `export function backwardTrace(organizationId, complaintId): { complaint: ComplaintRow; order: { id; order_no } | null; batch: BatchRow | null; purchase_line: { id; unit_cost_toman; purchase_id } | null; supplier_batch_ref: string | null } | null`

- [ ] **Step 1: failing tests** — `fileComplaint` infers `batch_id` from the delivered line; `complaintClusters` fires at 2, not 1; `backwardTrace` walks complaint → order → batch → purchase line → `supplier_batch_ref`; `updateComplaint` stamps `resolved_*`.
- [ ] **Step 2: FAIL** — [ ] **Step 3: implement** — [ ] **Step 4: PASS + full suite** — [ ] **Step 5: commit**

---

### Task 8: API routes — batches, movements, expiry, complaints

**Files:**
- Create: `app/api/sales/batches/route.ts`, `app/api/sales/batches/[id]/route.ts`, `app/api/sales/batches/[id]/trace/route.ts`
- Create: `app/api/sales/stock/movements/route.ts`, `app/api/sales/stock/expiry/route.ts`
- Create: `app/api/sales/complaints/route.ts`, `app/api/sales/complaints/[id]/route.ts`
- Modify: `app/api/sales/stock/route.ts` (add `expiring_count`, per-row `earliest_expiry` — already via `advancedStockPosition`? it uses `stockPosition`; switch to `advancedStockPosition` or add the two fields)
- Test: `tests/api/batches-route.test.ts`, `tests/api/complaints-route.test.ts`, `tests/api/stock-movements-route.test.ts`

**Interfaces consumed:** everything from `lib/repo/stock.ts` / `batches.ts` / `complaints.ts`; `requireRole`.
**Roles:** batches GET/POST + `[id]` PATCH + trace + `stock/movements` GET/POST → `["owner","group_manager"]`. `stock/expiry` GET → `["owner","group_manager","salesperson"]`. `complaints` GET → `["owner","group_manager","salesperson"]`, POST → same; `complaints/[id]` PATCH → `["owner","group_manager"]`. Cross-tenant id → 404. Illegal batch status → 409 (`BatchError`). Bad body → 400. Model structure on `app/api/admin/credit-approvals/route.ts` + the Phase 1 cheques routes.

`POST /api/sales/stock/movements` accepts `{ facility_id?, product_id, batch_id?, base_qty, kind, occurred_at?, notes? }` for `kind IN ('ADJUSTMENT','COUNT','WRITE_OFF','TRANSFER_OUT','TRANSFER_IN','RETURN_IN','SAMPLE_OUT')` only (reject `PURCHASE_IN`/`DELIVERY_OUT` — those are written by their own flows) → `recordMovement`.

After creating routes: `npx next typegen && rm -rf .next/dev/types`.

- [ ] **Step 1: failing tests** (one representative case per file: create, cross-tenant 404, illegal-status 409, role 403, cluster surfaced).
- [ ] **Step 2: FAIL** — [ ] **Step 3: implement** — [ ] **Step 4: PASS**; `npx tsc --noEmit`; `npx vitest run tests/repo-boundary.test.ts` green (no raw SQL in `app/` — statement route pattern: put any lookup in a repo helper) — [ ] **Step 5: commit**

---

### Task 9: UI — `/sales/batches`, `/sales/complaints`, stock strip, panel link, nav, proxy

**Files:**
- Create: `app/sales/batches/page.tsx` + `components/sales/BatchesPanel.tsx`
- Create: `app/sales/complaints/page.tsx` + `components/sales/ComplaintsPanel.tsx`
- Modify: `app/sales/stock/*` (the client component — add the انقضا strip fetching `/api/sales/stock/expiry`)
- Modify: `components/CustomerDetailPanel.tsx` ("شکایت کیفی" link → `/sales/complaints?customer_id=<id>`)
- Modify: `app/sales/layout.tsx` (tabs «بچ‌ها» owner/manager, «شکایات» non-driver)
- Modify: `proxy.ts` (`/sales/batches` + `/api/sales/batches` + `/api/sales/stock/movements` → owner/manager, mirroring the `isCheques` rule)
- Test: `tests/proxy-batches.test.ts` if `proxy.ts` has a test sibling; else rely on `tsc` + route tests.

Pages are server components resolving the session and passing scoped `readCustomers(getDb(), scopeGroupIds(session))` (id/name/code) + `readCatalogue` products to the client panel; panels call the APIs. Model interactivity on `components/sales/PaymentsPanel.tsx` (Phase 1) — including the `// eslint-disable-next-line react-hooks/set-state-in-effect` on the mount fetch and the `?customer_id=` lazy-init pattern. Keep raw SQL out of the pages (use `lib/repo` / `lib/customers` / `lib/catalogue`).

`npx next typegen && rm -rf .next/dev/types` after adding pages.

- [ ] **Step 1** (optional proxy test) — [ ] **Step 2** — [ ] **Step 3: build pages + wire nav/proxy** — [ ] **Step 4:** `npx tsc --noEmit && npx eslint app/ lib/ components/sales/` + full suite — [ ] **Step 5: commit**

---

### Task 10: Tenancy wiring + docs/handoff

**Files:**
- Modify: `tests/helpers/twoOrgs.ts` (`OrgFixture` += `batchId`, `stockMovementId`, `complaintId`; seed a batch (`batch_code='SHARED-BATCH'`), a `PURCHASE_IN` movement, a `delivery_line_batches` row, and a `quality_complaints` row per org)
- Modify: `tests/tenancy-isolation.test.ts` (assert none leak; `SHARED-BATCH` appears once per org, i.e. count 2 across orgs)
- Modify: `docs/crm-erp-plan.md` Part 5 row 2 → ✅ DONE with the commit range
- Create: `docs/HANDOFF-2026-09-02-phase-2-stock-batches.md` — what shipped, deviations, the pre-deploy check (backup, `ROUTEFLOW_MIGRATION_CHECK_DB` run of the backfill + tenancy tests, on-hand-invariant check), next = Phase 3.

- [ ] **Step 1: failing isolation assertions** — [ ] **Step 2: FAIL** — [ ] **Step 3: seed + assert; write docs** — [ ] **Step 4: full suite green** — [ ] **Step 5: commit + push**
- [ ] **Step 6:** do **not** run `finishing-a-development-branch` — the stack merges after Phase 10. Leave `phase-2-stock` pushed and unmerged. Report completion.

---

## Self-Review

**Spec coverage:** `batches` + `stock_movements` + `delivery_line_batches` + `quality_complaints` → Task 1. Ledger + FEFO + `defaultFacilityId` → Task 2. Batch status machine + expiry sweep + expiry alerts + forward trace → Tasks 1, 3. `recordPurchase` integration → Task 4. `recordDelivery` FEFO integration + idempotency → Task 5. Backfill + `stockPosition` from movements → Task 6. Complaints + clustering + backward trace → Task 7. API → Task 8. UI → Task 9. Tenancy + docs → Task 10. Every spec §Testing bullet maps to a task Step 1.

**Placeholder scan:** the `<…>` markers in Tasks 4 and 6 (capture the id `insertLine` wrote; column lists) name the exact symbol/file to read — deliberate, not TODOs.

**Type consistency:** `MovementKind`, `MovementInput`, `BatchStatus`, `BATCH_TRANSITIONS`, `BatchRow`, `ComplaintRow`, `recordMovement`/`recordMovementsTxn`, `allocateFEFO`, `defaultFacilityId`, `createBatch`/`createBatchTxn`, `advanceBatchStatus`, `sweepBatchStatuses`, `expiringBatches`, `batchTrace`, `fileComplaint`, `complaintClusters`, `backwardTrace` used consistently Tasks 1 → 10.

**Ordering:** Task 2 (stock repo) before Task 3 (batches repo, needs `onHand`/`batchStock`) before Tasks 4–6 (integration + backfill, need both). Task 5 depends on Task 2's `allocateFEFO`. Task 6's backfill needs Tasks 3 + 2. `delivery_line_batches` keys on `delivery_stop_id` (exists) not `deliveries.id` (Phase 3) — noted in Task 1's schema and the spec.
