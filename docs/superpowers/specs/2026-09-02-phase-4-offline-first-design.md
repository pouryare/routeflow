# RouteFlow Phase 4 — Offline-first — Design

**Date:** 2026-09-02 · **Branch:** `phase-4-offline-first` (off `phase-3-order-pipeline`) · **Status:** design, unimplemented.

Implements `docs/crm-erp-plan.md` Part 5 row 4 and §4.5–4.6: `client_uuid` + `sync_mutations` + tombstones, an IndexedDB outbox, a sync engine, the service-worker write queue, the undo bar wired to the outbox hold, a sync-status island, and a conflict surface.

---

## 1. Goal

Move the service worker's own scope boundary — *"Writes are NOT queued while offline"* — so that the writes §4.5 classifies as **facts** (they record something that happened) queue locally and sync later, while **claims** (they reserve a shared resource) stay online-only. The 12-state order machine from Phase 3 is what makes the fact/claim split precise.

**One correction carried from §4.5:** server-authoritative timestamps are impossible for a basement delivery synced hours later, so both are kept — `occurred_at` (device, what the receipt says) and `received_at` (server) — plus `clock_skew_ms` measured each sync, so a wrong device clock is *detectable* rather than silently corrupting the timeline.

**Non-goals:** tasks / reminders / leads as offline writes (their tables arrive in Phase 7 — the outbox `op` enum leaves room). Conflict *resolution UI* beyond "a reminder for the person who made it". Multi-device snapshot merge.

---

## 2. What may go offline (§4.5, made executable)

`lib/offline/safety.ts` — a pure table, no imports from `lib/db`:

| op | maps to | class | why |
|---|---|---|---|
| `order.draftCreate` | `createOrder` | fact | local intent, claims nothing (client UUID) |
| `order.draftEdit` | `addLine` / edit | fact | same |
| `order.submit` | `submitOrder` → `PENDING_REVIEW` | fact | queues; server validates on arrival |
| `delivery.start` | `startRoute` | fact | a fact about the driver |
| `delivery.complete` | `completeDelivery` (deliver / partial / fail + POD) | fact | **the case that matters most** |
| `payment.record` | `recordPayment` (door cash) | fact | money changed hands |
| `customer.capture` | new `customers` row | fact | client UUID, nothing to collide with |
| `order.approve` | `passReview` / `approveCredit` | **claim** | reserves stock, checks credit |
| `order.plan` | `plan` | **claim** | route capacity is shared |
| `order.freeze` | `freeze` | **claim** | planner action, desk-bound |
| `credit.decide` | `creditApprovals.decide` | **claim** | an authority decision |

```ts
export type OfflineOp =
  | "order.draftCreate" | "order.draftEdit" | "order.submit"
  | "delivery.start" | "delivery.complete" | "payment.record" | "customer.capture"
  | "order.approve" | "order.plan" | "order.freeze" | "credit.decide";
export type OfflineClass = "fact" | "claim";
export function offlineClass(op: OfflineOp): OfflineClass;
export function mayQueueOffline(op: OfflineOp): boolean; // === offlineClass(op) === "fact"
export const OFFLINE_OPS: Record<OfflineOp, { class: OfflineClass; label_fa: string }>;
```

A `claim` op submitted while offline is refused at the call site with «این کار به اینترنت نیاز دارد» — it never enters the outbox.

---

## 3. Server side

### 3.1 Schema

