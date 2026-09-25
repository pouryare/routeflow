# Lead Decay Clock + Funnel — Design Spec

**Date:** 2026-09-25 · **Status:** Approved (brainstorming)
**Scope:** Manager-facing lead health — one derived function feeding a decay clock and a funnel view.
**Companion plan:** `implementation_plan.md` (repo root) — the adaptive `/leads` driver work.

**These two documents are one feature split across a boundary, and the order matters.** The
dependency is hard, not stylistic:

```
implementation_plan.md                  2026-09-25-lead-decay-and-funnel-design.md
──────────────────────                  ────────────────────────────────────────────
Phase 2  fix leadVisitFlow          ──▶  reads visit_outcome
         (remove the dead convert step)     to compute stage + band
Phase 3  conversion by first purchase
Phase 4  lead_runs + driver access  ──▶  sweeps the same runs
Phase 5  driver view                    (rotting ⇒ the driver needs a route)
```

* **Plan first.** The funnel has nothing to show until `visit_outcome` is written correctly, and
  the decay clock has nothing to sweep until `lead_runs` exists.
* **Spec second.** It adds the manager's *visibility* onto data the plan makes trustworthy.

Building the funnel first would render a funnel of zeroes — or worse, of wrong numbers, because
`leadVisitFlow` currently discards the driver's answer to the convert step. That is the specific
failure this ordering prevents.

Both are committed together in `43deda0` and should be implemented as one sequence.

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

## 13. Resolved

1. **Group-scoped from day one.** Matches `canReachGroup`, and an owner can widen later — the
   reverse (org-wide first) cannot safely be narrowed without a data leak. The seed-vs-tenant
   merge in §5 is the same widening pattern.
2. **A resurrected lead returns to the driver's run**, with one guard that must be explicit:

   > A resurrected lead is re-assigned to a run **unless it has an open handoff task**. Phone
   > sales keeps it, because the handoff was a deliberate routing decision by a human and is more
   > recent than the decay that made it look dead.

   Without the guard, resurrection silently pulls a lead back from the person who was already
   asked to call it — reintroducing exactly the driver↔phone-sales ping-pong this feature exists
   to end. Implementation reads `handedOff` from the companion plan; the two are one mechanism.

---

## 14. UI — approved layouts

Three screens were mocked and approved in review. All three are manager-or-driver scoped, and
all reuse the existing `meridian` tokens, the RTL shell, and `<SyncStatus />` (already rendered
by `/driver`) for the offline state.

### 14.1 Manager — the funnel is a filter, not a mode

Approved: **the combined layout.** A literal AIDA funnel shape is pinned at the top of the page
as a permanent gauge; the band columns sit below it. **Clicking a stage filters the columns**
rather than switching modes.

```
┌────────────────────────────────────────────────────────────────┐
│  funnel, always visible, clickable                             │
│   توجه ۱٬۵۵۰ → علاقه ۲۸۰ (۱۸٪) → تمایل ۳۱ (۱۱٪) → اقدام ۱۲    │
├────────────────────────────────────────────────────────────────┤
│  band chips:  داغ ۹ · گرم ۱۴۲ · سرد ۸۲ · پوسیده ۴۷             │
├────────────────────────────────────────────────────────────────┤
│  columns, scoped to the selected stage: hot │ warm │ cold │ …   │
└────────────────────────────────────────────────────────────────┘
```

**Why not a mode toggle.** The two candidate layouts answer different questions — the funnel
shape answers "is the pipeline healthy?", the columns answer "which lead do I act on?". A toggle
makes each mode show half the picture and requires a switch to answer the other half. Filtering
answers both on one screen with no state change.

**Why the funnel must be pinned.** The 47 rotting leads are currently invisible, which is the
mechanism of failure #1. In this layout that number is on screen at all times, whatever stage is
selected.

### 14.2 Manager — placement

The funnel is a **section of the manager's `/leads` page, below the pool** — not a separate route.
Drivers start using `/leads` in the companion plan, so a second route is a second place to look,
and the pool is what a manager opens `/leads` *to* do. It must not be pushed down the page.

### 14.3 Driver — rich next-stop card + collapsible day

Approved: **the third layout.** The top of the screen carries everything needed *while standing
at the door*:

