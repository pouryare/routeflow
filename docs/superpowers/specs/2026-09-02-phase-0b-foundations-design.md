# RouteFlow Phase 0b — Foundations (remainder) — Design

**Date:** 2026-09-02 · **Branch:** `phase-0b-foundations` (off `crm-erp-master-plan`, off `phase-0-tenancy`)
**Spec source:** `docs/crm-erp-plan.md` Part 2 (repo layer), Part 3 M2, Part 5 Phase 0, Part 7 Risk 1 · `docs/crm-erp-source-extract.md` §1, §8 #1–#3
**Predecessor:** Phase 0a (tenancy) — DONE, `phase-0-tenancy`, 87 files / 1120 tests green, unmerged.

---

## Goal

Finish what `crm-erp-plan.md` calls "Phase 0. Foundations". Phase 0a delivered
M1 (tenancy) and `platform_owner` + access log. Phase 0b delivers the rest:

1. **Remove the Excel customer-import and delivery-parse subsystems** — `customers`
   becomes an app-owned table with no upstream that can silently revert it (plan Risk 1).
2. **A scoped `lib/repo` query layer** — infrastructure + the new M2 tables routed
   through it + a gate against new raw SQL, without rewriting the existing 314 call sites.
3. **M2 data model** — customer type/lifecycle/credit fields, representative profiles
   with an onboarding workflow, and a `credit_approvals` table for direct customers.
4. **Demo-data purge hardening** — extend the existing reversible-marker mechanism to the
   new tables and add a production guard.

Nothing here changes the tenancy boundary, so it is safely after Phase 0a and before
Phase 1 (Money).

## Global constraints (unchanged from Phase 0a)

- **Branch `phase-0b-foundations`.** Never commit to `main`. Production serves a prebuilt
  `.next` from this working directory; source edits are inert until `npm run build &&
  systemctl restart routeflow` — do not run either. Merge/deploy of the whole stack is
  deferred until after Phase 10 (user decision, 2026-09-02).
- **Never point anything at `data/routeflow.db`.** Tests set `process.env.ROUTEFLOW_DB_PATH`
  to a temp file before importing `lib/db`. Real-data checks use
  `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/tenancy-schema.test.ts`,
  copy taken via the SQLite backup API, never `cp` (live DB is WAL).
- **Migrations idempotent, guarded on `PRAGMA table_info` / constraint text.** They run
  against live production data on the next deploy; every one safe to run twice. Follow the
  `rebuildForTenantUnique` / table-rebuild style already in `lib/db.ts`.
- **Dates ISO/Gregorian in storage, Jalali in display** (`lib/jalali.ts`). **Money is
  whole Toman in `INTEGER`** (`lib/money.ts`); no `REAL` money columns.
- **A row belonging to another tenant answers 404, not 403.**
- **Persian UI strings; English comments and identifiers.**
- `npx tsc --noEmit && npx eslint && npm test` green before every commit. One workstream
  per commit, TDD (failing test → verify fail → implement → verify pass → commit).

---

## Workstream 1 — Remove the Excel import subsystems

### Rationale

`crm-erp-plan.md` Risk 1: the OneDrive/Excel importer runs `ON CONFLICT DO UPDATE SET
status=…, debt_0_7=…, …` on every customer re-import. Once the app owns `lifecycle`
(this phase) and `debt_*` (Phase 1), a re-import silently reverts real data. The plan's
mitigation was "split field ownership." The user's decision is stronger and simpler:
**remove the import path entirely.** A future one-off import, if ever needed, is a
deliberate scripted task, not a standing endpoint.

The delivery-run parser (`lib/deliveryParse.ts` + `/api/deliveries/parse`) is removed in
the same workstream — it is the other "paste a spreadsheet" path, and the user included
it. Building a run without it means adding confirmed orders through the existing
`/api/sales/runs` + add-stop routes until Phase 3's order pipeline replaces the flow.

### Delete