```sql
-- client_uuid on every offline-writable table. No CHECK -> plain guarded ADD COLUMN.
-- UNIQUE so replaying a mutation is a no-op: a flaky link that retries six times
-- produces one row, not six.
ALTER TABLE orders     ADD COLUMN client_uuid TEXT;   CREATE UNIQUE INDEX ix_orders_cuuid    ON orders(client_uuid)     WHERE client_uuid IS NOT NULL;
ALTER TABLE payments   ADD COLUMN client_uuid TEXT;   CREATE UNIQUE INDEX ix_payments_cuuid  ON payments(client_uuid)   WHERE client_uuid IS NOT NULL;
ALTER TABLE deliveries ADD COLUMN client_uuid TEXT;   CREATE UNIQUE INDEX ix_deliveries_cuuid ON deliveries(client_uuid) WHERE client_uuid IS NOT NULL;
ALTER TABLE customers  ADD COLUMN client_uuid TEXT;   CREATE UNIQUE INDEX ix_customers_cuuid ON customers(client_uuid)  WHERE client_uuid IS NOT NULL;

CREATE TABLE sync_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  client_uuid TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  device_id TEXT,
  op TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,          -- device clock
  clock_skew_ms INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,          -- server clock
  applied_at TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','applied','duplicate','conflict','failed')),
  result_json TEXT,
  error TEXT,
  UNIQUE (organization_id, client_uuid)
);

CREATE TABLE deleted_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE INDEX ix_deleted_rows_since ON deleted_rows(organization_id, deleted_at);
```

`updated_at` audit: `orders`, `customers`, `delivery_runs`, `delivery_stops` already have it. `payments`, `order_events`, `deliveries`, `delivery_lines`, `stock_movements` do not — the pull side reads `created_at` for those (append-only, so `created_at` *is* the last-changed time). `stock_reservations` gains nothing (never pulled — the driver does not need it).

`TENANT_TABLES` += `sync_mutations`, `deleted_rows`. `deleted_rows` stays scoped — a tombstone names the org whose row went away.

### 3.2 `lib/repo/syncMutations.ts`

```ts
export interface IncomingMutation {
  client_uuid: string;      // UUIDv7 — the idempotency key
  op: OfflineOp;
  payload: Record<string, unknown>;
  occurred_at: string;
  clock_skew_ms: number;
  device_id?: string;
  depends_on?: string[];    // client_uuids that must apply first
  base_version?: string;    // the entity's updated_at when the device last saw it
}
export type MutationResult =
  | { status: "applied"; server_id: number | null }
  | { status: "duplicate"; server_id: number | null }
  | { status: "conflict"; reason: string }
  | { status: "failed"; error: string };

export function applyMutations(
  organizationId: number,
  userId: number,
  muts: IncomingMutation[]
): Record<string /* client_uuid */, MutationResult>;
```

- **Idempotency**: `SELECT … FROM sync_mutations WHERE organization_id = ? AND client_uuid = ?`. A row with `status IN ('applied','duplicate')` → return its `result_json` as `{status:'duplicate'}`. Otherwise insert/replace a `received` row, apply, stamp the outcome.
- **Ordering**: `muts` are toposorted on `depends_on` before applying. A `depends_on` client_uuid resolves to a server id via `sync_mutations.result_json` (this batch or a prior one) or a table scan on `client_uuid`; unresolved → `{status:'failed', error:'dependency not applied'}` (the client retries the whole chain later).
- **Dispatch**: `op` → an existing Phase 0–3 entry point, with `client_uuid` threaded so the created row carries it:
  - `order.draftCreate` → `createOrder({..., client_uuid})`
  - `order.submit` → `submitOrder(orgId, <resolved order id>, {id: userId, role})`
  - `delivery.start` → `advanceOrder(orgId, orderId, "startRoute", …)` (or a run-level helper)
  - `delivery.complete` → `completeDelivery(orgId, <resolved delivery id>, {id: userId}, payload)` — `occurred_at` + `clock_skew_ms` become `device_time`
  - `payment.record` → `recordPayment(orgId, {..., client_uuid})`
  - `customer.capture` → a `customers` insert with `client_uuid`, `lifecycle='lead'`
- **Conflict rules** (§4.5 table):
  - same `client_uuid` twice → duplicate no-op
  - a **claim** whose entity changed since `base_version` → `{status:'conflict'}` + a `reminders` row for `user_id`
  - order cancelled / customer blocked meanwhile → `{status:'conflict'}` + reminder
  - **a fact that drives stock negative → apply anyway**, then raise a stock-discrepancy `reminders` row. *In an ERP, refusing a fact is worse than accepting it and flagging it.*
