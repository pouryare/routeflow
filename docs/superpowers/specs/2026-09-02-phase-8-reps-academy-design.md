# RouteFlow Phase 8 — Reps + academy — Design

**Date:** 2026-09-02 · **Branch:** `phase-8-reps-academy` (off `phase-7-spine`) · **Status:** design.

Implements `docs/crm-erp-plan.md` Part 5 row 8 and §4.4: the `/reps` surface (rep health / onboarding / stages — most of `representative_profiles` + the onboarding machine landed in Phase 0b) and `/academy` (the objection library keyed to the `tasks.outcome_code` from Phase 7, plus an MDX module skeleton).

**Content note.** The academy body is ~440 k characters to author and chunk from turns 4–75 of the source ChatGPT conversation. This phase ships the **schema, the MDX skeleton for modules 1–2, and the `outcome_code → objection card` wiring** — all TDD-able. The full content is a documented backlog item; the objection library ships with ~8 real starter cards.

---

## 1. Schema

```sql
CREATE TABLE objection_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = a shipped starter card
  outcome_code TEXT NOT NULL,       -- matches tasks.outcome_code, e.g. 'PRICE_OBJECTION'
  customer_type TEXT,               -- NULL = applies to any; else 'RESTAURANT'/'HOTEL'/…
  title_fa TEXT NOT NULL,
  script_fa TEXT NOT NULL,          -- the response script
  module_slug TEXT,                 -- the academy lesson it belongs to
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, outcome_code, customer_type)
);

CREATE TABLE lesson_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  lesson_slug TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (organization_id, user_id, lesson_slug)
);
```

`TENANT_TABLES` += `objection_cards`, `lesson_progress`. `objection_cards` gets the `reason_codes` treatment (NULL-org starters, sweeps + `tenancy-schema` no-NULL check skip it). `seedObjectionCards(db)` — ~8 NULL-org starters keyed to the outcome codes the Phase 7 `TaskRow` emits (`CONTACTED`, `ORDERED`, `PRICE_OBJECTION`, `NOT_INTERESTED`) plus a few classics (`NO_TIME`, `ALREADY_SUPPLIED`, `QUALITY_DOUBT`, `PAYMENT_TERMS`).

### MDX skeleton — `content/academy/`

```
content/academy/
  01-market-and-customer/index.mdx      # ۱ مبانی بازار و مشتری
  02-phone-sales/index.mdx              # ۲ فروش تلفنی
  _manifest.json                        # [{slug, module, title_fa, order, status:'stub'}]
```

Each `index.mdx`: a title, `## اهداف`, `## درس`, `## تمرین` headings with a one-paragraph stub and a `<!-- BACKLOG: author from source turns N–M -->` marker. `_manifest.json` is the index `lib/repo/academy.ts` reads (no MDX parsing at runtime — the manifest carries the metadata, the page renders the MDX with the existing MDX pipeline if one exists, else as plain prose).

---

## 2. `lib/repo/academy.ts` (tested)

- `listObjectionCards(orgId, {outcome_code?, customer_type?})` — tenant ∪ NULL-org, tenant wins per `(outcome_code, customer_type)`; a `customer_type`-specific card beats a NULL one for the same code.
- `objectionCardFor(orgId, outcome_code, customer_type?)` — the single best match, or undefined.
- `upsertObjectionCard(orgId, input)` — a tenant override.
- `academyManifest()` — reads `content/academy/_manifest.json`.
- `markLessonDone(orgId, userId, lessonSlug)` — upsert on the UNIQUE.
- `lessonProgress(orgId, userId)` — `{slug, completed_at}[]`.

## 3. `lib/repo/repHealth.ts` (tested)

```ts
export interface RepHealth {
  representative_id: number;
  score: number;              // 0..100
  band: "good" | "watch" | "risk";
  factors: { onboarding: number; recency: number; coverage: number };
  onboarding_done: number; onboarding_total: number;
  last_order_date: string | null;
  products_covered: number; products_available: number;
}
export function repHealth(organizationId: number, representativeId: number): RepHealth;
export function repsOverview(organizationId: number): (RepHealth & { rep_code: string; business_name: string; stage: string })[];
```

