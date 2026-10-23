# RouteFlow handoff — 2026-09-02, mid Phase 0a (tenancy foundation)

Read this first in a fresh conversation. It replaces the need to re-derive
anything from chat history. Repo: `github.com/pouryare/routeflow` (renamed
from RouteFlow on 2026-09-01). Working dir: `/root/pourya/RouteFlow`.
Branch: `phase-0-tenancy` (not merged to `main`).

## ✅ RESOLVED 2026-09-02: the "lost" planning docs were never lost

This section previously claimed `docs/crm-erp-plan.md` and
`docs/crm-erp-source-extract.md` had never been written. **They had** —
they were sitting at `/root/pourya/docs/` (one directory *above* the
repo), so `git log --all` and a search inside `RouteFlow/` both missed
them. They are now copied into `RouteFlow/docs/` and committed, so
they are version-controlled and discoverable from here on.

- **`docs/crm-erp-plan.md`** — the real v2 plan. 771 lines: Part 0
  decisions-locked table, Part 1 already-executed, Part 2 storage
  (SQLite + offline-first + repo layer), Part 3 data model M1–M8, Part 4
  features designed (4.1 weather→stops, 4.2 VROOM routing, 4.3 briefing,
  4.4 academy, 4.5 offline-first, 4.6 undo bar), **Part 5 Build order**
  (the authoritative phase list, 0–10, with gates), Part 6 not-built,
  Part 7 risks. This supersedes the "Full 10-phase plan (reconstructed
  from memory)" section lower in this handoff — **trust the plan doc, not
  the recollection.**
- **`docs/crm-erp-source-extract.md`** — the distilled ChatGPT input.
  425 lines: §1 business facts, §2–§7 proposals, §8 the ten open
  questions. Source conversation
  `chatgpt.com/share/6a91bcc0-b388-83e9-b1b4-c2dd81cdef7a`.

**Phase numbering note:** the plan doc calls it one "Phase 0.
Foundations". This handoff split it into 0a (tenancy — DONE) and 0b (the
rest: `lib/repo` layer, M2 customers/reps/credit, credit-approval
workflow, demo-data separation/purge). Same work, different labels.

The tenancy implementation plan itself is real and on disk, unaffected by
this gap: `docs/superpowers/plans/2026-09-01-phase-0a-tenancy-foundation.md`
(1362 lines, 7 tasks, TDD steps throughout — this is the plan actually being
executed).

## What's actually true right now (verified today, not recalled)

- Branch `phase-0-tenancy`, 5 commits ahead of where Part 1 (the rename)
  left off: `7f00880`, `369f211`, `0cc92cf`, `9e201c4` (Tasks 1–4), plus
  `14d1206` (undo bar, unrelated to tenancy, shipped standalone) and
  `6022464` (the plan doc itself).
- Full test suite: **85 files, 1113 tests, all passing**, as of 2026-09-02
  after Tasks 5 + 5b (`npx vitest run`). Was 83/1104 before.
- The tenancy plan's checkboxes in the plan file are still all unchecked
  (`- [ ]`) even for finished tasks — progress was tracked via commits and
  todos during execution, not by editing the plan file. **Trust the commit
  log over the checkboxes.**
- `APP_PASSWORD` deleted per user request, in the rename commit `8296c07`.

## Phase 0a tenancy plan — task-by-task status

Plan file: `docs/superpowers/plans/2026-09-01-phase-0a-tenancy-foundation.md`

- **Task 1 — DONE** (`7f00880`): `organizations` table, seeded id=1 for
  طعمینو. `platform_owner` added to the `Role` union and the `users.role`
  CHECK constraint (table-rebuild pattern, since SQLite can't ALTER a
  CHECK). `lib/roles.ts` and `scripts/create-user.mjs` both updated (a test
  asserts they never drift apart).