```
┌────────────────────────────────────────┐
│ ۱۲ آبان · ۸:۴۲            ● آفلاین    │
│ توقف ۳ از ۸ · ۴٫۲ کیلومتر             │
│ هتل آریا                                │
│ تهران، خیابان ولیعصر، پلاک ۱۲۰          │
│ ┌─ دفعهٔ قبل — ۶ روز پیش ─────────┐   │
│ │ صاحبش نبود · امتیاز ۳/۲/۲      │   │
│ └────────────────────────────────┘   │
│ ┌─ ⚠ تماس فروش انجام نشده — ۴ روز ─┐   │
│ └────────────────────────────────┘   │
│ [ شروع مسیریابی ]                     │
│ [ رسیدم — ثبت نتیجه ]                 │
│ ▾ بقیهٔ امروز — ۵ توقف                 │
└────────────────────────────────────────┘
```

Two of these blocks are new information that exists nowhere today:

- **Last visit's outcome and star ratings** — so the driver does not walk in blind.
- **The undelivered-call warning** — the driver is standing at the business that call was about.
  This is failure #1 surfaced at the only moment someone can act on it. No manager screen fixes
  it; this does.

**Handed-off leads stay visible, struck through, labelled `→ فروش تلفنی`.** They leave the
driver's *ownership* (D-resolved §13) but not their *sight*. Silent removal is precisely the
"the app is broken" feeling, and the driver would see stops vanishing with no explanation.

### 14.4 Driver — tap budget

The ≤5-tap rule was **dropped as a design constraint** for this screen. `leadVisit` already
declares `budget: { common: 6, longest: 11 }` — above 5, because it is a capture flow and
`docs/tap-flow-principles.md` §4 allows 7/12 for those. `tests/crm-flow-configs.test.ts:24`
walks every branch and holds each flow to its *declared* budget. So the budget is a contract on
the flow config, not a constraint on the page, and the page is free to carry more context.

### 14.5 Driver — on-the-spot sale: full order capture

Approved: **option A.** The driver picks products and packs and registers the sale. Two backend
gates must open:

- `GET /api/sales/products` — currently `["owner","group_manager","salesperson"]`
- `POST /api/sales/orders` — `CAN_SELL` is the same three

Neither admits a `driver` today, so an on-the-spot sale is not recordable by anyone. See §15.

---

## 15. Commission — resolved, and smaller than expected

**Domain fact (from review):** the `driver` role is *both* the field sales rep and the delivery
driver — one person. This is why the field rep closes the order *and* why the commission work was
requested.

**Consequence — the apparent gap closes itself.** Accrual keys on **delivered weight**
(`lib/commissionLedger.ts:129`, *"Every delivered order credited to a person inside a period"*).
Because the same person sells and delivers, the existing per-kg accrual already pays them for
the whole order. **No accrual rule change is needed.** Splitting the two roles later is the event
that would force one, and it is deliberately not pre-built.

### 15.1 Confirmed

| Rule | Implementation | New schema |
|---|---|---|
| Commission is for **orders only** | existing per-kg accrual on delivered weight | none |
| **Converting** a lead earns nothing | conversion writes `customers` + an `activities` row only | none |
| **Adding** a lead earns nothing | same | none |
| A person may earn **zero** | `rate_per_kg_toman = 0` is valid — `isToman` is `Number.isInteger` (`lib/money.ts:55`) | none |

**No new commission table. No new accrual type. No general rate engine.**

### 15.2 One real defect found

`lib/driverCommissionLedger.ts:161`:

```ts
const perKg = rate?.rate_per_kg_toman ?? 0;
```

An **unset** rate and a **deliberately zero** rate both resolve to `0` and are indistinguishable
in the statement. A manager looking at a driver earning nothing cannot tell "we set this to
zero" from "we never set a rate". Fix: keep `?? 0` for the arithmetic, but carry the distinction
into the statement row so the UI can show *صفرِ عمدی* against *نرخ ثبت نشده*.

### 15.3 Explicitly deferred

The generalized rate engine (percentage / flat / per-size / per-action / per-product, per person)
is **not built**. Three of the four cases already exist:

| Case | Exists as |
|---|---|
| percentage | `manager_commission_overrides.override_pct` |
| per-product | per-kg resolved through `products.kg_per_base_unit` |
| per-action | `urgent_rate_per_kg_toman` — same action, different rate |
| per-person | `salesperson_user_id` / `driver_user_id` keyed, effective-dated |

Only *flat* is absent, and no current rule needs it. Building a rate engine to express cases that
are already covered is speculative work on **payroll** code, where the file's own comment warns
that accrual is derived and restatable while payment is a fact (`lib/db.ts:1252`). Revisit when a
second role exists, or when a real rule needs flat.