| Path | Notes |
|---|---|
| `lib/importExcel.ts` (705 lines) | `importCustomersFromWorkbook`, `undoLastImport`, `getUndoStatus`, `getLastImportStatus` |
| `lib/oneDriveFetch.ts` | anonymous OneDrive share-link fetch |
| `lib/deliveryParse.ts` (202 lines) | `parseDeliveryText`, `parseDeliveryWorkbook`, `groupIntoStops` |
| `app/api/import/route.ts`, `app/api/import/onedrive/route.ts`, `app/api/import/status/route.ts`, `app/api/import/undo/route.ts` | |
| `app/api/deliveries/parse/route.ts` | |
| `components/ImportPanel.tsx`, `components/DeliveryImportPanel.tsx` | UI; find and remove their mount points |
| tests: `tests/**/import*.test.ts`, delivery-parse tests, any OneDrive test | |
| `ONEDRIVE_SALES_FILE_URL` | `.env.local`, any config reader, README mention |
| tables `import_log`, `import_snapshots` | migration: `DROP TABLE IF EXISTS` (user confirmed drop, not leave inert) |

### Reconcile

- `lib/deliveryTypes.ts` re-exports `DeliveryStop` from `deliveryParse` — inline the type
  there (or into the one remaining consumer) so nothing imports the deleted module.
- Any `/sales/*` page that mounts `ImportPanel` / `DeliveryImportPanel` loses that panel;
  check for a now-empty page or dead nav link.
- `tests/tenancy-schema.test.ts` exempt list: remove `"import_log"`, `"import_snapshots"`.
- **Keep** `exceljs` (dependency) and `app/api/sales/orders/export/route.ts` — output
  only, no ownership risk, plan explicitly retains it.
- Delete the `commit-push-every-change` / OneDrive memory note about
  `ONEDRIVE_SALES_FILE_URL` being the source of truth — it is obsolete.

### Verification

`grep -r "importExcel\|oneDriveFetch\|deliveryParse\|/api/import\|ONEDRIVE" app/ lib/
components/ tests/` returns nothing. `npx tsc --noEmit` clean. Full suite green with the
deleted tests gone and no new failures.

---

## Workstream 2 — Scoped `lib/repo` query layer

### Rationale

`crm-erp-plan.md` Part 2 makes a repository layer a Phase 0 condition on staying with
SQLite — "the later Postgres cut is a driver swap, not a rewrite of ~55 API routes" —
estimated "~2 days". Phase 0a's execution measured the real scope: **314 `.prepare(`
call sites across 71 files, ~154 outside `lib/`.** That is a multi-week phase, not two
days. User decision: **scope it now, pay down later.** Build the infrastructure, route
only the new M2 tables through it, gate new raw SQL, migrate the existing 314
incrementally as Phases 1–9 touch that code.

### Shape

```
lib/repo/
  README.md        -- the incremental-paydown contract, the allowlist rules
  base.ts          -- makeRepo(table, { tenant: true }) -> thin typed helpers
                      bound to a table and (when tenant:true) an organization_id.
                      Wraps getDb().prepare; the ONLY place .prepare lives in lib/repo.
  customers.ts     -- the NEW M2 fields only: lifecycle, customer_type, credit,
                      parent_customer_id. Not a rewrite of lib/customers.ts.
  representatives.ts
  creditApprovals.ts
```

`base.ts` gives each repo module a small set of primitives — `get(id)`, `list(filter)`,
`insert(row)`, `patch(id, fields)` — that always apply `WHERE organization_id = ?` for
tenant repos and take the `organizationId` explicitly (required arg, per the Phase 0a
"required not optional" rule). Complex reads stay hand-written SQL *inside the repo
module*, never in a route.

### The gate

A test (`tests/repo-boundary.test.ts`) that scans `app/` and `lib/` for `.prepare(` and
`db.exec(` with a SQL string literal, and fails if a path appears that is **not** in
`tests/fixtures/raw-sql-allowlist.txt`. The allowlist is seeded with today's 71 files and
may only shrink — a pre-commit reduction is welcome, an addition fails review. New code
either uses `lib/repo` or, if it genuinely needs raw SQL, adds a repo module.

Grandfathering, not a big-bang rewrite: `lib/customers.ts`, `lib/orders.ts`, every
existing `app/api/**` route stays exactly as it is.

### Verification

New M2 reads/writes go through `lib/repo`. `tests/repo-boundary.test.ts` passes with the
71-file allowlist. Adding a stray `db.prepare("SELECT 1")` to a new file fails it.