- Each `createOrder` / `recordPayment` etc. is wrapped so a thrown `OrderError` / `PaymentError` becomes `{status:'failed', error: e.message}` rather than a 500.

The **existing** repo functions gain an optional `client_uuid` parameter (default `null`); when set it is written to the new column. `tests/fixtures/raw-sql-allowlist.txt` unaffected (all new SQL is in `lib/repo/`).

### 3.3 `lib/repo/syncPull.ts`

```ts
export interface PullResult {
  watermark: string;                 // max updated_at/created_at seen — the client's next `since`
  rows: { table: string; row: Record<string, unknown> }[];
  tombstones: { entity_type: string; entity_id: number; deleted_at: string }[];
}
export function pullSince(
  session: Session,
  since: string | null                // ISO; null = full snapshot
): PullResult;
```

Pull set, scoped by `orgFilter` + `groupFilter` + role (a driver gets only their own run and its customers/products/prices; a salesperson gets their group):

| table | change column | driver | salesperson+ |
|---|---|---|---|
| `orders` | `updated_at` | on today's run | own group, last 30 d |
| `order_lines` | via `orders` | ✓ | ✓ |
| `customers` | `updated_at` | on the run | own group |
| `products` / `product_prices` / `packagings` | `updated_at` | ✓ (all) | ✓ (all) |
| `delivery_runs` / `delivery_stops` | `updated_at` | own runs | group runs |
| `deliveries` / `delivery_lines` | `created_at` | own | group |
| `payments` | `created_at` | own door payments | group |

`tombstones` = `deleted_rows` for the org since `since`. `watermark` is the max change-time across every returned row (so a client that pulls, then pulls again immediately, gets nothing).

### 3.4 Tombstones

`tombstone(db, organizationId, entityType, entityId)` in `lib/repo/base.ts` (or a small `lib/repo/tombstones.ts`). Called from every hard `DELETE` of an offline-relevant row — today that is `addLine`/line removal on a draft and `createOrder` rollback is not a delete. Realistically Phase 4 wires it into: order-line delete, order cancel is a status change not a delete (no tombstone), `deliveries` are never deleted. So the immediate callers are thin; the table and helper exist so Phase 7's task deletes propagate for free.

### 3.5 API

| route | method | body / query | notes |
|---|---|---|---|
| `/api/sync/push` | POST | `{ device_id, mutations: IncomingMutation[] }` | → `{ ok, results: Record<client_uuid, MutationResult>, server_time }`. `server_time` lets the client re-measure skew. Role: any authenticated non-platform user. |
| `/api/sync/pull` | GET | `?since=<iso>` | → `PullResult` + `server_time`. Same auth. |

`proxy.ts`: `/api/sync/*` is authenticated-only, no extra role gate (the repo scopes by session).

---

## 4. Client side

All under `lib/offline/`. The **pure** modules are node-tested; the **browser glue** (IndexedDB, service worker, React island) is written against the same standards as every other Phase 0–3 component and left for the live check — consistent with this repo, which has no component/browser unit tests.

### 4.1 `lib/offline/uuidv7.ts` (pure, tested)

`uuidv7()` — 48-bit big-endian Unix-ms timestamp + 74 random bits, RFC-9562 layout. Time-ordered so the outbox's natural sort is roughly causal, and so two mutations queued a second apart never collide.

### 4.2 `lib/offline/clock.ts` (pure, tested)

- `measureSkew(serverIso: string, clientMs: number): number` — `serverMs - clientMs`, the amount to *add* to a device time to get server time.
- `toServerTime(deviceIso: string, skewMs: number): string` — apply it.
- Skew is stored per mutation at queue time and refreshed on every `push` / `pull` response's `server_time`.

### 4.3 `lib/offline/outbox.ts` (pure, tested)

