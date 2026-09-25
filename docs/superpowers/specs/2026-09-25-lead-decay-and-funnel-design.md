# Lead Decay Clock + Funnel — Design Spec

**Date:** 2026-09-25 · **Status:** Approved (brainstorming)
**Scope:** Manager-facing lead health — one derived function feeding a decay clock and a funnel view.
**Companion:** `implementation_plan.md` (the adaptive `/leads` driver work). This spec adds the
manager's *visibility*; it depends on `leadVisitFlow` writing `visit_outcome` correctly, which
that plan fixes.

---

## 0. The problem

A lead's condition lives in two columns: `saved_locations.visit_outcome` (what happened at the
last visit) and `status`. Neither says **how long ago**, and — verified — `visit_outcome` is read
by nothing except its own writer:

```
$ grep -rn "visit_outcome" --include=*.ts lib/repo/ app/api/
lib/repo/crm/migrate.ts:124:  if (!locHave.has("visit_outcome")) ...   # the migration
lib/repo/crm/write.ts:279:    UPDATE saved_locations SET ... visit_outcome ...  # the writer
```

Two failures follow, both reported by the user:

1. **A call task is created and nobody calls.** It sits in the pocket and ages out silently.
2. **The manager cannot see the funnel** — which leads are hot, cold, or rotting.

The escalation machinery to fix (1) **already exists and has never been pointed at leads**:

| Capability | Location | Lead rules? |
|---|---|---|
| `runSweepRules` — sweep entities past a threshold | `lib/repo/rules.ts:273` | no |
| `escalateStaleRuns` — bump ignored task to CRITICAL, reassign | `lib/repo/rules.ts:471` | no |
| `liveRun` — cooldown, no re-fire | `lib/repo/rules.ts` | no |
| `rankActionCenter` — critical/warning/opportunity | `lib/analysis/actionCenter.ts:47` | no |
| 5 seeded rules | `lib/db.ts:3543` | **all delivery/credit/stock** |

So the clock is cheap. The hard part is deciding what decay *means*.

---

## 1. Decisions locked

| # | Decision | Rationale |
|---|---|---|
| D1 | **One pure function, two consumers** | `leadTemperature()` feeds both the clock and the funnel, so they cannot disagree |
| D2 | **Band is derived, never stored** | Same principle as `customers.lifecycle`, which `recomputeState` computes from the activity log |
| D3 | **Thresholds per-tenant, seeded with a default** | Same pattern as `capacity_factors` (`organization_id IS NULL` = seed, non-null = override, tenant wins) |
| D4 | **`dead` is a label, never an action** | A background job may ADD attention, never REMOVE it — matches `escalateStaleRuns`, which never deletes |
| D5 | **Decay automatic but reversible; resurrection always manual** | Decay only adds a task (closing it undoes it); resurrection moves a lead between stages, so it needs a human |
| D6 | **No background job ever moves a lead between bands** | The sweep proposes, the manager disposes |
| D7 | **Override = a closed `tasks` row with a reason**, not a new column | The audit trail already exists and survives conversion to a customer; `hand-set` derives from it |
| D8 | **Undo via toast re-PATCH** | Same pattern as `deleteList`, which returns the deleted row "so the delete can be undone from the toast" |
| D9 | **Score is an overlay gated by `MIN_LEARN_N`, never a replacement** | Below the data threshold the column is absent rather than showing a fake number |
| D10 | **The score informs; it never overrules a fact** | A high score cannot promote a lead out of `hot` |

---

## 2. The two axes

The user's request for "an actual funnel figure, like AIDA" surfaced that the funnel and the
bands are **different axes**, and conflating them is what makes a pipeline lie.

- **Stage** — a lead moves *down*: `attention → interest → desire → action`.
- **Band** — a lead ages *in place*: `hot / warm / cold / rotting / dead`.

A lead can be mid-funnel **and** rotting simultaneously. That is precisely the leak: 47 leads with
real intent look identical to 1,240 never contacted, because a pure AIDA funnel hides them.

```
                    ┌─────────────────────────────────────┐
   ATTENTION        │   never contacted          1,240   │  ← lead pool, /leads
   (unvisited)      │   visited = no_answer        310   │
                    └─────────────────────────────────────┘
                              │  driver visit
                              ▼
                    ┌─────────────────────────────────────┐
   INTEREST         │   warm   interested            186   │  ← follow-up owed
   (met, engaged)   │   cold   met, no signal         94   │
                    └─────────────────────────────────────┘
                              │  says "I'll buy"
                              ▼
                    ┌─────────────────────────────────────┐
   DESIRE           │   hot    READY_TO_BUY            31   │  ← someone's job today
                    └─────────────────────────────────────┘
                              │  first order
                              ▼
                    ┌─────────────────────────────────────┐
   ACTION           │   customer  (12 this month)         │  ← leaves /leads entirely
                    └─────────────────────────────────────┘

   side-channel, never a stage:     47  rotting  ── sweep fires a task
                                   612  dead     ── label only, manager archives
```

