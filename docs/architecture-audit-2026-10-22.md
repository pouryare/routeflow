# Architecture audit, Phase 1 (baseline inventory)

_2026-10-22. Read-only: no source code was changed. Tools (madge, knip, jscpd, tsc, eslint) were run from outside the repo; nothing was added to `package.json`._

Scope: `app/` (279 files, 18.8k lines), `lib/` (338, 48.0k), `components/` (265, 36.1k), `scripts/`, `tests/` (547 files, 61k lines). 158 API routes, 55 pages, 79 files in `lib/repo/`.

## What is already healthy (checked, not assumed)
- `tsc --noEmit` (after `next typegen`) and `eslint --quiet`: zero errors.
- Exact duplication is low: jscpd found 14 clones, 0.24 % of lines.
- Every API route except 5 calls `requireRole(...)` (212 calls). The 5 exceptions are `login`, `logout` and three sweep routes that use a shared `sweepAuth` token-or-manager check, so they are deliberate.
- No client component imports a server module as a value (only types), so the server/client boundary holds.
- Empty `catch {}` blocks: 7, all around `localStorage` or inline theme scripts (benign). No `@ts-ignore`; 6 `any`; 0 TODO/FIXME; 1 `console.log`.
- Mobile rules are enforced by a script (`check:mobile`), and there is a large test suite.

## Findings, by severity

### A. Structural risks (fix the shape before the content)
| # | Finding | Evidence |
|---|---|---|
| A1 | **`lib/db.ts` is a 5,840-line god module.** `getDb()` alone is ~2,800 lines (L1437–4904): all `CREATE TABLE`, 72 `ALTER TABLE`, backfills and seeds run inline on first connection. There is no schema version table (`user_version` is not used); migrations are "idempotent on every boot". Row types (`Customer`, `UserRow`, …) live in the same file, so everything imports it. | `grep -c` of CREATE/ALTER; function length rule |
| A2 | **Tenant isolation is by convention, not by construction.** 64 tables are tenant tables, but every query must remember its own `organization_id` filter; there is no central scoped-query layer. A heuristic scan flagged 107 statements on tenant tables that mention no `organization_id` (e.g. in `lib/dashboard.ts`, `lib/repo/syncPull.ts`, `lib/repo/reports.ts`, `lib/delivery.ts`, `lib/orders.ts`, `lib/purchases.ts`). Sampled ones were id lookups or joins through a scoped parent, so this is **not** a confirmed leak list; each needs a human read. | scan script; 8 statements sampled |
| A3 | **Data access is spread across layers.** `getDb()` is imported directly by 61 API routes, 27 shell pages, and 9 components (`CoverageMap`, `MapLoader`, dashboard/analytics sections), as well as by `lib/repo/` (52). `lib/` also holds query code outside `lib/repo/` (`delivery.ts`, `orders.ts`, `purchases.ts`, `dashboard.ts`). Two data-access homes. | import counts |
| A4 | **15 circular imports** (madge; some may be type-only): `lib/db.ts ↔ lib/repo/ledger.ts`, `repo/events ↔ rules ↔ tasks` (3 cycles), `lib/catalogue.ts ↔ repo/productCosts.ts`, `FilterChips ↔ FilterSheet`, `OrderPipeline ↔ ProcessingModal`, and `PoolViewWrapper` ↔ each of 8 `PoolView*` files (a registry pattern). The `db ↔ ledger` and `events/rules/tasks` ones are real runtime risks (load-order bugs). | `madge --circular` |

### B. Oversized units
- 36 functions with cyclomatic complexity > 25; worst: `CoverageMap` (126), `getDb` (122), `crm/fields.ts` (78), `syncMutations.ts:272` (76), `crm/write.ts` (66 and 62), `delivery.ts:366` (62), `admin/users/[id]/route.ts` (61), `sales/orders/route.ts` (48).
- 96 functions over 150 lines. Largest: `getDb` 2,795, `CoverageMap` 1,731, planner page 867, `PaymentsPanel` 583, `SearchBox` 450.
- Pages that hold hundreds of lines of query + layout together: `planner/page.tsx` (1,177), `facilities/page.tsx`, `sales/admin/users/page.tsx`, `report/page.tsx`.

### C. Dead and stray code (knip, needs a human yes/no on each)
- **Agent tooling committed to the repo:** `.zoocode/` (2.5 MB, 24 archive files + MCP config), `.zoocodeules/` (4.2 MB, 127 workflow files incl. JS/TS helpers), `superpowers-cline/`. 150+ files of another tool's workspace, with `.mjs/.cjs/.ts` files that knip counts as unused.
- **Unused source files (5):** `components/charts/LineChart.tsx`, `LinePlot.tsx`, `StatCard.tsx`, `components/sales/RunTimeline.tsx`, `lib/orderViews.ts`.
- **Unused exports 86, unused exported types 50, duplicate exports 2** (`CardHelp` named + default, `THEME_KEY/SKIN_KEY`). Many are constants kept "for tests/docs"; list in the knip run below.
- **Unused devDependencies:** `@tmcw/togeojson`, `@types/geojson`, `@vitejs/plugin-react`, `@xmldom/xmldom` (knip; one may be used by a script outside its entry list, so verify).
- **Scripts:** 17 scripts unreferenced by `package.json` (seed/backfill/one-off tools, `backup.mjs`, `run-sweeps.mjs`, `telegram-poll.ts`). Some are operational (cron) and must stay; the one-offs (`assign-district-codes`, `backfill-districts`, `seed-*`, `split-districts`) are candidates to archive.

