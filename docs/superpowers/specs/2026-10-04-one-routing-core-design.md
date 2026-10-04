# One routing core

**Date:** 2026-10-04
**Status:** design approved in conversation; awaiting spec review
**Part of:** a four-spec sequence, and the one that governs specs 1 and 3.

| | spec | governs |
|---|---|---|
| 1 | `2026-10-04-schedule-runs-view-design.md` | the runs view |
| 2 | `2026-10-04-facilities-and-the-place-picker-design.md` | facilities and the place picker |
| 3 | `2026-10-04-facility-stops-on-routes-design.md` | load/unload on a run |
| **4** | **this one** | **how anything computes a route** |

---

## 1. The problem, stated as a rule broken three times

The request was *one technology for these two pages*, then *use shared technologies as
much as possible*. It was made **three times**, and each time the work was scoped down to
whatever had just been noticed. The duplication was therefore never fully removed — each
sweep found the next layer.

The duplication is not three copies of a function. It is:

> **Six places are each allowed to answer "how far is this?" differently.**

That is the violation, and it is structural rather than cosmetic.

### 1.1 The six sites

`DistanceFn` is declared once, in `lib/routeOrder.ts:15`, and used as an **optional
parameter with a straight-line default** in six places across four modules:

| site | default | reached by |
|------|---------|------------|
| `routeOrder.ts:83` `routeLengthWith` | `straightLineKm` | nothing |
| `routeOrder.ts:119` `optimiseRemaining` | `straightLineKm` | nothing |
| `clusterDays.ts:92` | *(optional, no default)* | `/leads` ✅ passes the OSRM matrix |
| `clusterDays.ts:258` `clusterIntoDays` | *(optional)* | `/leads` ✅ |
| `geo.ts:104` `twoOptOrder` | `distanceKm` haversine | `/leads` ✅ *called without one* |
| `dayCapacity.ts:108`, `:197` | *(optional)* | `?view=runs` ❌ |

An optional distance with a fallback is the mechanism of the bug. **Every one of those six
can be correct and still be wrong at the call site**, because the call site decides.

### 1.2 Two of them are called by nothing at all

`lib/routeOrder.ts` is **155 lines, fully exported, fully tested** — `optimiseRemaining`,
`sortByDistanceFrom`, `routeLengthWith`, `resolveAnchor`, `isApproximate` — and **no
production code calls any of it.** `isApproximate(distanceFn)` exists to answer *"are these
real roads or a straight line?"*, which is exactly the honesty flag the other specs need.

The good version was written, tested, and then not plugged in.

### 1.3 The orders board does not order at all
## 2. What "one technology" means here

**`lib/routing/` is the only place routing logic may live, and it is the only place that may
decide what distance means.**

Four responsibilities, four modules, no overlap:

| module | owns | called by |
|--------|------|-----------|
| `distance.ts` | the one implementation of "how far" — OSRM, with a **named, explicit** fallback | both pages |
| `orderStops.ts` | **VROOM**, per decision Q1 | both pages |
| `splitIntoDays.ts` | clustering into days | both pages, with different capacity rules |
| `depot.ts` | where a day starts | both pages |

### 2.1 The rule that prevents the recurrence

> **No routing function outside `lib/routing/` may declare a `distanceFn` parameter.**

Not "should pass one" — **may not have one.** The parameter is what let six sites each hold
their own opinion. Deleting the escape hatch is what makes a fourth duplicate
unwriteable, rather than merely discouraged.

The type moves to `lib/routing/distance.ts`. `lib/routeOrder.ts`, `lib/geo.ts`,
`lib/clusterDays.ts` and `lib/dayCapacity.ts` stop exporting anything distance-shaped.

### 2.2 Distance is explicit about what it is

The fallback is not removed — offline and no-signal are real, and a driver in a tunnel needs
an answer. It is **named and labelled**:

```ts
export type DistanceQuality = "roads" | "straight-line";

export interface DistanceMatrix {
  km: number[][];
  quality: DistanceQuality;
}
```

`isApproximate` already exists in `routeOrder.ts:153` and does exactly this. It moves to
`distance.ts` and every consumer that shows a distance **shows the quality too** when it is
`straight-line` — a number that looks like kilometres and is not is the same class of lie as
the twelve-week grid this project already rejected once.

## 3. VROOM is the one orderer

Per decision Q1, `orderStops()` calls VROOM for both pages. `twoOptOrder` and
`optimiseRemaining` are deleted rather than kept as fallbacks: two surviving fallbacks is how
## 4. Clustering stays two, deliberately

`/leads` clusters geographically; `?view=runs` splits by vehicle capacity. These answer
different questions and forcing one function on both would make one worse.

What they share is the **mechanism**: both call `distance.ts` for every distance, and both
take their `origin` from `depot.ts`. `dayCapacity.byOrigin` (`:238`) is **deleted** — it is
`Math.hypot` over **degrees**, not kilometres, and it ignores the `distanceFn` it is passed.
That is a unit error, not merely a simplification.

## 5. Migration order

Each step is verifiable on its own, and each leaves the app working.