```ts
export interface OutboxRecord {
  id: string;                 // uuidv7 — the client_uuid
  op: OfflineOp;
  payload: Record<string, unknown>;
  occurred_at: string;
  clock_skew_ms: number;
  queued_at: string;
  attempts: number;
  status: "held" | "pending" | "sending" | "applied" | "conflict" | "failed";
  depends_on?: string[];
  error?: string;
}
export interface OutboxStore {
  all(): Promise<OutboxRecord[]>;
  get(id: string): Promise<OutboxRecord | undefined>;
  put(r: OutboxRecord): Promise<void>;
  remove(id: string): Promise<void>;
}
export class Outbox {
  constructor(store: OutboxStore, now?: () => number);
  enqueue(op: OfflineOp, payload, opts?: { depends_on?; occurred_at?; clock_skew_ms? }): Promise<OutboxRecord>;
  releaseHeld(): Promise<number>;            // held -> pending once ACTION_LIFETIME_MS has passed
  undo(id: string): Promise<boolean>;        // only while "held": delete the IndexedDB row. Instant, offline-identical.
  nextBatch(limit?: number): Promise<OutboxRecord[]>;  // "pending", toposorted, deps must be "applied"
  markSending(ids: string[]): Promise<void>;
  applyResults(results: Record<string, MutationResult>): Promise<void>;  // -> applied / conflict / failed(+attempts, backoff)
  pendingCount(): Promise<number>;
}
```

- **Hold**: `enqueue` writes `status:"held"`. `releaseHeld` flips to `"pending"` after `ACTION_LIFETIME_MS` (9000, imported from the shared constant — see §4.6). While `held`, `undo` is a local delete: no round trip, no compensating write, identical offline.
- **Ordering**: `nextBatch` returns only `pending`, toposorted on `depends_on`, and skips any record whose dependency is not yet `applied` (so a door payment never ships before its offline-created order).
- **Backoff**: a `failed` result bumps `attempts`; the engine delays the next attempt `min(30s * 2^attempts, 10min)`. After 8 attempts it stays `failed` and shows in the outbox for the user to retry or discard.
- **`enqueue` refuses a claim op** — `mayQueueOffline(op) === false` throws before any write.

### 4.4 `lib/offline/idbStore.ts` (browser, not unit-tested)

`IdbOutboxStore implements OutboxStore` over one IndexedDB database `routeflow-offline`, object store `outbox` (keyPath `id`), plus a `snapshot` store (keyPath `[table, id]`) holding the reads the driver needs — today's run, assigned customers, products, prices — refreshed by every `pull`. All accessors `try/catch` and degrade (a private window, blocked storage) to an in-memory `Map` so the app still runs, just without persistence across reloads.

### 4.5 `lib/offline/syncEngine.ts` (browser glue, not unit-tested)

- **Triggers**: `online` event · `visibilitychange` → visible · a 30 s interval while `navigator.onLine` · `navigator.serviceWorker` Background Sync `sync` event where available · on app start.
- **Cycle**: `releaseHeld()` → `nextBatch()` → `POST /api/sync/push` → `applyResults()` → `pull(since=watermark)` → write rows + tombstones into the `snapshot` store → re-measure skew from `server_time`.
- **Conflicts**: a `conflict` result is surfaced by the server's own `reminders` row; the engine also marks the outbox record `conflict` so the sync-status island can show it and the user can read the payload.
- Exposes a tiny event target (`change`) the island subscribes to.

### 4.6 The undo bar — already built

`components/ToastProvider.tsx` already ships the §4.6 bar: a 3px `island__timer-fill` track animated with `transform: scaleX()` + `transform-origin` for RTL, `aria-hidden`, pause on hover / focus / tab-hidden / action-running, `prefers-reduced-motion` quantised to discrete steps, the deadline in the button's accessible name («لغو — N ثانیه فرصت»), and `ACTION_LIFETIME_MS = 9000`.

Phase 4's only change: extract `ACTION_LIFETIME_MS` into `lib/offline/constants.ts` (re-exported from `ToastProvider` so nothing else moves) and have `Outbox.releaseHeld` use it, so the visible bar and the invisible hold are provably the same number. An actionable toast whose action enqueues an offline mutation passes the freshly-minted `client_uuid` as its undo target: undo = `outbox.undo(id)`.

