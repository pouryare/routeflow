# Phase 8 — Reps + academy Implementation Plan

> Execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** `/reps` (rep health + onboarding + stages) and `/academy` (objection library keyed to `tasks.outcome_code` + an MDX module skeleton).

**Spec:** `docs/superpowers/specs/2026-09-02-phase-8-reps-academy-design.md`

## Global Constraints

- Persian UI, English identifiers. Cross-tenant → 404. Migrations idempotent, guarded.
- New DB access via `lib/repo/`. Never commit to `main`/build/restart.
- Academy content is a documented backlog item; ship stubs + ~8 real objection cards.
- Vitest bg + poll. eslint `app/ lib/` + per-file. After route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: schema — `objection_cards` + `lesson_progress` + seed + MDX skeleton

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `content/academy/_manifest.json`, `content/academy/01-market-and-customer/index.mdx`, `content/academy/02-phone-sales/index.mdx`, `tests/academy-schema.test.ts`.

- Two tables in the main schema block. `seedObjectionCards(db)` (8 NULL-org starters, `INSERT … WHERE NOT EXISTS`) next to `seedRules`. `TENANT_TABLES` += both. `objection_cards` gets the `reason_codes` treatment (sweeps + no-NULL check skip).
- MDX stubs + manifest per spec §1.
- Schema test: tables + uniques; 8 NULL-org cards after boot; `objection_cards` UNIQUE `(org, outcome_code, customer_type)` — NB NULL customer_type does not collide, so the repo dedups in code; `lesson_progress` UNIQUE bites.
- Full suite — fix tenancy-schema fallout.
- Commit.

### Task 2: `lib/repo/academy.ts`

**Files:** Create `lib/repo/academy.ts`, `tests/academy-repo.test.ts`.

- `listObjectionCards(orgId, filter?)`, `objectionCardFor(orgId, outcome_code, customer_type?)` (a customer_type-specific card beats a NULL one for the same code; tenant beats default), `upsertObjectionCard`, `academyManifest()`, `markLessonDone`, `lessonProgress`.
- Tests: `objectionCardFor(1, 'PRICE_OBJECTION')` → the starter; a tenant override for the same code wins; a `RESTAURANT`-specific card beats the generic one when `customer_type='RESTAURANT'` is passed; `markLessonDone` twice = one row; `academyManifest()` returns the two modules with `status:'stub'`.
- Commit.

### Task 3: `lib/repo/repHealth.ts`

**Files:** Create `lib/repo/repHealth.ts`, `tests/rep-health.test.ts`.

- `repHealth(orgId, repId)` + `repsOverview(orgId)` per spec §3.
- Tests: a rep with all onboarding steps done, an order 5 days ago, covering 2 of 4 active products → factors `{onboarding:100, recency:100, coverage:50}`, score `round(100*.3 + 100*.4 + 50*.3) = 85`, band `good`; a rep with no orders → `recency:0`; `repsOverview` returns one row per rep with `rep_code` and `business_name`.
- Commit.

### Task 4: wire the objection card into `PATCH /api/tasks/[id]`

**Files:** Modify `app/api/tasks/[id]/route.ts`, `lib/repo/tasks.ts` (add a helper to resolve a task's customer type), `tests/api/spine-route.test.ts` (extend).

- On a PATCH that sets an `outcome_code`, resolve the task's customer type (via `entity_type='customer'` directly, or `'order'` → `orders.customer_id` → `customers.customer_type`) and include `objection_card: objectionCardFor(...)` in the 200 body.
- Test: PATCH a task (entity_type `customer`) with `outcome_code:'PRICE_OBJECTION'` → the response carries an `objection_card` with a `script_fa`.
- Commit.

### Task 5: API routes — reps + academy

**Files:** Create `app/api/sales/reps/route.ts`, `app/api/sales/reps/[id]/route.ts`, `app/api/sales/academy/objection/route.ts`, `app/api/sales/academy/lessons/route.ts`; Modify `proxy.ts`; Create `tests/api/reps-academy-route.test.ts`.

- Per spec §5. `npx next typegen`.
- Tests: `GET /api/sales/reps` → 200 with the overview; `GET /api/sales/reps/[id]` → health + onboarding; `GET /api/sales/academy/objection?outcome_code=PRICE_OBJECTION` → a card; `POST /api/sales/academy/lessons {lesson_slug}` then `GET` shows it done; a salesperson `GET /api/sales/reps` → 403.
- Commit.

### Task 6: UI — `/sales/reps` + `/sales/academy` + TaskRow card

**Files:** Create `app/sales/reps/page.tsx`, `app/sales/reps/[id]/page.tsx`, `app/sales/academy/page.tsx`, `components/sales/RepOverview.tsx`, `components/sales/AcademyLibrary.tsx`; Modify `components/today/TaskRow.tsx`, `app/sales/layout.tsx`.

- `/sales/reps` overview table + detail (health factors, onboarding checklist, stage buttons). `/sales/academy` module list + objection library grouped by `outcome_code`. `TaskRow` shows the returned `objection_card` inline after an outcome is logged. nav tabs «نمایندگان» + «آموزش».
- `tsc` + `eslint` clean.
- Commit.

### Task 7: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/academy-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-8-reps-academy.md`; update memory.

- `twoOrgs`: `OrgFixture` += `objectionCardId`; seed a tenant `objection_cards` + a `lesson_progress` row per org.
- `tenancy-isolation`: overrides apart, NULL-org starters shared, `lesson_progress` scoped.
- Real-data test per spec §8.
- Full suite, `tsc`, `eslint app/ lib/`. Plan doc row 8 → ✅ DONE. Handoff. Memory.
- Commit.