Score = weighted mean of three 0..100 factors:
- **onboarding** = `done / total` steps (100 when no steps defined).
- **recency** = 100 if an order in the last 14 days, linearly to 0 at 60 days, 0 beyond.
- **coverage** = `distinct products this rep has ever ordered / active products` × 100.
Weights `{onboarding: 0.3, recency: 0.4, coverage: 0.3}`. Bands: ≥ 70 good, ≥ 40 watch, else risk.

## 4. Wiring the objection card into Phase 7

- `POST /api/tasks/[id]` PATCH response, when an `outcome_code` was set, includes `objection_card` = `objectionCardFor(orgId, outcome_code, <the task's customer's type>)` (the task carries `entity_type='customer'`/`'order'` — resolve the customer type from there). The `/today` `TaskRow` then shows the card's `title_fa` + `script_fa` inline after the outcome is logged. «آموزش بخشی از تماس است، نه یک تب.»
- A coaching rule (Phase 7): `sample_followup` / a new `low_conversion` sweep can `action_json` reference a `module_slug` so a task carries "درس مرتبط: …" — deferred as a follow-up; the card-on-outcome is the must-have.

## 5. API

| route | method | notes |
|---|---|---|
| `/api/sales/reps` | GET | `repsOverview` (owner / group_manager / rep_manager) |
| `/api/sales/reps/[id]` | GET | `repHealth` + `listOnboarding` + stage |
| `/api/sales/academy/objection` | GET `?outcome_code=&customer_type=` | the best card (any authenticated sales role) |
| `/api/sales/academy/objection` | PATCH | tenant override (owner / manager) |
| `/api/sales/academy/lessons` | GET, POST `{lesson_slug}` | progress + mark done (any sales role) |

`proxy.ts`: `/sales/reps` + `/api/sales/reps` → owner / group_manager / rep_manager; `/sales/academy` + `/api/sales/academy` open to all non-driver sales roles + driver (the objection card is useful at the door too).

## 6. UI

- **`/sales/reps`** — a table from `repsOverview`: rep code / business name / stage / health band + score / onboarding `n/total` / last order. Row → `/sales/reps/[id]` (detail: the health factors, the onboarding checklist with complete buttons, the stage machine buttons). Reuses the Phase 0b `representatives` admin bits where possible.
- **`/sales/academy`** — the module list from `academyManifest()` (each a link that renders the MDX / prose, with a «تمام کردم» button → `markLessonDone`), and the **objection library**: every card grouped by `outcome_code`, searchable, each showing `title_fa` + `script_fa`.
- **`/today` `TaskRow`** — after an outcome is logged, if the PATCH response carried an `objection_card`, show it inline (title + script + a link to `/sales/academy`).
- nav tabs «نمایندگان» (owner/manager/rep_manager) and «آموزش» (all).

## 7. Tenancy

`objection_cards` + `lesson_progress` on `TENANT_TABLES`. `twoOrgs` seeds one tenant `objection_cards` override + one `lesson_progress` row per org. `tenancy-isolation`: overrides apart, NULL-org starters shared, `lesson_progress` scoped.

## 8. Migration safety

`tests/academy-migration-realdata.test.ts` (env-gated): `foreign_key_check` empty; the two tables exist and (bar the NULL-org starters) empty; the starter cards number 8.

## 9. Deviations anticipated

- **The academy body is not authored** — the MDX files are labelled stubs with a backlog marker; `_manifest.json` marks them `status:'stub'`; the objection library ships ~8 real cards. Authoring the ~440 k chars from the source conversation is the documented backlog item.
- **No MDX runtime pipeline is added if one does not exist** — the lesson page renders the prose plainly (headings + paragraphs) rather than pulling in `@next/mdx`; the manifest is the metadata source.
- **The coaching-loop rule (Sample→Order conversion below team average → assign a lesson)** is deferred — the card-on-outcome wiring is the must-have; the sweep rule is a small addition on top of Phase 7's engine.
- **`repHealth` weights are hand-set** — like `capacity_factors`, they are candidates for Phase 10 learning but ship as constants here.
