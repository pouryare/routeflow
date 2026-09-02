# RouteFlow Phase 4 (Offline-first) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-4-offline-first` (off `phase-3-order-pipeline`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-4-offline-first-design.md`
Plan: `docs/superpowers/plans/2026-09-02-phase-4-offline-first.md` (13 tasks, all done)

## What shipped

| Area | Detail |
|---|---|
| `lib/offline/safety.ts` | The §4.5 fact/claim table. 7 **fact** ops queue offline (`order.draftCreate/draftEdit/submit`, `delivery.start/complete`, `payment.record`, `customer.capture`); 4 **claim** ops never enter the outbox (`order.approve/plan/freeze`, `credit.decide`) — refused at the call site with «این کار به اینترنت نیاز دارد». `OFFLINE_OPS` also carries a `label_fa` for the outbox UI. Pure. |
| `lib/offline/uuidv7.ts` | RFC-9562 time-ordered id = the `client_uuid` / idempotency key. `uuidv7(now?)`, `uuidv7Time(id)`. Pure. |
| `lib/offline/clock.ts` | `measureSkew(serverIso, clientMs)` (amount to add to a device time to get server time), `toServerTime`, `skewIsSuspect` (>60 s). The honest form of "server-authoritative time" for a basement delivery synced hours later. Pure. |
| `lib/offline/outbox.ts` | `Outbox` over an injected `OutboxStore`. `enqueue` (refuses claims, writes `held`), `releaseHeld` (`held→pending` after `OUTBOX_HOLD_MS`), `undo` (local delete while `held` — instant, offline-identical), `nextBatch` (dependency-ordered, deps must be `applied`), `applyResults` (`applied`/`conflict`/`failed`+backoff), `pendingCount`. `MemoryOutboxStore` fallback. Pure. |
| `lib/offline/constants.ts` | `OUTBOX_HOLD_MS = 9000` — the one number. `ToastProvider.ACTION_LIFETIME_MS` now re-exports it, so the visible undo bar and the invisible hold cannot drift. The bar itself was already built in Phase 3's `ToastProvider` (§4.6). |
| Schema | `client_uuid TEXT` + a **partial** `UNIQUE INDEX … WHERE client_uuid IS NOT NULL` on `orders`, `payments`, `deliveries`, `customers` — plain ADD COLUMN, run **last** in `getDb()` so no later table rebuild drops it. `sync_mutations` (server idempotency log, `UNIQUE (organization_id, client_uuid)`, status CHECK `received/applied/duplicate/conflict/failed`, `occurred_at` + `clock_skew_ms` + `received_at`). `deleted_rows` tombstones. Both on `TENANT_TABLES`. |
| `client_uuid` params | `createOrder`, `recordPayment`, `planDelivery` take an optional `client_uuid` (default `null`). Every existing caller unchanged. |
| `lib/repo/tombstones.ts` | `tombstone(orgId, entityType, entityId, db?)` + `tombstonesSince(orgId, since)`. Phase 4's own delete paths are thin; the table + helper exist so Phase 7's task deletes propagate. |
| `lib/repo/syncMutations.ts` | `applyMutations(orgId, userId, muts)` — toposort on `depends_on`; idempotent on `(org, client_uuid)` (a decided key returns its stored verdict); resolve a client-ref → server id (this batch → prior mutation's `result_json` → table scan on `client_uuid`); dispatch each op to its Phase 0–3 entry point with `client_uuid` threaded. `OrderError`/`PaymentError`/`DeliveryError` → `{status:"failed"}`. A `delivery.complete` for a server-terminal order → `{status:"conflict"}` + a `reminders` row. A fact that drives stock negative still applies (the ledger tolerates it). Every mutation stamps its `sync_mutations` row. |
| `lib/repo/syncPull.ts` | `pullSince(session, since)` — role-branched. Driver: their own runs + everything a stop needs (orders, lines, customers, deliveries) + the full catalogue (products/prices/packagings). Salesperson/manager/owner: the group's recent orders + customers + catalogue. Returns `{rows, tombstones, watermark}` — `watermark` = max change-time, so an immediate re-pull is empty. `customers` change on `synced_at`, append-only tables on `created_at`, the rest on `updated_at`. |
| API | `POST /api/sync/push` (`{device_id, mutations}` → `{ok, results, server_time}`, ≤200/batch, idempotent), `GET /api/sync/pull?since=` (→ `{ok, rows, tombstones, watermark, server_time}`). Any authenticated non-platform user. `proxy.ts` carves `/api/sync/*` out of the driver one-screen lockdown. |
| Client glue (**not unit-tested** — see below) | `lib/offline/idbStore.ts` (`IdbOutboxStore` + a `snapshot` store, in-memory `Map` fallback when IndexedDB is blocked/private), `lib/offline/net.ts` (`postJSON` diverts an offline write on an allowlisted endpoint into the outbox and returns `{queued:true, client_uuid}`; re-measures skew from every `server_time`), `lib/offline/syncEngine.ts` (`SyncEngine` — triggers `online`/`visibilitychange`/30 s/SW `flush` message/app start; `runCycle` = releaseHeld → nextBatch → push → applyResults → pull → writeSnapshot; `getSyncEngine()` singleton), `components/SyncStatus.tsx` (online dot, pending count, tap → outbox list with undo/retry/discard — mounted in the sales layout and the driver screen), `public/sw.js` bumped to `-v3` + a Background Sync `sync` handler that `postMessage({type:"flush"})` to every client. |
| Tenancy | `sync_mutations` + `deleted_rows` on `TENANT_TABLES`. `twoOrgs` seeds a `sync_mutations` row (`SHARED-MUT` client_uuid, colliding) + a `deleted_rows` row per org; `tenancy-isolation` asserts no leak and that both orgs hold `SHARED-MUT` (the `UNIQUE` is per-tenant). |

Suite: 146 files / 1381 tests green (+1 skipped). `npx tsc --noEmit` and `npx eslint app/ lib/` clean. Real-data check (`tests/offline-migration-realdata.test.ts`) passed against the pre-tenancy backup: FK check clean, `client_uuid` present and NULL on every legacy row, partial indexes present, `sync_mutations`/`deleted_rows` empty, `orders`/`customers` counts unchanged.

## Deviations from the plan

- **The service worker does NOT intercept POST bodies.** The offline outbox lives in the page (`lib/offline/net.postJSON` enqueues when `navigator.onLine` is false); the SW's only write-side job is the Background Sync `sync` event that wakes a client. This is the fallback the spec (§4.8) named, taken deliberately: the SW↔page `postMessage` round-trip for every write is fragile and the page-only path is simpler and testable. The `sync` event still lets the queue drain with no tab focused.
- **No table rebuild for `client_uuid`** — plain ADD COLUMN + a *partial* unique index (`WHERE client_uuid IS NOT NULL`), so every legacy NULL row is fine and the migration is O(1) per table. Runs last in `getDb()`, after every Phase 0–3 rebuild, so nothing drops the column.
- **`customers` pulls on `synced_at`, not `updated_at`** — the spec assumed `customers.updated_at`; it does not exist. `synced_at` is the table's change marker.
- **Append-only tables (`payments`, `order_events`, `deliveries`, `delivery_lines`, `packagings`, `product_prices`) are pulled on `created_at`** — for an append-only row the created time is the last-changed time.
- **Claims are refused, never queued-then-rejected** — `Outbox.enqueue` throws for a claim op before writing anything.
- **Client browser glue is not unit-tested** — this repo has zero component/browser test harness (no jsdom wiring, no `fake-indexeddb`, no `@testing-library` usage in `tests/`). `lib/offline/{safety,uuidv7,clock,outbox}.ts` and every server module are fully TDD'd; the IndexedDB adapter, the sync engine's browser wiring, the React island and the SW are written to standard and left for the live check — the same treatment every Phase 1–3 UI component received.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API (never `cp` — WAL).
2. Against a copy:
   `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/offline-migration-realdata tests/order-pipeline-migration-realdata tests/stock-migration-realdata tests/tenancy-schema` — confirm `foreign_key_check` empty, `client_uuid` NULL on every legacy row, partial indexes present, `sync_mutations`/`deleted_rows` empty, `orders`/`payments`/`customers` counts unchanged.
3. `npm run build` + `systemctl restart coverage-map`.
4. Live check the browser glue: install the SW (`-v3` cache), go offline, complete a delivery, watch the sync-status island show `1 در صف`, tap it, `لغو` inside the 9 s hold, then complete again and let the hold lapse; go online and confirm the push drains and `/api/sync/pull` reflects it. Repeat with `payment.record`. Confirm a `claim` op (approve/plan) is refused offline, not queued.

## Next: Phase 5 — Routing

Per `docs/crm-erp-plan.md` Part 5 row 5: M7 `vehicles` / `route_templates` / `route_schedules`, OSRM + VROOM self-hosted, the planner UI, route freeze at `route_schedules.cutoff_time`. Depends on nothing from Phase 4 but branches off it. Note: VROOM/OSRM are Docker services — that part is deployment, not code, and cannot be TDD'd here; the `vehicles`/templates schema, the capacity math and the freeze logic can.
