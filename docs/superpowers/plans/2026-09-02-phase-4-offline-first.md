# Phase 4 — Offline-first Implementation Plan

> **For agentic workers:** execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** Facts queue offline and sync; claims stay online. `client_uuid` idempotency, an IndexedDB outbox, a sync engine, the undo bar wired to the outbox hold, a sync-status island.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-4-offline-first-design.md`

## Global Constraints

- Money = whole Toman `INTEGER`. Dates ISO stored. Persian UI text, English identifiers.
- Cross-tenant → 404. Migrations idempotent, guarded; `client_uuid` is a plain `ADD COLUMN` + partial unique index (no rebuild).
- New DB access via `lib/repo/`. Never commit to `main`. Never `npm run build` / `systemctl restart`.
- Tests: node env, temp `COVERAGE_DB_PATH`. Pure `lib/offline/{uuidv7,clock,outbox,safety}.ts` + all server code are TDD'd; IndexedDB / service worker / React island are written to standard, not unit-tested (repo has no browser tests).
- Vitest in background + poll. eslint `app/ lib/` + per-file. After route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/offline/safety.ts` — the fact/claim classifier

**Files:** Create `lib/offline/safety.ts`, `tests/offline-safety.test.ts`.

- `OfflineOp` union (11 ops, spec §2), `OfflineClass = "fact" | "claim"`, `OFFLINE_OPS` record with `class` + `label_fa`, `offlineClass(op)`, `mayQueueOffline(op)`.
- Tests: every fact op → `"fact"`, every claim op → `"claim"`; `mayQueueOffline("payment.record")` true, `mayQueueOffline("order.approve")` false; every op has a `label_fa`; `OFFLINE_OPS` covers the union exactly.
- Pure — no imports from `lib/db` / `lib/repo`.
- Commit.

### Task 2: `lib/offline/uuidv7.ts` + `lib/offline/clock.ts`

**Files:** Create `lib/offline/uuidv7.ts`, `lib/offline/clock.ts`, `tests/offline-uuidv7.test.ts`, `tests/offline-clock.test.ts`.

- `uuidv7(now?)` — RFC-9562 layout (48-bit ms ts, version 7 nibble, variant bits, 74 random). Exports also `uuidv7Time(id)` → ms.
- Tests: format matches `/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`; two ids from the same ms sort by generation order is not guaranteed but ids 2 ms apart are strictly increasing as strings; `uuidv7Time` round-trips the injected `now` to the ms.
- `clock.ts`: `measureSkew(serverIso, clientMs)` = `Date.parse(serverIso) - clientMs`; `toServerTime(deviceIso, skewMs)` = `new Date(Date.parse(deviceIso) + skewMs).toISOString()`.
- Tests: a device 5 s slow → skew ≈ +5000; `toServerTime` applies it; skew 0 is identity.
- Commit.

### Task 3: `lib/offline/outbox.ts` — the pure queue

**Files:** Create `lib/offline/outbox.ts`, `lib/offline/constants.ts`, `tests/offline-outbox.test.ts`; Modify `components/ToastProvider.tsx` (re-export `ACTION_LIFETIME_MS` from the new constants module).

- `lib/offline/constants.ts`: `export const OUTBOX_HOLD_MS = 9000;` `ToastProvider` changes `export const ACTION_LIFETIME_MS = 9000;` → `export { OUTBOX_HOLD_MS as ACTION_LIFETIME_MS } from "@/lib/offline/constants";` (keep the name it exports so no other file moves).
- `OutboxRecord`, `OutboxStore` interface, `Outbox` class per spec §4.3. `new Outbox(store, now = Date.now)`.
- `enqueue` — refuses a claim (`mayQueueOffline` false → throw `OfflineError`), else writes `status:"held"`, `attempts:0`, `queued_at`, generated `id = uuidv7(now())`.
- `releaseHeld()` — `held` → `pending` where `now - queued_at >= OUTBOX_HOLD_MS`; returns count.
- `undo(id)` — only if `status === "held"`: `store.remove`; returns bool.
- `nextBatch(limit=20)` — `pending` only, toposorted on `depends_on`, drop any whose dep is missing or not `applied`.
- `applyResults(map)` — `applied`/`duplicate` → `applied`; `conflict` → `conflict` (+ `error`); `failed` → `failed` + `attempts+1`.
- `pendingCount()` — `held` + `pending` + `sending`.
- Tests with an in-memory `OutboxStore`: enqueue a fact → `held`; enqueue a claim → throws; `releaseHeld` with `now` advanced 9 s → `pending`; `undo` a held record removes it, `undo` a pending record returns false; `nextBatch` orders `[order.draftCreate, payment.record depends_on order]` so the order is first, and omits the payment until the order is `applied`; `applyResults` transitions correctly and bumps attempts on `failed`.
- Commit.

