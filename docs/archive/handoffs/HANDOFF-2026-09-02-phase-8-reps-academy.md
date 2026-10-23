# RouteFlow Phase 8 (Reps + academy) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-8-reps-academy` (off `phase-7-spine`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-8-reps-academy-design.md` · Plan: `docs/superpowers/plans/2026-09-02-phase-8-reps-academy.md` (7 tasks, done).

## What shipped

| Area | Detail |
|---|---|
| Schema | `objection_cards` (keyed to `tasks.outcome_code`; `organization_id NULL` = a shipped starter; `UNIQUE (org, outcome_code, customer_type)`; on `TENANT_TABLES`; the `reason_codes` treatment — sweeps + `tenancy-schema` no-NULL check skip it). `lesson_progress` (`UNIQUE (org, user, lesson_slug)`). `seedObjectionCards` plants **8 real starter cards** (`PRICE_OBJECTION`, `NOT_INTERESTED`, `NO_TIME`, `ALREADY_SUPPLIED`, `QUALITY_DOUBT`, `PAYMENT_TERMS`, `CONTACTED`, `ORDERED`) with full Persian response scripts. |
| MDX skeleton | `content/academy/_manifest.json` + `01-market-and-customer/index.mdx` + `02-phone-sales/index.mdx` — each a titled stub with `## اهداف` / `## درس` / `## تمرین` and a `<!-- BACKLOG: author from source turns N–M -->` marker. `_manifest.json` marks both `status:'stub'`. |
| `lib/repo/academy.ts` | `listObjectionCards` / `objectionCardFor` (a `customer_type`-specific card beats a generic one; a tenant card beats a default), `upsertObjectionCard`, `academyManifest` / `lessonBody` (read `content/academy/`), `markLessonDone` (idempotent) / `lessonProgress`. |
| `lib/repo/repHealth.ts` | `repHealth(orgId, repId)` — weighted mean of **onboarding** (`done/total` steps, 0.3), **recency** (100 within 14 d → 0 at 60 d, 0.4), **coverage** (distinct products ordered / active products, 0.3); bands `good ≥ 70` / `watch ≥ 40` / `risk`. `repsOverview` → one row per rep with `rep_code` / `business_name` / `stage` / the full health object. |
| Objection card on outcome | `PATCH /api/tasks/[id]` with an `outcome_code` resolves the task's customer type (`entity_type='customer'` directly, or `'order' → orders.customer_id → customers.customer_type` — `taskCustomerType` in `lib/repo/tasks`) and returns `objection_card` in the 200 body. The `/today` `TaskRow` shows it inline for ~6 s before refreshing — «آموزش بخشی از تماس است، نه یک تب.» |
| API | `GET /api/sales/reps` (overview), `GET /api/sales/reps/[id]` (health + `listOnboarding` + rep row); `GET /api/sales/academy/objection` (`?outcome_code=&customer_type=` → best card, else the list) + `PATCH` (tenant override); `GET /api/sales/academy/lessons` (modules + progress) + `POST` (`{lesson_slug}` → mark done). `proxy.ts`: `/sales/reps` + `/api/sales/reps` → owner / group_manager / rep_manager; `/sales/academy` + `/api/sales/academy` reachable by a driver too. |
| UI | `/sales/reps` (overview table; row → `/sales/reps/[id]` with the three health factors + the onboarding checklist) and `/sales/academy` (`AcademyLibrary` — module list with «تمام کردم» → `markLessonDone`, objection library grouped by `outcome_code`, searchable). `TaskRow` card. nav tabs «نمایندگان» (owner/manager/rep_manager) + «آموزش» (all). |
| Tenancy | `objection_cards` + `lesson_progress` on `TENANT_TABLES`. `twoOrgs` seeds a tenant `objection_cards` override + a `lesson_progress` row per org; `tenancy-isolation` asserts overrides apart, the 8 starters shared, `lesson_progress` scoped. |

Suite: **green** (`tsc` + `eslint app/ lib/` clean — see the commit's CI notes). Real-data check passed: FK check clean, two tables present, 8 starter cards, 0 tenant rows.

## Deviations from the plan

- **The academy body is NOT authored.** The two MDX files are labelled stubs with a backlog marker; `_manifest.json` marks them `status:'stub'`; the lesson page renders the MDX as plain prose (`lessonBody` returns the raw text — no `@next/mdx` runtime was added). Authoring and chunking the ~440 k characters from turns 4–75 of the source ChatGPT conversation is **the documented backlog item** for this phase. The **objection library, which is where §4.4 said the ROI is, ships with 8 real cards**.
- **The coaching-loop rule** (Sample→Order conversion below team average for two periods → auto-assign the relevant lesson as a task) is deferred — a small sweep rule on top of Phase 7's engine. The card-on-outcome wiring, the must-have, shipped.
- **`repHealth` weights are hand-set constants** — like `capacity_factors`, a Phase 10 learning candidate.
- **`/sales/reps` reuses the Phase 0b `representatives` repo** (`repsRepo`, `listOnboarding`, `advanceStage`, `completeStep` all exist) — this phase added `repHealth` / `repsOverview` and the read surface, not a new rep model.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API.
2. `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/academy-migration-realdata …` — FK check empty, two tables, 8 starter cards, rest empty.
3. `npm run build` + `systemctl restart routeflow`.
4. **Backlog:** author `content/academy/*/index.mdx` for modules 1–7 from the source conversation; flip `_manifest.json` `status` to `ready` per module as it lands. Add `objection_cards` rows for the `customer_type`-specific scripts (§4.4: "a hotel purchasing manager and a small restaurant owner are not the same conversation").

## Next: Phase 9 — Analysis

Per `docs/crm-erp-plan.md` Part 5 row 9: why-analysis drill-down, health scores, **contribution margin per customer / product / salesperson / territory**, the Action Center, and **precomputed KPI snapshots** (the second SQLite-scaling condition — a `kpi_snapshots` table refreshed by a sweep so `/analytics` reads a table, not a 12-way join). Pure logic + a snapshot table; no external service. Branch off `phase-8-reps-academy`.