The last two rows are the payoff. `rotting` and `dead` do not advance downward — they decay
sideways. A pure AIDA funnel would hide them entirely.

**Stage** comes from `visit_outcome`, already written — so the funnel is a *read*, not new state.
**The band is the overlay** that makes rotting visible *inside* each stage. A manager reading
"Interest — 186" must know 47 of those are rotting, or the number lies.

---

## 3. The bands

| Band | Means | Derived from | Action |
|---|---|---|---|
| `hot` | Live intent | `READY_TO_BUY`, or purchased | none — already someone's job |
| `warm` | Met, interested, follow-up owed | `INTERESTED`, or high stars + recent visit | ages into `cold` |
| `cold` | Met, no signal / interest gone | `VISITED` + low stars, or `INTERESTED` past threshold | ages into `rotting` |
| `rotting` | Was warm, untouched — **our fault** | warm/cold + days since activity | **sweep fires a task**; escalates if ignored |
| `dead` | No signal, unrecoverable | never contacted, or `NOT_INTERESTED`/`closed` past threshold | **label only** — manager archives by click |

Three distinctions carry the weight:

- **`hot` is a state, not a temperature.** Bought is a fact. It must not decay; a lead that bought
  is a customer and belongs to the customer funnel.
- **`rotting` vs `dead` is recoverability, not elapsed time.** Rotting means someone was interested
  and we let it go — our fault, deserves a task. Dead means it was never going to happen. Treating
  them alike is how inboxes fill with hopeless work.
- **`not_interested` is not `dead`.** Someone who said no gave information and can be re-approached
  months later; someone never reached cannot. The flow already separates them
  (`VISIT_NOT_INTERESTED` vs `VISIT_NO_OWNER`).

### 3.1 Precedence

A lead can match several rules, so order is fixed:

1. purchased, or `READY_TO_BUY` → `hot`
2. never contacted → `cold`; past `never_contacted_to_dead` → `dead`
3. `INTERESTED`, or high stars → `warm`; past `warm_to_rotting` → `rotting`
4. otherwise, previously met → `cold`; past `cold_to_rotting` → `rotting`
5. `NOT_INTERESTED` / `closed` → past `not_interested_to_dead` → `dead`, **never** `rotting`

### 3.2 What the bands deliberately do not do

- **No score.** `rating_potential`/`volume`/`ease` already feed `averageScore`. A second scoring
  system would compete with the first.
- **No ranking within a band.** `rankActionCenter`'s `priorityScore` already does
  impact/probability/urgency.
- **No prediction of who will buy** — see §7; it is an overlay, not a band input.

---

## 4. The function

```ts
// lib/leadTemperature.ts — pure. No DB, and deliberately NO score input. The
// clock arrives as an argument so every band is a function of time and recorded
// evidence alone; see the note below on why the score is kept out.
export type LeadBand = "hot" | "warm" | "cold" | "rotting" | "dead";

/** The resolved per-tenant thresholds. Mirrors the lead_bands row after the
 *  seed-vs-tenant merge in resolvedLeadBands(); see section 5. */
export interface LeadBandConfig {
  warmToRottingDays: number;
  coldToRottingDays: number;
  neverContactedToDeadDays: number;
  notInterestedToDeadDays: number;
  /** A dead lead scoring above this becomes a resurrection PROPOSAL, never an
   *  automatic move -- see D5. Ignored while no score is trusted (D9). */
  resurrectScore: number;
}

export interface LeadTemperatureInput {
  outcome: OutcomeCode | null;        // saved_locations.visit_outcome
  convertedAt: string | null;         // set once it is a customer -> hot
  lastActivityAt: string | null;      // created_at, or last lead_visit_activities row
}

export function leadTemperature(
  lead: LeadTemperatureInput,
  now: Date,
  bands: LeadBandConfig,               // resolved per-tenant, §5
): LeadBand;
```

Pure is not stylistic. It is what makes the two halves provably consistent, and it means the whole
band matrix is testable with **no database** — the same shape as `tests/lead-desire.test.ts` in the
companion plan.

