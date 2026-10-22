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

---

# Step 1.B: Trail of Bits scan and the guardrails (added 2026-10-22, later the same day)

## What ran

Source: [trailofbits/skills](https://github.com/trailofbits/skills), cloned read-only into a scratch directory and read before use; nothing from it was added to this repo. Where a skill's own script exists it was used; where the skill is a method it was followed by hand (this session cannot install a plugin).

| Skill | How it ran | Result |
|---|---|---|
| `static-analysis/semgrep` | its `run-scans.sh`, Semgrep 1.182.1 via `uv`, `--metrics=off`, OSS engine (no Pro licence, so no cross-file taint). 10 scans, 0 failed: `p/security-audit`, `p/secrets`, `p/javascript`, `p/typescript`, `p/react`, `p/nodejs`, `p/github-actions`, plus Trail of Bits' and elttam's rule repos, over 1,241 files | 3 findings in total, none in app code (below). `p/nextjs` matched 0 files: the skill reports it under `coveredNothing`. |
| `static-analysis/codeql` | **could not run**: the CodeQL bundle is a GitHub release download and the sandbox proxy answers 403 for it | not covered |
| `variant-analysis` | method followed by hand from the known cross-tenant read | 8 more real instances (below) |
| `insecure-defaults` | its seed patterns grepped over `app/ lib/ components/ scripts/ deploy/`, each hit read | no fail-open defaults (details below) |
| `sharp-edges` | JavaScript/auth checklist applied to the login, session, upload, fetch and HTML-injection surfaces | 3 findings (below) |
| `supply-chain-risk-auditor` | its `collect.py` + `render.py` over `package.json` and `package-lock.json` | no advisory on any of 39 direct dependencies; 2 transitive build-time-only advisories (`braces`, `vite`); repository-archive and maintenance criteria not assessable (GitHub API blocked) |
| `agentic-actions-auditor` | not applicable: `.github/workflows/ci.yml` runs no AI agent action | n/a |
| `entry-point-analyzer`, `building-secure-contracts`, `c-review`, `rust-review`, and the rest | not applicable to a TypeScript web app | n/a |

## Semgrep: the three findings
1. `.zoocodeules/workflows/webapp-testing/scripts/with_server.py:71`: `subprocess.Popen(..., shell=True)` in the committed agent-tool folder (not app code; goes away with that folder in step 2).
2. and 3. `.github/workflows/ci.yml:21,24`: `actions/checkout@v4` and `actions/setup-node@v4` use mutable tags. Informational; pin to commit SHAs when convenient.

The scanner finding almost nothing in 938 TypeScript files is itself a result: this codebase's real defects are authorisation logic (who may see whose rows), which pattern matchers cannot see.

## Cross-tenant reads: found, fixed, and now guarded
The new guardrail `tests/tenancy-routes.test.ts` calls every exported handler of all 158 routes as the owner of organisation A with organisation B's ids, and a second pass with no cookie. Its first run found four routes; variant analysis (`scripts/check-architecture.mjs` lists the remaining candidates) found four more. All eight are fixed, each with a test that fails on the old code.

| # | Where | What leaked or broke | Severity |
|---|---|---|---|
| 1 | `GET /api/admin/groups` | every tenant's group names and member counts | medium |
| 2 | `GET /api/admin/impersonatable` | every active user of every tenant (names, roles, organisation) to any owner | medium |
| 3 | `GET /api/sales/stock`, انبار page, dashboard stock section | other tenants' products, stock levels and average cost | medium |
| 4 | `GET /api/sales/commission`, commission page, dashboard money section | other tenants' managers' commission statements; sellers' and drivers' too (the fixture had none, so the guardrail fixture now has them) | high (money) |
| 5 | `/map` page, `readLeadPins` | every tenant's lead pins (name and coordinates) wherever they fell inside a visible district | medium |
| 6 | انبار page header | this month's purchase count and value summed across tenants | low-medium |
| 7 | `groupForPoint`, `recomputeCustomerGroups` | a customer of tenant B standing in a district tenant A claimed was assigned A's group (so A's manager saw B's customer), and any tenant's territory edit regrouped every tenant's customers | high (cross-tenant write) |
| 8 | `DELETE /api/facilities/[id]` | the "cannot delete the last facility" guard counted every tenant's facilities | low |

Root cause: tenancy is enforced by each query remembering `organization_id`; `orgFilter` existed in `lib/session.ts` but nothing used it. The fix makes the organisation a **required parameter** (`orgClause` in `lib/orgScope.ts`, `orgScopeId(session)` gives `null` only for a platform_owner), so forgetting it is now a type error. Districts are shared geography but each is claimed by one group of one organisation, which is a modelling limit worth revisiting in step 4 (two companies cannot both hold the same district).

Remaining candidates, reviewed and left: the four `COUNT(*)/MAX(updated_at)` cache fingerprints in the customers, facilities, locations and payments GET routes (another tenant's activity invalidates this tenant's ETag; no content leaks), and `SELECT * FROM commission_rates` in the three statement functions (rows are matched by salesperson, so other tenants' rows are never used; worth scoping in step 4).

## Other findings from the skills
| Severity | Finding | Status |
|---|---|---|
| medium | **Server-side request forgery in the maps-link importer.** `lib/resolveMapsLink.ts` allow-lists only the FIRST host. Later redirect hops are checked only by `isPrivateOrLocalHost`, a string test that misses `::ffff:7f00:1` and DNS names that resolve to private addresses; and `lib/playwrightExtract.ts` drives Chromium with `page.goto(url)` and **no request interception**, so a redirect from an allow-listed host (an open redirect on one of those domains) sends the server's browser anywhere, internal network included. Needs an authenticated user and an open redirect on an allowed domain. | **fixed**: every redirect hop (fetch path and browser) must be on the allow-list and not an internal address; the private-address test now covers IPv4-mapped IPv6, CGNAT, single-label and `.local/.internal` names; the browser runs behind a request guard that fetches each navigation without following redirects and re-vets every hop (Chromium does not re-call a route handler for the target of a redirect it follows itself, which the first version of the guard missed; caught by the real-browser test). Tests: `tests/ssrf-guard.test.ts` (incl. a real Chromium against real servers, skipped where none is installed), `tests/ssrf-hops.test.ts`. |
| low-medium | **Login timing reveals which usernames exist**: an unknown or deactivated account skipped the password hash, so it answered in microseconds while a real account took tens of ms, defeating the identical error message. | **fixed** in `app/api/login/route.ts` (every refusal pays one scrypt), tested. |
| low | `SESSION_SECRET` is accepted at any length (the code only rejects an unset value). | **fixed as a warning**: production logs a loud `[security]` error at startup when the secret is shorter than 32 characters (`weakSecretReason`); it does not refuse to start, because that would lock everyone out of a deployment whose secret predates the rule. Set a 32+ character secret (`openssl rand -hex 32`), then it can be made a hard stop. |
| low | `slow-import` notice: `maybeNotifySlowJob` inserted an events row without the NOT NULL `created_at`, so the first poll after 60 s of an import returned HTTP 500 and the notice was lost; **fixed**. Separately, `recipientsFor` had no branch for `lead_import.slow`, so it reached nobody. | **fixed**: the crash, and the notice now goes to the person who pasted the links (`lead_import_jobs.created_by`, new column; jobs created before it existed have nobody to tell). |
| low | A fresh database lacks three indexes that the second boot creates (`idx_facilities_kind`, `idx_purchases_date`, `idx_saved_locations_name`): a later rebuild migration drops them. | **fixed** (step 3): the table-rebuild helpers now recreate a table's indexes after `DROP TABLE` took them (`indexStatementsOf` in `lib/database/rebuilds.ts`); `FIRST_BOOT_MISSING` in `tests/schema-snapshot.test.ts` is empty and stays a ratchet. |

Checked and fine (not assumed): `SESSION_SECRET` fails closed when unset; session tokens are HMAC-SHA256, verified with `timingSafeEqual` before the JSON is parsed, with a server-side `token_version` for revocation; passwords use scrypt with a per-user salt; no `eval`, `child_process`, or `new RegExp(userInput)`; every `dangerouslySetInnerHTML` renders a fixed lookup table keyed by an allow-listed `icon_key`; the cookie is `httpOnly`, `sameSite=lax`, `secure` in production; photo and avatar file names are generated server-side. The only default secrets are in demo/preview/CI scripts and are labelled "not for production".

## Guardrails now in the repo (step 1)
- `tests/tenancy-routes.test.ts`: cross-tenant and anonymous probe over every route (picks up new routes by directory walk; `KNOWN_LEAKS` and `PUBLIC_BY_DESIGN` are explicit, empty or reasoned, and ratchet both ways).
- `tests/tenancy-owner-readers.test.ts`, `tests/tenancy-variants.test.ts`: the readers server components call directly.
- `tests/schema-snapshot.test.ts` + `tests/__snapshots__/`: the schema and seeded row counts a fresh `getDb()` builds, and a second-boot idempotence check. This is the proof obligation for splitting `lib/db.ts`.
- `tests/repo-small-modules.test.ts`: the nine `lib/repo` modules that had no test.
- `scripts/check-architecture.mjs` (`npm run check:architecture`, in CI): import cycles (value imports), direct `getDb` imports in routes and pages, `lib/db.ts` size, unscoped-looking tenant SELECTs, tracked agent-tool files. Baseline in `docs/architecture-baseline.json`; each number may only fall.


---

# Steps 2 and 3: housekeeping and the split of `lib/db.ts` (2026-10-22, PR #44)

## Step 2: housekeeping (done)
- Removed another AI tool's committed workspace (`.zoocode`, `.zoocodeules`, `superpowers-cline`: 166 files, including a copy of the production database); gitignored. History still holds it, see the open item below.
- Deleted 5 unreferenced source files and 2 unused dev dependencies; archived two finished planning notes under `docs/archive/` (with an index).
- **Not done on purpose:** moving the "unreferenced" scripts and the `HANDOFF-*` docs. knip only knew they are not in `package.json`; tests, the README and other documents reference them, so moving them would break links for no gain.

## Step 3: `lib/db.ts` 5,848 → 148 lines (done)
`lib/db.ts` still exports everything it did (no import site changed). The code lives in `lib/database/`:

| File | What |
|---|---|
| `schema.ts` | the 1,850-line `CREATE ... IF NOT EXISTS` block, verbatim |
| `migrate.ts` + `migrations/01..07` | the ordered migration eras (early columns; tenancy bootstrap; CRM and tenant columns; tenant-unique rebuilds; territory, orders, customers; notifications, roles, seeds; ledgers and late columns) |
| `rebuilds.ts`, `backfills.ts`, `seeds.ts` | the helper functions and seed data that used to sit around `getDb()` |
| `tenantTables.ts`, `types.ts` | the tenant table list and the row/domain types |

How it was proven to change nothing: the fresh-database schema and seeded-row-count snapshots are unchanged by the move; the second-boot check holds; and a database built by the OLD code and opened by the NEW code ended with a schema and row counts identical to the old code's own second boot. Four guard tests that read the schema code as text were taught the new layout (`tests/helpers/dbLayerSource.ts`).

The directory is `lib/database/`, not `lib/db/`: a `lib/db.ts` beside a `lib/db/` made Node's own ESM resolver (used by the seed and ts-hook scripts) fail with a directory import. The test suite caught it.

Import cycles: 4 → 1. Broken: `lib/db.ts` ↔ `lib/repo/ledger.ts` (a connection-free `ledgerCore.ts`), `FilterChips` ↔ `FilterSheet` (a shared `ChipGroup.tsx`), `PoolViewCompact` ↔ `PoolViewWrapper` (a type imported as a value). **Left on purpose:** `events` ↔ `rules` ↔ `tasks`: emitting an event runs the rules, rules emit events and create tasks, tasks emit events. Breaking it with a late-bound hook could silently stop rules firing in a process that never loaded the rules module, and the ratchet holds it at 1.

## Open
- **A copy of the production database is in git history** (`.zoocode/mcp/routeflow-mcp.db`, 2 MB, committed 2026-10-21; its refresh script says it is copied from the live database). Removing it from the tree does not remove it from history. I did not open it (reading customer data was out of scope). Decision for you: if this repository is private and only you can read it, that may be acceptable; if not, the file needs purging from history (a history rewrite, which is yours to authorise) and the exposed credentials, if any, rotating.


---

# Step 4 (in progress) and the founder's full-access decision (2026-10-22)

## Decisions recorded
- **Production-database copy in git history:** the repository is private, so the history is left as it is.
- **Full access for the founder:** the account that holds `platform_owner` can read and write everything of every company. It is one account; two- or three-step login for it is planned (parked idea F106). Because it can read every customer's data, that login hardening is the main protection to add next.

## How full access works now
`platform_owner` already existed (a superset of `owner`, cross-company reads through the scope helpers, Login-As into anyone, an audit table `platform_access_log`). Two gaps were closed:
1. **Acting company.** On the switch page (`/switch`) the founder can pick «همهٔ سازمان‌ها» (default: everything at once) or one company. Acting in a company makes the session behave as that company's **owner**, for reads and writes: `session.organizationId` is the company's and every scope helper (`scopeGroupIds`, `orderFilter`, `canReach*`, ...) goes through `scopeView(session)`. Everything that reads `session.organizationId` directly (catalogue, stock, new records) therefore works for the chosen company with no per-screen change.
2. **Safety rails.** The choice is a signed claim (`ao`) in the session token, re-validated on every request (the company must exist and be active; the account's active role must be `platform_owner`; Login-As sessions ignore it). Only a real `platform_owner` session can switch (`POST /api/admin/acting-org`); each switch into another company is written to `platform_access_log`. A banner on every page names the company while it is chosen, and cannot be dismissed.

Creating records while «همهٔ سازمان‌ها» is selected puts them in the account's home company; choose a company first to create elsewhere.

## Step 4: one data-access layer (88 → 65 route/page files that open the database)
Done: dashboard (`lib/repo/dashboardView.ts`), sales home, products page (`productsView.ts`), orders pages (`ordersView.ts`), commission page and API (`commissionView.ts`), customers/catalogue reads (`sessionReads.ts`), nine no-op `getDb()` calls. Each function takes the session; pages and components never see a connection.
Leaks found and fixed on the way: the products page's price history listed every company's price changes; the commission page's seller, driver and manager pickers listed every company's staff; the "last owner" guard counted other companies' owners. The ratchet now also watches unscoped `FROM users`.
Remaining: report, schedule, stock, map, the two driver pages, and the 59 API routes. The API routes hold most of the inline SQL and should be done by domain, each with a repo module and tests.

## Step 4 (finished) and the founder's second login step (2026-10-22)

- No file under `app/` or `components/` imports `getDb` (a test now fails if one does) and none contains raw SQL; routes and pages call named operations in `lib/repo/` (`routeAdapters.ts` holds the thin wrappers for readers that take an explicit handle).
- The write probe was strengthened until it found real holes, all fixed with tests: admin groups, facilities, districts (DELETE had no guard), lead lists, saved pins, visit plans, prices/packagings/thresholds, commission rates/payments/overrides, run stops, order customer/products/seller, group assignment on users, lead visit read, the month plan's visits, legacy `sales` history, avatars, offline order mutations.
- Founder second step: authenticator-app code (RFC 6238, no dependency) after the password; secret encrypted at rest; each time step usable once; recovery codes; `/switch` enrols; `scripts/disable-second-factor.mjs` is the shell way back. It is optional until the founder turns it on (forcing it risks lock-out).
- Step 5 done so far: `admin/users/[id]` PATCH validation extracted to `lib/userPatchPlan.ts`. NOT done: `syncMutations`, `crm/write`+`fields`, `delivery.ts`, `sales/orders` POST, and the components (`CoverageMap`, planner, `PaymentsPanel`, `SearchBox`).
- Step 6 NOT done (commission ledger base, shared map base, role-set constants + lint rule).
- Step 7 partly: `getDb` import sites are a hard zero; the ratchet and raw-SQL boundary already block regressions. Max-function-length and unused-export checks are not added.

## Steps 5-7 finished (2026-10-22, third pass)
Behaviour-preserving, one module per commit, existing tests as the net (source-text guards repointed where the code moved):
- `lib/delivery.ts` `recordDelivery`: six named steps (van debit, order machine, door payment, stock draw, revenue, delivery entity) over a shared `DoorContext`.
- `lib/repo/syncMutations.ts` `applyOne`: one handler per offline operation, dispatched from a table; customer capture now refuses a foreign group.
- `lib/repo/crm/fields.ts`: business-field validation split per field group (`parseBusinessFields`); `lib/repo/crm/write.ts` `applyFlowCore`: contact resolution and customer updates are named steps.
- `lib/orderRequest.ts`, `lib/userPatchPlan.ts`: request validation apart from HTTP handling.
- Components: `CoverageMap` view store, map ink and map parts moved to `components/coverage/`; `SearchBox` storage/geocoder helpers to `components/searchbox/`; `PaymentsPanel` arithmetic to `lib/paymentsView.ts`; planner page helpers to `lib/plannerView.ts` and `components/planner/RestockHint.tsx`. The big component functions themselves (CoverageMap 2,158 lines, PlannerPage 1,019, PaymentsPanel 580, SearchBox 532) are still single functions: splitting their hook bodies needs browser checks that were not possible here.
- Step 6: the three commission payment inserts and the driver/manager dated-rate inserts share `lib/repo/commissionPayments.ts`; `QuietTileLayer` is shared by the leads, planner and import maps; `isOwner` replaces the owner-or-platform_owner comparisons.
- Step 7: the ratchet now also blocks growth in raw role comparisons (57), functions over 150 lines (73) and unused exports (223, via knip, now a devDependency).
