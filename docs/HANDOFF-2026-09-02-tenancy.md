# RouteFlow handoff — 2026-09-02, mid Phase 0a (tenancy foundation)

Read this first in a fresh conversation. It replaces the need to re-derive
anything from chat history. Repo: `github.com/pouryare/routeflow` (renamed
from coverage-map on 2026-09-01). Working dir: `/root/pourya/coverage-map`.
Branch: `phase-0-tenancy` (not merged to `main`).

## ⚠️ Known gap: two planning docs were lost, never actually saved to disk

Earlier in this project I produced (in conversation only, describing them as
written) two documents that were supposed to live at:
- `docs/crm-erp-plan.md` — the full 10-phase RouteFlow plan (money/payments,
  stock/batches, order pipeline, offline-first, routing/VROOM, weather,
  spine/briefing, reps/academy, analysis, prediction)
- `docs/crm-erp-source-extract.md` — facts/proposals/gaps extracted from the
  original ChatGPT brainstorm

**Neither file exists on disk or anywhere in git history (checked `git log
--all` across every branch).** They were likely described as written in a
prior summarized conversation turn but the `Write` call never actually
landed, or landed and was lost before a commit. Do not assume their content
is recoverable. The only surviving record of what was in them is the
"Full 10-phase plan (reconstructed from memory)" section below, which is
a compressed recollection, not the original text — it is good enough to
resume work from, but treat specifics (exact table names, exact API shapes)
as needing re-derivation, not as settled fact.

**First real task for the next conversation, if the 10-phase plan matters
before Phase 0a is finished:** decide whether to reconstruct
`docs/crm-erp-plan.md` properly (re-run the brainstorming skill against the
summary below) or just proceed phase-by-phase without a master doc. I'd
lean toward reconstructing it once Phase 0a is done, not before — the
tenancy foundation is infrastructure every later phase depends on, so it's
the right thing to finish first regardless.

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
suite **87 files / 1120 tests green**. **Not merged, not deployed** — that
is a deliberate separate step (fresh backup first; the migration rebuilds
six tables in place). Next decisions: (1) merge/deploy Phase 0a, (2) the
`docs/crm-erp-plan.md` reconstruction question below, (3) Phase 0b.

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
   said `COVERAGE_DB_PATH=<path> npx vitest run tests/tenancy-*` would let
   you verify a migration against a copy of real production data, but
   `tests/tenancy-schema.test.ts` unconditionally overwrites
   `process.env.COVERAGE_DB_PATH` before importing `lib/db`, silently
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

## Full 10-phase plan (reconstructed from memory — see the warning at top of this file)

Order was: Phase 1 money/payments, Phase 2 stock/batches & traceability,
Phase 3 order pipeline (12-state machine), Phase 4 offline-first (defines
safe/unsafe mutation rules, see above), Phase 5 routing/VROOM +
route optimisation, Phase 6 weather → capacity, Phase 7 spine/briefing
screen, Phase 8 representatives + academy, Phase 9 analysis/reporting,
Phase 10 prediction. Phase 0a (tenancy, this doc) and Phase 0b (customer
type/lifecycle, representative profiles, credit approval workflow, demo-
data purge) come before all of them. Treat this ordering as a starting
point to re-validate with the user, not a committed sequence — it was
never re-confirmed after the offline-first pivot in message 4 of the
original planning conversation.

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

1. In a new conversation, in `/root/pourya/coverage-map`, confirm you're on
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