**The score is deliberately not an input to this function.** D5 makes resurrection a human
decision, so a band computed from a score would let a model move a lead between stages on its own —
the exact thing D6 forbids. The score lives one layer out, as the predicate that decides whether a
*resurrection proposal* is worth showing a manager:

```ts
// lib/repo/leadScores.ts — separate from leadTemperature on purpose.
export function shouldProposeResurrection(
  lead: LeadTemperatureInput,
  score: number | null,        // null below MIN_LEARN_N -> always false
  bands: LeadBandConfig,
): boolean;
```

So the dependency runs one way only: `leadTemperature` never knows a score exists, and the proposal
query asks both questions separately. That is what keeps a band reproducible from a lead's own row,
with no model and no database.

---

## 5. Per-tenant thresholds

New table, copied exactly from `capacity_factors` (`lib/db.ts:1648`):

```sql
CREATE TABLE IF NOT EXISTS lead_bands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = seeded default
  warm_to_rotting_days        INTEGER NOT NULL DEFAULT 14,
  cold_to_rotting_days        INTEGER NOT NULL DEFAULT 21,
  never_contacted_to_dead_days INTEGER NOT NULL DEFAULT 90,
  not_interested_to_dead_days INTEGER NOT NULL DEFAULT 180,
  resurrect_score             REAL    NOT NULL DEFAULT 0.35,
  note_fa TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id)
);
```

`resolvedLeadBands(orgId)` merges seed and tenant rows, tenant winning — the same resolution
`resolvedCapacityFactorsFor` (`lib/repo/capacityLearning.ts:145`) performs.

Defaults are deliberately conservative and are **placeholders to be tuned from real data**, not
recommendations. They are per-tenant precisely because a tenant with 3 leads behaves differently
from one with 3,000.

---

## 6. The clock

A seeded sweep rule in the existing idiom (~15 lines):

```ts
// RULE_SEED, lib/db.ts:3543
{
  code: "lead_rotting",
  name: "سرنخ در معرض پوسیدگی",
  trigger_kind: "sweep",
  action_kind: "task",
  action_json: JSON.stringify({ role_hint: "group_manager", priority: "HIGH",
                               title: "پیگیری سرنخ", kind: "call" }),
  cooldown_min: 2880,          // 2 days, same as customer_overdue
  escalate_after_min: 4320,    // 3 days
  escalate_to_role: "owner",
}
```

plus one loop inside `runSweepRules` (`lib/repo/rules.ts:273`) selecting leads whose band is
`rotting`. `liveRun` prevents a second fire; `escalateStaleRuns` raises an ignored task to
`CRITICAL` and reassigns it after `escalate_after_min`.

**The sweep may only ADD a task.** It never archives, never changes a lead, never moves a band.

---

## 7. The score (overlay, not a replacement)

`churn.ts` already implements exactly this shape for customers: features → per-tenant weights →
score → materialise → board, with `MIN_LEARN_N = 5` (`lib/repo/capacityLearning.ts:15`) refusing to
trust a model without data.

The honest constraint: `churn` trains on years of order history; `lead_visit_activities`
(`lib/repo/crm/migrate.ts:80`) is new and may be nearly empty. So:

| | Day 1 | After data accumulates |
|---|---|---|
| Says | "rotting, untouched 18 days" — a **fact** | "68% likely to buy" — an **estimate** |
| Source | `leadTemperature()` | learned model, `churnWeightsFor` template |
| Confidence | none needed | `MIN_LEARN_N` gate; below it the column is **absent** |

Features are already computed: `outcome_code`, the three star ratings, activity counts.

**Resurrection is manual (D5).** A dead lead scoring above `resurrect_score` produces a
*proposal* in the manager's queue. Only a click moves it. This is what keeps `dead` from becoming
a life sentence for someone who said "not now" in January.

A score never overrules a fact (D10): it cannot promote a lead out of `hot`.

---

## 8. The screen

Three layers, one screen — which is why all three layout options appeal:

```
┌──────────────────────────────────────────────────────────────────────┐
│ COUNTS STRIP                                                          │
│  Attention 1,550 │ Interest 186 │ Desire 31 │ Action 12 │ 🔴 47 rotting│
├──────────────────────────────────────────────────────────────────────┤
│ BAND COLUMNS (kanban, draggable)          │ RANKED WORKLIST           │
│  hot      │ warm   │ cold   │ rotting │dead│  (click a column)       │
│  ───────  │ ─────  │ ────   │ ──────  │───│  ordered by closest to  │
│  card     │ card   │ card    │ card    │   │  rotting, via            │
│  card     │ card   │ card    │         │   │  priorityScore           │
└──────────────────────────────────────────────────────────────────────┘
```