- **Task 2 — DONE** (`369f211`): `organization_id` added to all 16
  `TENANT_TABLES` (see `lib/db.ts`), backfilled twice — once right after the
  ALTER, once again at the very end of the migration function as a safety
  net. The two-pass backfill exists because of a real bug (see "Bugs found
  and fixed" below).
- **Task 3 — DONE** (`0cc92cf`): UNIQUE constraints made per-tenant
  (`UNIQUE(organization_id, x)` instead of `UNIQUE(x)`) on customers,
  products, groups (name AND slug), orders, districts, saved_locations,
  facilities. Done via `rebuildForTenantUnique()` helper in `lib/db.ts`
  (create/copy/drop/rename dance, guarded on constraint text so it's
  idempotent across restarts).
- **Task 4 — DONE** (`9e201c4`): tenancy enforced at the `lib/session.ts`
  choke point rather than a repository layer (305 raw SQL call sites across
  70 files was judged too large a rewrite for this phase — deferred as a
  Postgres-migration prerequisite, not a tenancy prerequisite). New
  `orgFilter()` / `canReachOrg()` exports. Session token (`lib/auth.ts`,
  `app/api/login/route.ts`) now carries `oid` (organization id).
  **The single most important fix in this task:** owner-role filters
  (`groupFilter`, `entityGroupFilter`, `orderFilter`, `canReachGroup`) were
  changed from "restrict to my org's group ids" to "restrict to my org" —
  these are NOT equivalent when ungrouped/unterritorised rows exist, and the
  former silently hid data an owner used to see pre-tenancy. Full
  explanation in "Bugs found and fixed" below — read it before touching
  `lib/session.ts` again, the reasoning is non-obvious and easy to
  re-break.
- **Task 5 — DONE** (`fc857ab`), scope: the plan's version, "close the
  owner-unscoped readers." `readCatalogue`, `readPurchases`, `readRates`,
  `readDriverRates`, `readManagerOverrides`, `readGroups` each took no
  organisation and returned every tenant's rows. Each now takes a
  *required* `organizationId` (required, not optional-with-default, so a
  forgotten call site fails to compile). Call sites pull it from
  `session.organizationId`. `app/sales/orders/new/page.tsx` swapped its
  hand-rolled `AND group_id = ?` fragment for `groupFilter(session)`.
  Plan-doc drift: the rate readers live in `lib/commissionLedger.ts` /
  `driverCommissionLedger.ts` / `managerCommissionLedger.ts`, not the
  `lib/commission.ts` etc. the plan names.
- **Task 5b — DONE** (`6fd6c96`), the writer half from the old handoff:
  the 7 write paths that inserted rows with a NULL `organization_id` now
  stamp it. `createProduct`, `recordPurchase`, `createRun` take it as a
  *required* input field (like `CreateOrderInput`); the raw INSERTs in the
  districts / locations / facilities / location-convert API routes pull it
  from `session.organizationId`. **Also fixed a latent Task 3 bug it
  surfaced:** `POST /api/locations` and the location-convert route still
  had `ON CONFLICT(maps_url)` / `ON CONFLICT(customer_code)` — bare keys
  Task 3 replaced with `UNIQUE(organization_id, …)`. Both were 500ing
  against a migrated DB and no test caught it until `tests/tenancy-
  writers.test.ts`. If you add another per-tenant upsert, its ON CONFLICT
  target must be the composite key.

  Reference for the pattern (from earlier tasks): orders (`lib/orders.ts`,
  `CreateOrderInput.organization_id` required), groups
  (`app/api/admin/groups/route.ts`), lead_lists
  (`app/api/lead-lists/route.ts`), Excel importer (`lib/importExcel.ts`,
  pinned to `IMPORT_ORGANIZATION_ID = 1`).

- **Task 6 — DONE** (`6206da2`): `platform_access_log` table +
  `logPlatformAccess(db, session, path, organizationId)` in
  `lib/platformAccess.ts`. Writes one row only when a `platform_owner`
  reads an organisation that is not their own; never throws (a failed
  audit write is `console.error`'d, not fatal). **Per-endpoint wiring is
  deliberately deferred** — `requireRole` cannot know which tenant a
  handler will touch until it resolves the resource, so the
  `logPlatformAccess` call belongs at each cross-tenant read site and gets
  added as those support views are built. The table + mechanism + unit
  test exist now. `platform_access_log` is on the `tenancy-schema` exempt
  list (its `organization_id` is the tenant looked *at*, not an owner).
- **Task 7 — DONE** (`8b519c6`): the two-org leak suite.
  `tests/helpers/twoOrgs.ts` seeds two full companies with colliding
  natural keys (`SHARED-001`, `SHARED-SKU`, order `1001` in both);
  `tests/tenancy-isolation.test.ts` asserts neither owner's filters return
  the other's rows — generically over every `TENANT_TABLES` entry, so a
  new table without its `organization_id` column fails this build. Also
  verified against a copy of real pre-tenancy production data
  (`ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run
  tests/tenancy-schema.test.ts`): 141 customers / 45 orders / 70 order
  lines migrate clean, empty `foreign_key_check`, no NULL `organization_id`.

## Phase 0a is COMPLETE (2026-09-02)

All 7 tasks done on `phase-0-tenancy` (11 commits ahead of `main`), full
suite **87 files / 1120 tests green**. **Not merged, not deployed.**

## Phase 0b is COMPLETE (2026-09-02) — branch `phase-0b-foundations`

Off `crm-erp-master-plan` off `phase-0-tenancy`. 12 tasks (see
`docs/superpowers/plans/2026-09-02-phase-0b-foundations.md` and the spec
alongside it). Full suite **~98 files / ~1155 tests green**; migration
verified against the real 141-customer / 45-order backup (empty
`foreign_key_check`, lifecycle mapped, new tables present, `import_log`
gone). Highlights:

- **Excel customer import + delivery-parse subsystems removed entirely**
  (plan Risk 1). `customers` is app-owned now, no upstream. Build a run by
  `POST /api/sales/runs` then `POST /api/sales/runs/[id]/stops` until
  Phase 3. `exceljs` kept for order export.
- **`lib/repo/`** — `makeRepo(table, { tenant })` wraps `getDb().prepare`
  with a required `organizationId`. `tests/repo-boundary.test.ts` blocks
  new raw SQL in `app/`/`lib/` outside `lib/repo/`; ~69 grandfathered
  files on `tests/fixtures/raw-sql-allowlist.txt`, which **only shrinks**.
- **customers M2**: `customer_type`, `lifecycle` (enum, `status` dropped
  and mapped), `parent_customer_id`, `payment_terms_days`,
  `hard_credit_block`, `qualified_at`, `first_order_at`. Lifecycle behind
  `lib/repo/customers.ts` + `lib/customerLifecycle.ts` transition table;
  `PATCH /api/customers/[id]/lifecycle`; a control in `CustomerDetailPanel`.
- **Lead-pin fold-in**: pins in a `lead_list` become `customers`
  (`LEAD-<id>`, `lifecycle='lead'`); once, guarded on `app_meta`
  (`lead_pin_foldin_done`). 0 rows on the current backup.
- **`rep_manager` role** (roles.ts, create-user.mjs, `users.role` CHECK).
  Sees no group territory.
- **representatives**: `representative_profiles` (TENANT_TABLES) +
  `representative_onboarding_steps` (exempt, through the profile).
  `lib/repStages.ts` stage machine (`-> active` blocked until required
  steps ticked), `lib/repOnboarding.ts` step set, `lib/repo/
  representatives.ts`. `/api/admin/representatives` (+`[id]`) and
  `/sales/admin/representatives`, open to `owner` + `rep_manager`
  (`proxy.ts` widened for that one path).
- **`credit_approvals`** (TENANT_TABLES) — direct customers only
  (`requestApproval` refuses a rep customer). Table + `lib/repo/
  creditApprovals.ts` + `/api/admin/credit-approvals` (+`[id]/decide`).
  The auto `order -> PENDING_CREDIT` trigger is Phase 3.
- **demo purge**: `seed-demo.mjs` refuses `NODE_ENV=production` / a DB
  with real orders unless `--force`; `--remove` covers the new tables;
  seeds one `DEMO-REP-01`.
- **exempt list now**: `push_subscriptions`, `app_meta`,
  `representative_onboarding_steps`, `platform_access_log`, `sales`,
  `import_snapshots`? (no — dropped). `import_log`/`import_snapshots`
  removed from the list.

**Not merged, not deployed** — the whole stack (Phases 0a + master-plan
docs + 0b) merges and deploys together after Phase 10 (user decision).
Fresh backup first; the migration rebuilds `customers` and `users` in
place and drops two tables.

## Known environment issue

Full `npx eslint` OOM-kills (exit 137) in this sandbox from ~Task 8 on.
`npx eslint app/ lib/` passes, and every changed file lints clean when
named directly. `tsc` and the full vitest suite are the reliable gates.

## Bugs found and fixed this phase (read before touching `lib/session.ts` or `lib/db.ts` migrations)

1. **NULL ≠ NULL under SQLite UNIQUE semantics, twice.** Two rows with a
   NULL column never collide under a UNIQUE constraint containing that
   column. This bit us twice: (a) `seedFacilities()`'s `INSERT OR IGNORE`
   started creating duplicate rows once `organization_id` existed but was
   still NULL at seed time — fixed by explicitly stamping
   `organization_id: 1` in the seed. (b) The final backfill sweep at the
   end of the Task 2 migration crashed
   (`UNIQUE constraint failed: facilities.organization_id, facilities.slug`)
   trying to convert leftover NULL rows into ones that already existed
   post-seed — fixed by backfilling twice (early, right after the ALTER;
   late, as a safety net after all migrations run), not once.

2. **The "owner sees everything in my company" invariant.** Pre-tenancy,
   `owner` had no scoping at all. The naive tenancy fix — filter to
   `group_id IN (list of this org's group ids)` — looks equivalent to
   "filter by organization" but isn't: any row with `group_id = NULL`
   (ungrouped customers, shared/unterritorised locations, etc.) gets
   silently excluded. Found via `tests/api/lead-lists.test.ts`: a PATCH
   returned 200 but the resulting membership list came back empty, traced
   to `saved_locations` rows with `group_id = NULL` disappearing from
   `groupFilter`'s owner branch. Fixed by giving `owner` an
   organisation-only filter (`AND organization_id = ?`) in `groupFilter`,
   `entityGroupFilter`, and `orderFilter` alike — not a group-id list.
   `canReachGroup()`'s null-groupId case also had to become
   `session.role === "owner"` (was unconditionally `false` after the
   redefinition), or an owner would lose access to shared/ungrouped rows
   they could reach before tenancy existed at all.

3. **`createOrder()` had no `organization_id` field before Task 4.** Once
   `orderFilter`'s owner branch started requiring an `organization_id`
   match, every order ever created (all of them, pre-tenancy) would have
   vanished from its own owner's dashboard the moment this deployed — this
   would have been a real production incident, not a test failure, since
   the bug is silent (rows just don't show up, no error). Caught via
   cascading `tests/dashboard.test.ts` failures. Fixed by making
   `organization_id` a *required* field on `CreateOrderInput`, deliberately
   not optional, so a forgotten call site fails to compile instead of
   silently inserting NULL. **Apply the same trick in Task 5**: prefer
   required fields over optional ones with a default, anywhere a forgotten
   stamp would be silent-wrong rather than loud-wrong.

4. **The admin-groups duplicate-name check silently stopped working**
   because the real POST route never stamped `organization_id` on insert —
   caught by a test expecting 409 (duplicate) and getting 200. Same root
   cause as #3, different table.

5. **A migration verification instruction in the plan was wrong.** The plan
   said `ROUTEFLOW_DB_PATH=<path> npx vitest run tests/tenancy-*` would let
   you verify a migration against a copy of real production data, but
   `tests/tenancy-schema.test.ts` unconditionally overwrites
   `process.env.ROUTEFLOW_DB_PATH` before importing `lib/db`, silently
   discarding any externally-set value. Fixed by adding a dedicated
   `ROUTEFLOW_MIGRATION_CHECK_DB` env override read inside the test file
   itself, before the `lib/db` import. **Use this when verifying Tasks 5–7
   against real data too**:
   `ROUTEFLOW_MIGRATION_CHECK_DB=/path/to/db/copy npx vitest run tests/tenancy-*`
   — and always take the copy via the SQLite backup API
   (`sqlite3.connect().backup()`), never a plain `cp`, since the live db
   runs in WAL mode and a plain copy is silently stale.

6. **Task 3 left two `ON CONFLICT` clauses pointing at keys it had just
   deleted.** `rebuildForTenantUnique()` replaced `saved_locations`'s
   `UNIQUE(maps_url)` with `UNIQUE(organization_id, maps_url)` and
   `customers`'s `UNIQUE(customer_code)` with
   `UNIQUE(organization_id, customer_code)`, but the upserts in
   `POST /api/locations` and `app/api/locations/[id]/convert/route.ts`
   still said `ON CONFLICT(maps_url)` / `ON CONFLICT(customer_code)`.
   SQLite requires an `ON CONFLICT` target to name an actual constraint,
   so both routes threw
   `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`
   (a 500) against any migrated DB — and nothing caught it between Task 3
   and Task 5b because no test exercised those POST handlers post-migration.
   Fixed in `6fd6c96` by making both targets the composite key. Lesson: a
   `rebuildForTenantUnique` call has a blast radius beyond the schema —
   grep `ON CONFLICT` for the table whenever you change its unique keys.

## Architectural decisions locked for the whole RouteFlow project (from brainstorming, still binding)

- **Multi-tenancy: one shared SQLite database**, `organization_id` column
  on every business table, not one-database-per-tenant.
- **Role hierarchy**: `platform_owner` (new — sees every organisation, full
  cross-org access, every cross-tenant read gets logged once Task 6 lands)
  > `owner` (everything in their own org, no group restriction) >
  `group_manager` (one group) > `salesperson` (their own orders) > `driver`
  (their own runs). Representatives get their own manager role and a
  separate UI tab (not yet built — later phase).
- **Credit control**: warn, then require manager confirmation to proceed
  (not a hard block).
- **Scale is real**: 200+ orders/day in the largest existing group, multiple
  groups, rapid growth expected. This is why the 12-state order machine,
  route optimisation/VRP, and batch/lot traceability are all **in scope**,
  not deferred as YAGNI — that was the correction from a first plan draft
  that assumed a much smaller operation.
- **Storage**: staying on SQLite for now, not moving to Postgres yet — user
  said "I will change to it later." Instead, the architecture goes
  **offline-first**: UI shows a task as completed immediately, sync happens
  in the background. The governing rule for what's safe to do this way:
  a write is safe offline if it *records a fact* ("I delivered X") — facts
  sync later, no conflict possible. A write is unsafe offline if it
  *claims a shared resource* ("reserve this stock") — claims need server
  arbitration and can't be resolved locally. This rule needs to be applied
  when designing the order pipeline and stock/batch phases.
- **`Delivery` is its own entity**, distinct from `delivery_stops` (a
  delivery_run has many stops; a stop can span multiple deliveries, or
  something in that shape — re-derive the exact relationship when that
  phase starts, don't assume from this memory).
- **New features requested, not yet built**: weather-aware capacity
  planning for route scheduling (should reduce stops-per-driver for *any*
  bad weather affecting a route, not just literal snow/rain at the depot —
  user asked me to think about this more before implementing), a per-role
  daily briefing screen, a sales-education/academy section.
- **Undo bar — DONE**, shipped independently of everything else in
  `14d1206`: `lib/countdown.ts` (pure, testable, `requestAnimationFrame`-
  driven, renders via `scaleX()` transform never `width`, per `MASTER.md`'s
  layout-thrashing rule), `ACTION_LIFETIME_MS = 9000` exported from
  `components/ToastProvider.tsx` — reuse this constant as the offline
  outbox hold time once that phase starts, that's why it's exported rather
  than inlined.

## Full 10-phase plan — SUPERSEDED by `docs/crm-erp-plan.md` Part 5

The recollection below is kept only as a diff against the real doc. **Use
`docs/crm-erp-plan.md` Part 5 "Build order" as the authority.** It agrees
with this recollection on the sequence:

Phase 0 Foundations (repo layer · M1 tenancy `[0a DONE]` · platform_owner
+ access log `[DONE]` · M2 customers/reps/credit `[0b, not started]` ·
demo-data purge `[0b]`) → 1 Money (payments/allocations/cheques,
credit-approval workflow, derived debt ageing) → 2 Stock + batches (FEFO,
expiry, forward/backward trace, complaints) → 3 Order pipeline (12-state
machine, `deliveries` entity, reason codes, samples) → 4 Offline-first
(`client_uuid` + `sync_mutations` + tombstones, IndexedDB outbox, sync
engine, undo bar wired to outbox hold, conflict surface) → 5 Routing
(vehicles/templates/schedules, OSRM+VROOM, planner UI, route freeze) →
6 Weather (Open-Meteo, `capacity_factors`, weather-adjusted VROOM input,
map layer) → 7 Spine + briefing (`events`/`tasks`/`alerts`/`rules` with
cooldown+escalation, `/today` for six roles) → 8 Reps + academy → 9
Analysis (why-drilldown, health scores, contribution margin, Action
Center, precomputed KPI snapshots) → 10 Prediction.

Merge/deploy of the whole `phase-0-tenancy` branch is deferred until
after Phase 10 (user decision, 2026-09-02).

## Session/config state (2026-09-02)

- All plugins disabled except `superpowers` in `/root/.claude/settings.json`
  — done specifically to cut per-turn token overhead for the remaining
  RouteFlow phases (this was user-requested: *"disable all the plugins you
  do not need for these 10 phases"*). Kept `superpowers` on because it
  drives `writing-plans` / `executing-plans` / TDD, used constantly here.
  Disabled: `claude-code-setup`, `frontend-design` (re-enable once UI
  phases 5–9 start), `context7`, `code-review`, `claude-md-management`,
  `memsearch`. This takes effect on the **next fresh session start**, not
  retroactively in a resumed one.
- `effortLevel` was previously dropped from `xhigh` to `high` in an earlier
  session (2026-09-01 23:29) specifically to cut tool-call volume.
- `/root/.claude/CLAUDE.md` has a "Context hygiene" section (added
  2026-09-01) covering screenshot handling
  (`python3 /root/.claude/shrink-shot.py <img>`) and `/clear` discipline —
  still in effect, applies to this project like any other.
- **To actually save tokens continuing this work: start a brand-new
  conversation** (not `--resume`) and hand it this file. A resumed session
  replays the old context regardless of what's disabled in settings.

## How to resume

1. In a new conversation, in `/root/pourya/RouteFlow`, confirm you're on
   `phase-0-tenancy` and pull this file up
   (`docs/HANDOFF-2026-09-02-tenancy.md`).
2. Run `npx vitest run` once to confirm still green before touching
   anything.
3. Use `superpowers:executing-plans` (or `subagent-driven-development` if
   subagents are available in that session) against
   `docs/superpowers/plans/2026-09-01-phase-0a-tenancy-foundation.md`,
   starting at Task 5.
4. After Task 5, decide with the user whether to keep going into Tasks 6–7
   inline or pause for review — Tasks 1–4 were done inline without
   per-task check-ins, which worked, but Tasks 5–7 touch more call sites
   (7+ write paths) so a quick diff review before continuing might be worth
   proposing.