### 4.7 Sync-status island (`components/SyncStatus.tsx`, browser, not unit-tested)

A small persistent indicator in the existing Island idiom: a dot (green online / grey offline), `N` pending, «آخرین همگام‌سازی …». Tap expands the outbox — each record's op label (`OFFLINE_OPS[op].label_fa`), status, and `occurred_at`; a `held` record shows an undo button, a `failed`/`conflict` one shows retry / discard. Mounted once in the sales and driver layouts. A queue the user cannot see is a queue they cannot trust.

### 4.8 Service worker write queue (`public/sw.js`, browser, not unit-tested)

The worker's header comment gets rewritten. New behaviour: a `POST` to an allowlisted offline endpoint (`/api/sync/push` is *not* in the list — it is the drain; the list is the optimistic endpoints like `/api/sales/deliveries/*/complete`, `/api/payments`) while `!navigator.onLine` is answered **from the worker** with `202 { queued: true, client_uuid }` after posting the body to the page via `postMessage` for the page's `Outbox.enqueue`. Where the page is not open, the worker writes straight to IndexedDB. A `sync` event (Background Sync) posts a "flush" message to any client, or does a bare `fetch('/api/sync/push', …)` from a cursor over the `outbox` store. Cache version bumped to `-v3`.

*If the service-worker↔page messaging proves fragile in the live check, the fallback is page-only queueing: every `fetch` in the app goes through a `postJSON` wrapper that checks `navigator.onLine` and calls `Outbox.enqueue` itself. The worker then only handles Background Sync. This is noted so the reviewer knows the intended degradation.*

---

## 5. Tenancy

- `TENANT_TABLES` += `sync_mutations`, `deleted_rows`.
- `twoOrgs`: `OrgFixture` += `syncMutationId`; `build()` seeds one `sync_mutations` row (`op 'payment.record'`, `client_uuid` colliding as `SHARED-MUT` across orgs — proves the `UNIQUE (organization_id, client_uuid)` is per-tenant) and one `deleted_rows` row.
- `tenancy-isolation`: new `it` — `sync_mutations` / `deleted_rows` do not leak; both orgs hold `SHARED-MUT`.
- `tenancy-schema` exempt set unchanged (both new tables are tenant-scoped).

---

## 6. Migration safety / real-data check

`tests/offline-migration-realdata.test.ts` (env-gated on `ROUTEFLOW_MIGRATION_CHECK_DB`, `describe.skipIf`):

1. `PRAGMA foreign_key_check` empty after `getDb()`.
2. `client_uuid` columns present and NULL on every legacy row; the partial unique indexes exist.
3. `sync_mutations` and `deleted_rows` empty.
4. Row counts on `orders` / `payments` / `customers` unchanged (plain ADD COLUMN, no rebuild).

---

## 7. Deviations anticipated

- **No table rebuild** — `client_uuid` is a plain `ADD COLUMN` + a *partial* unique index (`WHERE client_uuid IS NOT NULL`), so every existing NULL row is fine and the migration is O(1) per table.
- **Append-only tables are pulled on `created_at`**, not a new `updated_at` — for `payments` / `order_events` / `deliveries` the created time *is* the last-changed time, and adding `updated_at` to append-only tables invites a write that should never happen.
- **`order.approve` / `plan` / `freeze` / `credit.decide` never enter the outbox** — a claim refused offline is refused at the call site, not queued-then-rejected. Queue-then-reject would let a manager believe they approved something.
- **The service worker's fallback is page-only queueing** (§4.8) — documented, not built, because the SW↔page path is the better UX when it works and the live check is the place to find out.
- **Client browser glue is not unit-tested** — the repo has zero component/browser tests; `lib/offline/{uuidv7,clock,outbox,safety}.ts` and everything server-side are fully TDD'd, the IndexedDB / SW / React island are written to standard and checked live.