---

## Workstream 3 — M2: customers

### Schema (table-rebuild migration)

SQLite cannot `ALTER TABLE … ADD COLUMN … CHECK`. Use the table-rebuild pattern already
in `lib/db.ts` (as Task 1 did for the `users.role` CHECK), guarded on column presence so
it is idempotent.

```sql
customer_type       TEXT     CHECK (customer_type IN
                      ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER'))  -- nullable
lifecycle           TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle IN
                      ('lead','qualified','sampled','active','dormant','lost','blocked'))
parent_customer_id  INTEGER  REFERENCES customers(id)
payment_terms_days  INTEGER NOT NULL DEFAULT 0
hard_credit_block   INTEGER NOT NULL DEFAULT 0
qualified_at        TEXT
first_order_at      TEXT
```

`credit_limit_toman` already exists (added pre-tenancy). `hard_credit_block` is the hard
stop; `credit_limit_toman` + the (Phase 3) approval flow is the soft one.

### Migrating the existing `status` column

Real production `customers.status` (from the pre-tenancy backup, 141 rows):

| `status` value | count | → `lifecycle` |
|---|---:|---|
| `فعال`, `مشتری فعال` | 89 | `active` |
| `در حال پیگیری` | 31 | `qualified` |
| `نمونه داده شد` | 3 | `sampled` |
| `سرنخ` | 4 | `lead` |
| `غیرفعال` | 7 | `dormant` |
| NULL | 7 | `lead` (the column default) |

The migration maps these during the table rebuild, then **drops the `status` column**.
`first_order_at` backfills from `MIN(orders.order_date)` per customer where any order
exists; `qualified_at` stays NULL for existing rows (no historical signal for it).

Unknown/other `status` strings (none in the current data, but possible in another
tenant) map to `lead` and are logged once during migration.

### Folding lead pins into customers (user decision)

One-time migration: every `saved_locations` row currently referenced by a
`lead_list_items` row becomes a `customers` row —