### Task 4: schema — `client_uuid`, `sync_mutations`, `deleted_rows`

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/sync-schema.test.ts`.

- Guarded `ADD COLUMN client_uuid TEXT` on `orders`, `payments`, `deliveries`, `customers` + `CREATE UNIQUE INDEX … WHERE client_uuid IS NOT NULL` each (all guarded on `PRAGMA table_info` / `sqlite_master`).
- `sync_mutations` + `deleted_rows` tables in the main schema block. `TENANT_TABLES` += both.
- Schema test: columns + partial indexes exist; `sync_mutations` rejects an unknown `status`; `UNIQUE (organization_id, client_uuid)` holds within an org and lets two orgs share a `client_uuid`; a second row with the same `(org, client_uuid)` throws.
- Run full suite — a plain ADD COLUMN should break nothing; fix any exact-column-list schema test (`orders`, `customers`).
- Commit.

### Task 5: `client_uuid` params on the write entry points

**Files:** Modify `lib/orders.ts` (`createOrder`), `lib/repo/payments.ts` (`recordPayment`), `lib/repo/deliveries.ts` (`planDelivery`), `lib/repo/customers.ts` (new-lead insert if present), and their tests.

- Each gains an optional `client_uuid?: string | null` in its input; when set, written to the new column. Default `null` — every existing caller and test is unchanged.
- Tests: `createOrder({..., client_uuid: "u1"})` → the row has `client_uuid = 'u1'`; omitting it → `NULL`; two `createOrder` with the same `client_uuid` → the second throws (unique index).
- Commit.

### Task 6: `lib/repo/tombstones.ts`

**Files:** Create `lib/repo/tombstones.ts`, `tests/tombstones.test.ts`; Modify `lib/orders.ts` (record a tombstone when a draft line is deleted, if such a path exists — else leave the helper unused-by-Phase-4 and note it).

- `tombstone(organizationId, entityType, entityId, db?)` — inserts a `deleted_rows` row (`deleted_at = now`). `tombstonesSince(organizationId, sinceIso)` — rows since.
- Tests: `tombstone` then `tombstonesSince` returns it; a tombstone before the watermark is excluded; cross-org tombstone not returned.
- Commit.

### Task 7: `lib/repo/syncMutations.ts` — `applyMutations`

**Files:** Create `lib/repo/syncMutations.ts`, `tests/sync-apply.test.ts`.

- `IncomingMutation`, `MutationResult`, `applyMutations(orgId, userId, muts)` per spec §3.2.
- Idempotency: a `client_uuid` already `applied`/`duplicate` in `sync_mutations` → return `{status:"duplicate", server_id}` from `result_json`.
- Toposort on `depends_on`; resolve a dep client_uuid → server id via `sync_mutations.result_json` (this batch first, then a DB lookup); unresolved → `{status:"failed", error}`.
- Dispatch table `op` → entry point (spec §3.2). Wrap each so `OrderError`/`PaymentError`/`DeliveryError` → `{status:"failed", error}`.
- Conflict: a `claim`… none reach here (claims never queue) — but keep the `base_version` check for `delivery.complete` on an order already `CLOSED`/`CANCELLED` → `{status:"conflict"}` + a `reminders` row for `userId`. A fact that drives stock negative still applies (the movement ledger already tolerates it) — assert on-hand can go negative and a `reminders` discrepancy row is written.
- Every applied mutation writes its `sync_mutations` row (`status`, `applied_at`, `result_json`).
- Tests: apply `[order.draftCreate {client_uuid:o1}, payment.record {depends_on:[o1]}]` → both `applied`, the payment's order_id resolves to the new order; replay the same batch → both `duplicate`, no second order; `delivery.complete` for an order that was cancelled server-side → `conflict` + a reminder; a `payment.record` with a bad amount → `failed` with the `PaymentError` message, and its `sync_mutations` row is `failed`.
- Commit.

### Task 8: `lib/repo/syncPull.ts` — `pullSince`

**Files:** Create `lib/repo/syncPull.ts`, `tests/sync-pull.test.ts`.

- `pullSince(session, since)` per spec §3.3 — role-branched (`driver` → own run + its customers/products/prices; `salesperson`/`group_manager`/`owner` → group scope). Returns `{watermark, rows, tombstones}`.
- `watermark` = max change-time over every returned row (fallback to `since` when nothing changed).
- Tests: seed two orgs + a driver run; `pullSince(driverSession, null)` returns that run's orders/stops/customers and the shared catalogue, and **nothing** from the other org or another driver's run; after `since = watermark`, an immediate re-pull returns zero rows; a `deleted_rows` entry after `since` shows in `tombstones`; a salesperson pull is group-scoped.
- Commit.

### Task 9: API — `/api/sync/push` + `/api/sync/pull`

**Files:** Create `app/api/sync/push/route.ts`, `app/api/sync/pull/route.ts`; Modify `proxy.ts`; Create `tests/api/sync-route.test.ts`.

- `push` POST `{device_id, mutations}` → `{ok, results, server_time}`. `pull` GET `?since=` → `{ok, ...PullResult, server_time}`. Auth: any non-platform authenticated user; `proxy.ts` lets `/api/sync/*` through with just the auth check.
- `npx next typegen && rm -rf .next/dev/types`.
- Tests: a driver pushes a `delivery.complete` mutation → 200, result `applied`, and `GET /api/sync/pull` reflects the new delivery; replay → `duplicate`; an unauthenticated request → 401; `server_time` is present on both.
- Commit.

### Task 10: `lib/offline/idbStore.ts` + `lib/offline/net.ts` (browser, not unit-tested)

**Files:** Create `lib/offline/idbStore.ts`, `lib/offline/net.ts`.

- `IdbOutboxStore implements OutboxStore` over IndexedDB db `routeflow-offline`, stores `outbox` (keyPath `id`) + `snapshot` (keyPath `[table,id]`). Every op `try/catch` → in-memory `Map` fallback; a `memoryOnly` flag it exposes.
- `net.ts`: `postJSON(url, body)` / `getJSON(url)` wrappers that measure `server_time` skew from the response and, on `!navigator.onLine` for an allowlisted offline endpoint, hand off to `Outbox.enqueue` and return an optimistic `{queued:true, client_uuid}`.
- No test file (browser). `npx tsc --noEmit` must stay clean.
- Commit.

### Task 11: `lib/offline/syncEngine.ts` + service worker (browser, not unit-tested)

**Files:** Create `lib/offline/syncEngine.ts`; Modify `public/sw.js`.

- `SyncEngine` — construct with an `Outbox` + a `pull` fn; `start()` wires `online` / `visibilitychange` / a 30 s interval / `serviceWorker` `message` "flush"; `runCycle()` does releaseHeld → nextBatch → push → applyResults → pull → write snapshot. Emits `change`.
- `public/sw.js` — rewrite the header comment; bump caches to `-v3`; add: on a `POST` to an allowlisted endpoint while offline, respond `202 {queued:true}` and `postMessage({type:"queue", ...})` to clients (fallback: write to IndexedDB directly); a `sync` event → `postMessage({type:"flush"})`.
- No test file. `tsc` clean; `eslint` clean (sw.js is plain JS — add to `.eslintignore` if it is not already, or keep it lint-clean).
- Commit.

### Task 12: Sync-status island + wiring

**Files:** Create `components/SyncStatus.tsx`; Modify `app/sales/layout.tsx`, `components/driver/DriverRun.tsx` (or the driver layout), `components/ToastProvider.tsx` (an actionable offline toast targets `outbox.undo`).

- `SyncStatus` — online dot, pending count, last-synced; tap → outbox list with per-record op label / status / `occurred_at`; `held` → undo, `failed`/`conflict` → retry / discard. Subscribes to `SyncEngine` `change`.
- Mount once in the sales layout and the driver screen.
- `tsc` + `eslint` clean.
- Commit.

### Task 13: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/offline-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-4-offline-first.md`; update memory `routeflow-phase-progress`.

- `twoOrgs`: `OrgFixture` += `syncMutationId`; seed one `sync_mutations` (`SHARED-MUT` client_uuid) + one `deleted_rows` per org.
- `tenancy-isolation`: new `it` — no `sync_mutations` / `deleted_rows` leak; both orgs hold `SHARED-MUT`.
- Real-data test per spec §6 (env-gated). Run against a copy of `data/backups/pre-tenancy-20260901-224428.db`.
- Full suite green, `npx tsc --noEmit`, `npx eslint app/ lib/`.
- `docs/crm-erp-plan.md` Part 5 row 4 → ✅ DONE (branch, date, unmerged).
- Handoff doc: what shipped, deviations, the service-worker fallback note, pre-deploy checklist, next = Phase 5.
- Commit.