| # | step | verified by |
|---|------|-------------|
| 1 | `distance.ts` with `DistanceQuality`; `isApproximate` moves in | `isApproximate` tests still pass, moved |
| 2 | **Delete `dayCapacity.byOrigin`.** Wire the orders page through `distance.ts` | a fixture where OSRM and straight-line differ gives **different** orders by day — a test that passes under both proves nothing |
| 3 | `splitIntoDays.ts` wraps `clusterDays`; `/leads` calls it | `/leads` proposal output unchanged |
| 4 | `orderStops()` on VROOM, `greedyAssign` fallback | solver result maps to `sort_order` |
| 5 | **Delete `twoOptOrder` and the whole of `lib/routeOrder.ts`** | no imports remain |
| 6 | Both pages' optimise buttons call `orderStops()` | `/leads` output changes and is reviewed |
| 7 | `depot.ts`; both pages read their origin from it | no `is_default_origin` read outside it |

Step 7 is last because spec 2 changes what a facility is, and the origin question depends on
that landing first.

## 6. Testing

| rule | assertion |
|------|-----------|
| one distance | no routing function outside `lib/routing/` declares `distanceFn` — **a grep test**, because it is the rule that keeps being broken |
| roads are distinguishable | a fixture where OSRM ≠ straight-line produces **different** clustering |
| the orderer is the solver | `orderStops` calls VROOM, and degrades to `greedyAssign` and *says so* |
| both pages agree | the same stops through either page produce the same order |
| no dead orderers | `twoOptOrder` and `optimiseRemaining` do not exist |

## 7. Scope

**In:** the four modules; deletion of `byOrigin`, `twoOptOrder`, `lib/routeOrder.ts`;
migrating both pages; the `distanceFn`-outside-routing ban; distance quality labelling.

**Out:** spec 1's page, spec 2's facilities, spec 3's reconciliation. VROOM **deployment**
is out of scope — this spec makes the app correct whether or not `VROOM_URL` is set, and says
so out loud when it is not.

## 8. Risks

- **`VROOM_URL` is unset today**, so `solveVroom` returns null and every run would silently
  fall back to greedy. The fallback is fine; **silence is not.** The card must show which
  algorithm ordered it.
- **`/leads` output will change.** Real roads and a real solver produce different routes.
  Managers who learned the old order will notice, and that is the point — but it should be
  announced, not discovered.
- **Step 2 changes which day an order lands on**, for the same reason. Some existing plans
  will differ. This is a correctness fix, delivered as a visible change.
- **VROOM is untested glue** (`vroom.ts:202`, its own comment). The first implementation is
  the first test, and `applyVroomSolution` — pure and already reliable — is what to trust.
- **Six call sites is more than this spec's estimates suggest.** If step 5 finds an importer
  the sweep missed, the ban in §2.1 is what makes it findable: it is a grep, not an audit.
there got to three orderers.

**What VROOM needs, verified in the source:**

- `vroom.ts:202` reads `process.env.VROOM_URL` and **returns null on failure**. It is glue,
  and its own comment says *"Not unit-tested."*
- **`buildVroomJob` emits deliveries only.** It maps `deliveries.map(...)` to jobs and its
  matrix comment fixes `row/col 0 = the depot` — so a depot exists, but **a pickup is not
  built yet.** Supporting spec 3's load as a native VROOM pickup means extending
  `buildVroomJob` to emit `pickup`/`delivery` job pairs, which is a real change to tested
  code and **is out of scope here**. Spec 3 therefore keeps the load as its own table row,
  and `orderStops()` orders the *delivery* stops around a depot.
- `applyVroomSolution` returns `sort_order` per delivery, so a solver result maps onto
  `delivery_stops.sort_order` without a second ordering pass.

**The fallback is `greedyAssign` in the same module** (`vroom.ts:138`), not `twoOptOrder` —
one orderer in one place, with its own degradation, rather than a second algorithm in another
file. A run ordered by greedy nearest-first **says so on the card**, because
`DistanceQuality` makes the difference visible.

### 3.1 Both pages call it

`/leads`'s "optimise the route" button (`useLeads.ts:205`, `twoOptOrder` → `orderStops`) and
the runs view's per-lane ordering both go through `orderStops()`. **This will visibly change
`/leads` output** — better routes, different order — and that is recorded as a risk, not
slipped in.

`DaySplitPanel` returns **zero hits** for `sort`, `matrix`, `optimise`, `twoOpt` or
`routeOrder`. The sequence of stops inside a lane is whatever order the database returned —
**insertion order, not route order.** `/leads` has had an optimise button all along.

So the two pages differ in three separate ways at once: where distances come from, whether
stops are ordered, and which algorithm does it.

### 1.4 Three orderers

| orderer | where | used by |
|---------|-------|---------|
| `twoOptOrder` | `lib/geo.ts:104` | `/leads` |
| `optimiseRemaining` | `lib/routeOrder.ts:117` | **nothing** |
| `greedyAssign` + `solveVroom` | `lib/routing/vroom.ts:138,202` | **nothing** |

`vroom.ts:202` is explicitly labelled *"Glue — env `VROOM_URL`, null on failure. Not
unit-tested."* A real solver exists and is unwired.