- `customer_code` = `LEAD-<saved_location.id>` (the same scheme the existing
  `/api/locations/[id]/convert` route uses, so it cannot collide with a converted pin —
  and the convert route's dedupe already checks `customers`).
- `lifecycle = 'lead'`, `business_name` = the pin's name, `lat`/`lng`/`address`/`notes`
  carried over, `group_id` from the pin, `organization_id` from the pin.
- The `saved_locations` row and its `lead_list_items` membership are **deleted** after
  the customer is created (same as the convert route does on success).
- `lead_lists` rows that end up empty are left in place (a named empty list is harmless;
  deleting them is a separate cleanup).

After this, `saved_locations` + `lead_lists` remain the *map-pin capture* tool for places
nobody has engaged yet; the moment a pin is worth tracking as a relationship it becomes a
`customers` row with `lifecycle='lead'`. The `/api/locations/[id]/convert` route stays as
the manual promote path.

Guard: run only once, guarded on a migration marker, and skip any pin whose
`LEAD-<id>` code already exists (idempotent).

### Repo + surface

`lib/repo/customers.ts` — `setLifecycle`, `setCustomerType`, `setCreditTerms`,
`setParent`, and reads that filter by `lifecycle`. Wire into the existing customer detail
/ edit surface (`/sales/customers/*`) as fields; a lifecycle change is an explicit action
with the allowed-transitions check (below), not a free dropdown.

Lifecycle transitions (`lib/customerLifecycle.ts`, a small allowed-transitions table):
`lead→qualified→sampled→active`, `active↔dormant`, any→`lost`, any→`blocked`,
`lost→lead` (re-engage), `blocked→active` (unblock). `sampled→active` also allowed
(sample converted straight to an order). Illegal transition = 409 with the legal set.

---

## Workstream 4 — M2: representatives (schema + onboarding workflow)

User decision: build the **fuller** version — schema + the onboarding workflow — now,
because rep recruitment is the stated growth engine. Rep-facing UI, health scores, and
the `/reps` tab stay in Phase 8.

### Role

`rep_manager` added to the `Role` union in `lib/roles.ts` and the `users.role` CHECK
(table-rebuild, exactly as `platform_owner` was added in Phase 0a Task 1; the test that
asserts `lib/roles.ts` and `scripts/create-user.mjs` never drift stays green).

Hierarchy: `platform_owner` > `owner` > `group_manager` / `rep_manager` (siblings, one
per axis) > `salesperson` / `driver`. `rep_manager` sees representatives in their org;
does not see `group_manager` territory data. Scoping added to `lib/session.ts` alongside
the existing role branches.

### Tables

```sql
CREATE TABLE representative_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  rep_code TEXT NOT NULL,
  manager_user_id INTEGER REFERENCES users(id),
  contract_signed_at TEXT, contract_expires_at TEXT,
  exclusivity_territory_id INTEGER REFERENCES districts(id),
  stage TEXT NOT NULL DEFAULT 'prospect' CHECK (stage IN
    ('prospect','qualified','negotiating','documents','approved','onboarding','active','dormant','terminated')),
  activated_at TEXT, first_order_at TEXT,
  credit_terms_days INTEGER NOT NULL DEFAULT 0,
  discount_tier TEXT,
  monthly_target_kg REAL, monthly_target_toman INTEGER,
  health_score REAL, health_computed_at TEXT,   -- populated in Phase 8; nullable now
  notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (organization_id, customer_id),
  UNIQUE (organization_id, rep_code)
);

CREATE TABLE representative_onboarding_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  representative_id INTEGER NOT NULL REFERENCES representative_profiles(id) ON DELETE CASCADE,
  step_code TEXT NOT NULL,
  label_fa TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT, completed_by INTEGER REFERENCES users(id), notes TEXT,
  UNIQUE (representative_id, step_code)
);
```

A representative **is** a `customers` row (`customer_type='WHOLESALE'`, its own
`lifecycle`) plus this managed-relationship record — one `Order` table serves both, per
the plan. `representative_profiles.customer_id` is that link.

### Onboarding step set

Seeded on rep creation (`lib/repOnboarding.ts` holds the standard list —
`step_code` + `label_fa` + `required` + `sort_order`), e.g. `contract_signed`,
`territory_assigned`, `price_list_assigned`, `credit_terms_set`, `first_stock_order`,
`training_module_6` (the academy tie-in, Phase 8). The list is code, not a table — a
tenant does not edit it in this phase.

### Stage machine

`lib/repStages.ts` — allowed `stage` transitions as a table, same idea as the order
machine but small: `prospect→qualified→negotiating→documents→approved→onboarding→active`,
`active↔dormant`, any non-terminal → `terminated`. `→ active` guarded on all `required`
onboarding steps being `completed_at IS NOT NULL`. Illegal transition = 409 with the
legal set.

### Repo + surface

`lib/repo/representatives.ts` (profiles + steps). `/api/admin/representatives` (list,
create) + `/api/admin/representatives/[id]` (get, patch, advance-stage, complete-step) —
`owner` and `rep_manager` only. `/sales/admin/representatives` page following the
existing `/sales/admin/groups` page pattern: a table of reps with stage, a create form,
a detail drawer showing the onboarding checklist.

---

## Workstream 5 — M2: credit approvals (direct customers only) + demo-purge hardening

### Credit approvals

User decision: credit control applies to **direct customers only** — source facts F6/F7,
reps buy on cash or bank cheque and their end-customer collections are not Niko Etemad's
concern. And in 0b: **table + repo + manual decide surface only**; the automatic
"order over limit → `PENDING_CREDIT`" trigger needs the order state machine and lands in
Phase 3.

```sql
CREATE TABLE credit_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requested_at TEXT NOT NULL,
  customer_balance_toman INTEGER NOT NULL,
  credit_limit_toman INTEGER,
  overage_toman INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, reason TEXT
);
```

`lib/repo/creditApprovals.ts` — `request`, `list({ status })`, `decide(id, verdict,
reason)`. A minimal `/api/admin/credit-approvals` + `[id]/decide` and a list on the
existing admin area (`group_manager` / `owner`). A rep customer
(`representative_profiles.customer_id` set) is rejected at `request` time with a Persian
message — reps do not enter this flow.

### Demo-purge hardening

`scripts/seed-demo.mjs` already reverses cleanly (`sku LIKE 'DEMO-%'`,
`username LIKE 'demo.%'`, `order_no LIKE '1404-9%'`, cascade through those). Phase 0b:

- Extend the marked set to the new tables: `representative_profiles.rep_code LIKE
  'DEMO-%'` (and its `customer_id` customer, its onboarding steps via cascade),
  `credit_approvals` reached through demo `order_id`.
- **Production guard:** the seed path refuses to run when `NODE_ENV === "production"`
  *or* org 1 has any non-demo order, unless `--force` is passed. `--remove` has no guard
  (removing demo data is always safe).
- `tests/seed-demo.test.ts` (or extend an existing one): seed → assert every new table
  has demo rows; `--remove` → assert zero demo rows and that a hand-inserted "real" row
  in each table is untouched.

---

## Workstream 6 — Tenancy wiring

- `TENANT_TABLES` += `representative_profiles`, `credit_approvals`.
- `representative_onboarding_steps` reaches a tenant *through* `representative_profiles`
  (like `order_lines` through `orders`) → add to the `tests/tenancy-schema.test.ts`
  exempt list, not `TENANT_TABLES`.
- `tests/helpers/twoOrgs.ts` — seed one `representative_profiles` row (+ its wholesale
  customer + onboarding steps) and one `credit_approvals` row per org, with colliding
  natural keys (`rep_code = 'SHARED-REP'`), so `tests/tenancy-isolation.test.ts` proves
  isolation for them automatically (the Phase 0a Task 7 payoff).
- `credit_approvals` and `representative_profiles` writers stamp `organization_id` as a
  **required** field on their repo `insert` (the Phase 0a "required not optional" rule).

---

## Sequencing

1. **WS1 removal** — smallest, shrinks surface, unblocks nothing but simplifies the rest.
2. **WS2 repo infra** — `base.ts`, `README.md`, the boundary test + 71-file allowlist.
3. **WS3 customers** — schema rebuild, `status`→`lifecycle` migration, lead-pin fold-in,
   `lib/repo/customers.ts`, lifecycle machine.
4. **WS4 representatives** — role, tables, onboarding set, stage machine, repo, admin UI.
5. **WS5 credit approvals + demo hardening**.
6. **WS6 tenancy wiring** — `TENANT_TABLES`, `twoOrgs` fixture, isolation coverage.

Each workstream is one or more commits, TDD throughout, full suite green before each.

## Explicitly out of scope

- Rewriting the existing 314 raw-SQL call sites (incremental, Phases 1–9).
- Rep-facing UI, rep health scores, the `/reps` tab, the academy content (Phase 8).
- The automatic `order → PENDING_CREDIT` credit trigger and the order state machine
  (Phase 3).
- Derived debt ageing replacing `customers.debt_*` (Phase 1).
- `payments`, `cheques`, `payment_allocations` (Phase 1 / M3).
- Per-endpoint `logPlatformAccess` wiring (deferred until cross-tenant support views
  exist — first one is Phase 8's `platform_owner` briefing panel).
- Any Postgres work.

## Risks

1. **The lead-pin fold-in is a destructive migration** (deletes `saved_locations` +
   `lead_list_items` rows). Mitigation: guarded on a run-once marker, idempotent on
   `LEAD-<id>` code collision, and the pre-deploy backup is mandatory. Tested against a
   copy of real data before it is trusted.
2. **Dropping `customers.status` is irreversible.** The mapping table above is derived
   from the *current* real data; another tenant's data is unseen. Unknown values → `lead`
   + a logged warning, not a failed migration. The backup is the recovery path.
3. **Removing the delivery-run parser leaves a workflow gap** until Phase 3. Confirm the
   `/api/sales/runs` + add-stop path can build a run unaided before deleting the parser;
   if it cannot, a minimal "add confirmed order to run" action ships in WS1.
4. **`rep_manager` scoping in `lib/session.ts`** touches the same choke point Phase 0a
   warned is easy to re-break. Every change gets a `tests/tenancy-scoping.test.ts` case.
5. **The repo-boundary allowlist could rot into a rubber stamp.** Mitigation: the test
   asserts the list only shrinks (compare against git HEAD's version), and `lib/repo/
   README.md` states the rule.