Each row: name, stage, days since last activity, owner, next action owed, `hand-set` marker, and
a score column when `MIN_LEARN_N` is met.

### 8.1 Write paths — deliberately few

| Action | Mechanism | Reversible |
|---|---|---|
| Rotting sweep | existing rules engine creates a task | yes — close the task |
| Override a band (click or drag) | closes the open task with an `outcome_note` reason | yes — toast re-PATCH, ~8s (D8) |
| Archive a dead lead | manager's explicit click | **no** — the only destructive action |
| Accept a resurrection proposal | manager's click | no |

A drag writes a **manual override**, never a direct band write — otherwise a mis-drag would
contradict the derived band and the funnel would lie. The derived band is still recomputed on every
read, so an override is a judgement about *now* and expires naturally; nothing stale to clean up.

Overrides live in `tasks` (D7), so `hand-set` derives from "is there an open override task for this
lead" — the same derivation style as `handedOff` in the companion plan. One mechanism, two uses.

---

## 9. Files

### New

| Path | Purpose |
|---|---|
| `lib/leadTemperature.ts` | `leadTemperature()` — pure, no I/O |
| `lib/repo/leadBands.ts` | `resolvedLeadBands(org)` — seed + tenant override |
| `lib/repo/leadFunnel.ts` | `leadFunnel(session, filters)` — stage × band counts, ranked rows |
| `lib/repo/leadScores.ts` | features → weights → score, gated by `MIN_LEARN_N` |
| `app/api/leads/funnel/route.ts` | `GET` — manager, org/group scoped |
| `app/api/leads/[id]/band/route.ts` | `PATCH` — override / archive / accept resurrection |
| `components/leads/LeadFunnel.tsx` | the three-layer screen |
| `components/leads/LeadBandColumn.tsx` | one draggable column |

### Modified

| Path | Change |
|---|---|
| `lib/db.ts` | `lead_bands` table; `lead_rotting` in `RULE_SEED`; the sweep loop in `runSweepRules` |
| `lib/repo/rules.ts` | one loop selecting `rotting` leads |
| `lib/appNav.ts` | funnel tab, manager-only (`isManager`) |
| `proxy.ts` | `/api/leads/funnel` reachable to managers (it is today: not driver-gated) |

### Untouched

`customers.lifecycle` and `recomputeState` (the score never writes lifecycle);
`lib/repo/churn.ts`; the delivery routing domain; `/sales/routing`.

---

## 10. Testing

| Layer | File | Covers |
|---|---|---|
| Pure | `tests/lead-temperature.test.ts` | every band boundary, precedence order, `hot` never decays, `dead` never rotates, score-gated resurrection |
| Config | `tests/lead-bands-config.test.ts` | tenant override beats seed default |
| Sweep | `tests/lead-rotting-rule.test.ts` | fires one task; `liveRun` blocks a second; `escalateStaleRuns` raises to CRITICAL; a hand-set lead is skipped |
| API | `tests/api/lead-funnel.test.ts` | cross-tenant 404; driver cannot read another group; `plain()` on every response |
| Consistency | `tests/lead-funnel-counts.test.ts` | funnel counts equal a direct `COUNT` of leads — the read cannot drift |
| UI | manual | must not 500 on a group with zero leads |

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Defaults are wrong for this market | High | Per-tenant config; tune from real data, not opinion |
| A background job moves a lead's band | Critical | Invariant D6; sweep may only add a task |
| `dead` becomes a life sentence | High | Resurrection is a manual proposal (D5) |
| Score shown before it is trustworthy | High | `MIN_LEARN_N` gate; column absent below it |
| Funnel numbers drift from reality | Medium | The consistency test in §10 |
| Drag contradicts the derived band | Medium | Drag writes an override, not a band |
| `plain()` omitted → null-prototype crash | Medium | `lib/db.ts:33`; every response |
| Overlaps the companion plan | Medium | This spec adds visibility; the plan adds the driver view. Both need `visit_outcome` written correctly |

---

## 12. Out of scope

Predicting *which* leads convert as a band input; scoring or ranking within a band; any change to
delivery routing; offline support beyond the existing `clientUuid` guard; per-driver book ranking
(deferred — the funnel is org/group scoped first).

---

## 13. Open questions for implementation

1. Should the funnel start org-wide, or be group-scoped from day one? (Group scoping is safer and
   matches `canReachGroup`; org-wide is more useful to an owner.)
2. Does a resurrected lead return to `warm`, or to the driver's run? (Companion plan's
   `handedOff` logic must not resurrect a lead that was explicitly handed to phone sales.)