### D. Parallel implementations / drift (candidates, not yet proven duplicate)
- Commission logic in 7 files: `commission.ts`, `commissionLedger.ts` (359), `driverCommission(.ts/Ledger)`, `managerCommissionLedger.ts`, `repo/commissionRates.ts`, `repo/commissionTiers.ts`. Ledger siblings likely share a skeleton.
- Maps: `CoverageMap` (2,555), `LeadsMap`, `ImportMap`, `PlannerPickMap`, `PlannerRouteMap`, `MapWorklist`, plus `VectorBasemap`, `LayersPanel`, `LocateControl`. Each sets up its own Leaflet/MapLibre base.
- Role checks: 50 raw `role ===` / `ROLES.includes` comparisons in `app/api` and `lib/repo` next to 212 `requireRole(...)` calls. Role sets such as `PIN_POOL_ROLES` are also defined ad hoc.
- Documentation sprawl: 138 tracked files under `docs/`, 59 plan files under `docs/superpowers/plans`, 12 `HANDOFF-*` docs, plus root `MASTER.md` (773 lines), `implementation_plan.md` (357), `AUDIT-2026-10-20.md`, `logo-concepts-summary.md`. Older ones are likely stale against the code.

### E. Test gaps on critical paths
Files in `lib/repo/` with no test mentioning them by name: `commissionRates`, `orderLines`, `organizations`, `productCosts`, `userOrg`, `base`, `crm/state`, `crm/http`, `leadImportNotify`. (Name matching only; some are covered indirectly by route-level tests.) There is no test that asserts every tenant query is org-scoped (see A2).

## Phase 2–4 roadmap (proposed; nothing started)

Principle: each step is its own commit, behaviour-preserving, full `vitest` + `typecheck` + `check:mobile` green before the next.

**Step 0: Guardrails first (Phase 4 pulled forward, ~1 day).** Add (a) a tenancy test: run every API route/repo function as org A against org B's ids and assert 404/empty; (b) a schema snapshot test (`sqlite_master` dump) so the db.ts split can be proven byte-identical; (c) cover the untested repo files in section E; (d) add `madge --circular` and `knip` as non-blocking CI reports, with a ratchet baseline like `audit:mobile`.

**Step 1: Housekeeping, zero behaviour change (~½ day).** Remove `.zoocode/`, `.zoocodeules/`, `superpowers-cline/` from git (add to `.gitignore`); delete the 5 dead files and 4 unused devDependencies after one confirmation pass; move one-off scripts to `scripts/archive/`; fold stale HANDOFF/plan docs into an `docs/archive/` folder with an index.

**Step 2: Stabilise contracts (Phase 2, ~2–3 days).** Move row types out of `lib/db.ts` into `lib/types/` (re-export from `db.ts` so imports keep working); break the real cycles (`db ↔ ledger`, `events ↔ rules ↔ tasks`, `catalogue ↔ productCosts`) by extracting shared types/constants; define one `Scope` (`organizationId`, `groupId`, role) type used by every repo function.

**Step 3: Split `lib/db.ts` (~3–4 days, highest value).** Extract to `lib/db/`: `connection.ts` (PRAGMAs, slow-SQL), `schema/*.sql.ts` per domain, `migrations.ts` with a `PRAGMA user_version` runner, `backfills.ts`. `getDb()` keeps its signature. Verify with the Step 0 schema snapshot on a fresh DB and on a copy of the demo DB.

**Step 4: Enforce one data-access layer (~3 days, module by module).** Order: dashboard → delivery/orders/purchases → pages that call `getDb()` directly → components. Each module moves its SQL to `lib/repo/`, takes a `Scope`, and gets its org filter in one place. This closes A2/A3 and gives the tenancy test real coverage.

**Step 5: Decompose the oversized units (Phase 3, one module per PR-sized commit).** Order by risk × size: `syncMutations`, `crm/write`+`fields`, `delivery.ts:366`, `admin/users/[id]` and `sales/orders` routes (extract validation vs persistence), then components: `CoverageMap` into layers/controls/hooks, planner page into data + view, `PaymentsPanel`, `SearchBox`.

**Step 6: Consolidate the parallel families (after the above).** Commission ledgers onto one base; map pages onto a shared base-map component; role sets into `lib/roles` constants with a lint rule against raw `role ===`.

**Step 7: Ratchet.** Turn the Step 0 reports into blocking checks at today's numbers so they can only go down (max function length, cycles, `getDb` import sites, unused exports).

## Not verified in this pass
- Whether any of the 107 un-scoped tenant statements is a real cross-tenant read (needs a line-by-line read or the Step 0 test).
- Whether the 15 cycles are type-only (madge reports 31 warnings; bundler ordering was not exercised).
- Knip results exclude dynamic imports and string-built paths; "unused" means "no static reference".
- Semgrep/CodeQL were not run (Semgrep failed earlier here; CodeQL needs a build database). Third-party *skills* were not installed: the npm analysers were enough for an inventory, and I do not run unreviewed skill scripts in this repo.
