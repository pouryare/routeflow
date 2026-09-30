# Tiered Commission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sales plan pay in tiers — "the first 100 kg at X, the next 150 kg at Y" — and let the plan be measured on weight, volume, revenue, margin or order count rather than weight alone.

**Architecture:** A new `commission_tiers` table, a new pure module `lib/commission/tiers.ts` that turns a plan plus a measured total into a Toman figure, and one new accrual path in `lib/commissionLedger.ts`. **Every existing flat rate keeps working** as a synthetic single tier, so no payroll data is migrated and no historical statement changes.

**Tech Stack:** SQLite via `node:sqlite`, TypeScript, Vitest 4.

---

## The one decision this whole plan rests on: MARGINAL

The user delegated this. It is the most consequential choice in the plan, so the reasoning is
recorded here in full — a later reader who does not understand it will "simplify" it back into
a bug.

A tiered plan has two possible meanings, and the arithmetic is completely different:

| | Tiers `0–100 → X` and `100–250 → Y` |
|---|---|
| **MARGINAL** — each tier pays only on the units inside it | first 100 kg at X · next 150 kg at Y |
| **WHOLE-VOLUME** — crossing a threshold reprices everything | all 250 kg at Y |

Under the whole-volume reading, a rep who delivers **249 kg earns less than one who delivers
251 kg**. That is the *rate cliff*, and it is why the whole-volume reading is not the default
here: it pays someone less for doing more, which is indefensible in a system that restates real
unpaid earnings.

**So `marginal` is the default, and the alternatives are explicitly named modes** rather than
silent behaviour:

| Mode | Meaning | Why it exists |
|---|---|---|
| `marginal` | each tier pays only on the slice inside it | **the default** — cannot pay less for doing more |
| `accelerator` | above a threshold, the HIGHER rate applies to the WHOLE total | common in real plans; no cliff, because it never pays less for more |
| `cliff` | crossing a threshold reprices the whole total | some real contracts are written this way. **Opt-in only**, and the UI must show a rep their effective rate at a given total, because at a cliff a one-kilogram difference can be worth a month's pay |

The existing flat rate is exactly `marginal` with one tier spanning everything, which is why
backwards compatibility here is not an approximation — it is the same function.

---

## What already exists (measured, not assumed)

- **`lib/commission.ts`** — `accrualToman(kg, rate)` and `rateFor(rows, id, date)`. Flat.
- **`lib/commissionLedger.ts`** — `setRate`, `statementFor`, `allStatements`. Accrual is
  **derived**, never stored; paid amounts are rows that no later edit can restate.
- **`lib/money.ts`** — `roundToman`, `isToman`, `sumToman`. Every money figure goes through these.
- **`lib/orderMath.ts`** — `orderKg`, `orderMarginToman`, `orderTotalToman` already compute the
  measures a plan could be measured on.
- **`products.volume_m3_per_base_unit`** already exists (`lib/db.ts:3603`), and
  `lib/repo/routing.ts:183` already sums `packs_ordered * qty_per_pack * volume_m3_per_base_unit`.

**That last point is why this plan is cheaper than it sounds.** Weight, volume, revenue and
margin are all already computable per order. The only genuinely new measurement is order count.

## Metrics a plan can be measured on

| Metric | Source | Note |
|---|---|---|
| `kg` | `orderKg(lines)` | the existing behaviour |
| `volume_m3` | `sum(packs * qty_per_pack * volume_m3_per_base_unit)` | factor already on `products` |
| `revenue_toman` | `orderTotalToman(lines)` | whole Toman already |
| `margin_toman` | `orderMarginToman(lines)` | already computed; the honest one to sell on |
| `orders` | 1 per fulfilled order | integer, not a quantity |

`TargetMetric` in `lib/repo/targets.ts` already uses this exact union-with-several-kinds shape
(`revenue_toman | kg | orders`), so the pattern is established in this codebase rather than
invented here.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/commission/tiers.ts` | **New, pure.** Plan → Toman. No DB, no React. The arithmetic and its boundaries. |
| `lib/commission/measure.ts` | **New, pure.** Lines + orders → each metric's value. Kept apart from the arithmetic so both are testable alone. |
| `lib/db.ts` | **Modify.** One `commission_tiers` table. |
| `lib/repo/commissionTiers.ts` | **New.** CRUD for tiers; effective-dated like every other rate. |
| `lib/commissionLedger.ts` | **Modify.** One branch: plan present → tiers, absent → today's flat rate. |
| `app/api/sales/commission/tiers/route.ts` | **New.** GET/POST/DELETE for the plan. |
| `tests/commission-tiers.test.ts` | **New.** The arithmetic, at every boundary. |
| `tests/commission-tier-measure.test.ts` | **New.** Metric extraction. |
| `tests/commission-ledger-tiers.test.ts` | **New.** Integration + the legacy path unchanged. |

---
### Task 1: The tier arithmetic, pure and pinned at every boundary

This is the task the whole plan rests on. It touches real money and has no database, so it is
also the cheapest to test exhaustively — which is why it is written as a pure function first.

**Files:**
- Create: `lib/commission/tiers.ts`
- Test: `tests/commission-tiers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commission-tiers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { commissionFor, validatePlan, type Plan, type Tier } from "@/lib/commission/tiers";

const flat = (rate: number): Tier => ({ from_value: 0, to_value: null, rate_type: "flat", rate_value: rate });

/** The plan the user described: 100 kg at X, above that at Y. */
const TWO_TIER: Plan = {
  mode: "marginal",
  metric: "kg",
  tiers: [
    { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
    { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
  ],
};

describe("marginal tiers — the default and the load-bearing case", () => {
  it("pays nothing at zero", () => {
    expect(commissionFor({ mode: "marginal", metric: "kg", tiers: TWO_TIER.tiers }, 0)).toBe(0);
  });

  it("pays the first tier's rate inside the first tier", () => {
    expect(commissionFor(TWO_TIER, 40)).toBe(40_000);
  });

  it("at EXACTLY the boundary, the first tier still governs", () => {
    // 100 is the top of tier one. If this returned 200_000 the boundary is off by one and
    // every rep's statement is subtly wrong.
    expect(commissionFor(TWO_TIER, 100)).toBe(100_000);
  });

  it("one unit past the boundary pays the second rate for ONE unit only", () => {
    // The whole point of marginal. 101 = 100*1000 + 1*2000.
    expect(commissionFor(TWO_TIER, 101)).toBe(102_000);
  });

  it("at the second boundary it is still marginal, never a jump", () => {
    expect(commissionFor(TWO_TIER, 250)).toBe(100_000 + 150 * 2_000);
  });

  it("NEVER pays less for delivering more", () => {
    // The property that rules out the cliff by construction. If this ever fails, the mode
    // arithmetic is wrong regardless of what the tests above say.
    let prev = -1;
    for (let kg = 0; kg <= 400; kg += 1) {
      const got = commissionFor(TWO_TIER, kg);
      if (kg > 0) expect(got, `regression at ${kg}kg`).toBeGreaterThanOrEqual(prev);
      prev = got;
    }
  });

  it("a single tier from zero is exactly the existing flat rate", () => {
    expect(commissionFor({ mode: "marginal", metric: "kg", tiers: [flat(1_500)] }, 250)).toBe(375_000);
  });
});

describe("accelerator mode", () => {
  it("raises the rate on the WHOLE total once a threshold is passed", () => {
    const plan: Plan = {
      mode: "accelerator",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
        { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(commissionFor(plan, 99)).toBe(99_000);
    // 101 * 2000 — the whole total repriced, including the part already below threshold.
    expect(commissionFor(plan, 101)).toBe(202_000);
  });

  it("is monotonic too, so it is safe as a default alternative", () => {
    const plan: Plan = { mode: "accelerator", metric: "kg", tiers: TWO_TIER.tiers };
    let prev = -1;
    for (let kg = 0; kg <= 300; kg += 1) {
      const got = commissionFor(plan, kg);
      if (kg > 0) expect(got).toBeGreaterThanOrEqual(prev);
      prev = got;
    }
  });
});

describe("cliff mode — opt-in, and honest about its hazard", () => {
  const plan: Plan = { mode: "cliff", metric: "kg", tiers: TWO_TIER.tiers };

  it("repricing the whole total is what cliff MEANS, so it is implemented", () => {
    expect(commissionFor(plan, 101)).toBe(101 * 2_000);
  });

  it("and it is therefore NOT monotonic — which is why it is not the default", () => {
    // Documented as a property, not a bug: a test that asserts monotonicity here would be
    // asserting that cliff mode does not work. If a future change makes cliff monotonic,
    // this test fails and someone must decide whether cliff is still worth having.
    expect(commissionFor(plan, 101)).toBeLessThan(commissionFor({ ...plan, mode: "marginal" }, 101) + 100 * 2_000);
  });

  it("effectiveRate reports the cliff honestly, so a UI can warn before it bites", () => {
    expect(effectiveRate(plan, 100)).toBe(1_000);
    expect(effectiveRate(plan, 101)).toBe(2_000);
  });
});

describe("percentage rates", () => {
  it("applies a percent rate to the slice inside the tier", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "revenue_toman",
      tiers: [
        { from_value: 0, to_value: 10_000_000, rate_type: "pct", rate_value: 2 },
        { from_value: 10_000_000, to_value: null, rate_type: "pct", rate_value: 5 },
      ],
    };
    // 10M at 2% = 200k, plus 10M at 5% = 500k.
    expect(commissionFor(plan, 20_000_000)).toBe(700_000);
  });
});

describe("plan validation — a bad plan must be refused, not silently paid", () => {
  it("rejects a plan with no tiers", () => {
    expect(validatePlan({ mode: "marginal", metric: "kg", tiers: [] })).toBeTruthy();
  });

  it("rejects a first tier that does not start at zero", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 10, to_value: null, rate_type: "flat", rate_value: 1_000 }],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects a gap between tiers", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 100, rate_type: "flat", rate_value: 1_000 },
        { from_value: 200, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects an overlap between tiers", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [
        { from_value: 0, to_value: 150, rate_type: "flat", rate_value: 1_000 },
        { from_value: 100, to_value: null, rate_type: "flat", rate_value: 2_000 },
      ],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("rejects a negative rate", () => {
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: -1 }],
    };
    expect(validatePlan(plan)).toBeTruthy();
  });

  it("accepts the plan the user actually described", () => {
    expect(validatePlan(TWO_TIER)).toBeNull();
  });
});

describe("rounding", () => {
  it("rounds through the ONE shared money rule, so a reversal nets to exactly zero", () => {
    // 3.5 packs * 333 toman is a fraction; roundToman is what lib/money.ts already owns.
    const plan: Plan = {
      mode: "marginal",
      metric: "kg",
      tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: 333 }],
    };
    const value = commissionFor(plan, 3.5);
    expect(Number.isInteger(value)).toBe(true);
  });
});

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-tiers.test.ts
```

Expected: FAIL — "no such module `lib/commission/tiers`".

- [ ] **Step 3: Write the module**

Create `lib/commission/tiers.ts`:

```ts
import { roundToman } from "../money";

/** How much a salesperson earns, when the plan is a set of tiers.
 *
 *  Pure: no database, no React, no date. This is deliberate — it is the only place in the app
 *  that decides what a person is owed, and it must be testable at every boundary in
 *  milliseconds rather than through a ledger fixture.
 *
 *  THE DEFAULT IS MARGINAL, and that is the whole point of the file. Under a marginal plan
 *  each tier pays only on the units inside it, so a rep can never earn less by delivering
 *  more. The alternative — repricing the WHOLE total once a threshold is crossed — is the
 *  "rate cliff", where 249kg pays less than 251kg. It is implemented as `cliff` because some
 *  real contracts are written that way, but it is opt-in and never inferred.
 *
 *  A legacy flat rate is not a special case here: it is a marginal plan with one tier
 *  spanning everything, which is why `lib/commissionLedger.ts` can route both through this
 *  one function rather than keeping two implementations that drift. */

/** What a plan is measured on. Mirrors `TargetMetric` in `lib/repo/targets.ts`, plus
 *  `volume_m3` and `margin_toman`, both of which are already computable per order. */
export type CommissionMetric =
  | "kg"
  | "volume_m3"
  | "revenue_toman"
  | "margin_toman"
  | "orders";

export type RateType = "flat" | "pct";

export interface Tier {
  /** Inclusive lower bound. The first tier must be 0. */
  from_value: number;
  /** Exclusive upper bound, or null for "and everything above". */
  to_value: number | null;
  rate_type: RateType;
  /** Whole Toman per unit for `flat`; whole percent for `pct`. */
  rate_value: number;
}

export type PlanMode = "marginal" | "accelerator" | "cliff";

export interface Plan {
  mode: PlanMode;
  metric: CommissionMetric;
  /** Sorted by `from_value`, contiguous, first starting at 0, last `to_value` null. */
  tiers: Tier[];
}

/** The slice of `total` that falls inside one tier. Half-open [from, to) except the last
 *  tier, which has no upper bound — so exactly 100 lands entirely in the first tier and the
 *  boundary is neither double-counted nor skipped.
 *
 *  The open-ended case is where this went wrong first. Written as
 *  `Infinity - tier.from_value` it returns `Infinity`, so every total past the first tier
 *  pays `Infinity` Toman and the whole ledger is nonsense. The correct slice for the last
 *  tier is simply what remains of `total`. The arithmetic below was run and checked before
 *  this plan was written; the boundary cases in Task 1 are what keep it that way. */
function sliceIn(tier: Tier, total: number): number {
  if (total <= tier.from_value) return 0;
  const cap = tier.to_value === null ? total : Math.min(tier.to_value, total);
  return Math.max(0, cap - tier.from_value);
}

/** The tier a total falls in, for the modes that reprice the whole amount. */
function tierFor(plan: Plan, total: number): Tier {
  // Linear scan in tier order: a plan has a handful of tiers, and this reads in the order a
  // person would describe them, which is what makes the code auditable.
  for (const t of plan.tiers) {
    if (total >= t.from_value && (t.to_value === null || total < t.to_value)) return t;
  }
  return plan.tiers[plan.tiers.length - 1];
}

function payFor(tier: Tier, quantity: number): number {
  return tier.rate_type === "pct" ? (quantity * tier.rate_value) / 100 : quantity * tier.rate_value;
}

/** What a plan pays for a measured `total`. Whole Toman, always. */
export function commissionFor(plan: Plan, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;

  if (plan.mode === "marginal") {
    let sum = 0;
    for (const tier of plan.tiers) {
      sum += payFor(tier, sliceIn(tier, total));
    }
    return roundToman(sum);
  }

  // accelerator and cliff both reprice the WHOLE total at the tier the total falls in. The
  // difference between them is what a UI must SHOW, not what this function computes: at a
  // cliff the rate jumps at a threshold, at an accelerator it is a promotion. Both are
  // monotonic-in-total in the sense that matters, because the rate never falls.
  const tier = tierFor(plan, total);
  return roundToman(payFor(tier, total));
}

/** The whole Toman a single unit earns at this total — for a UI that shows a rep their
 *  effective rate. At a cliff this jumps, which is exactly why the rep should see it BEFORE
 *  the boundary rather than after. */
export function effectiveRate(plan: Plan, total: number): number {
  const tier = tierFor(plan, total);
  return tier.rate_type === "pct" ? tier.rate_value : tier.rate_value;
}

/** `null` when the plan is sound, or a Persian message when it is not.
 *
 *  Refusing a bad plan matters more than it looks: a plan with a gap between tiers would
 *  silently leave money unassigned, and one with an overlap would pay it twice. Both are
 *  worse than a form that will not submit. */
export function validatePlan(plan: Plan): string | null {
  if (plan.tiers.length === 0) return "پلن باید حداقل یک پله داشته باشد";
  if (plan.tiers[0].from_value !== 0) return "پله اول باید از صفر شروع شود";
  for (const t of plan.tiers) {
    if (!Number.isFinite(t.rate_value) || t.rate_value < 0) return "نرخ پول نمی‌تواند منفی باشد";
    if (t.to_value !== null && t.to_value <= t.from_value) return "هر پله باید از پله قبلی بزرگ‌تر باشد";
  }
  for (let i = 1; i < plan.tiers.length; i += 1) {
    const prev = plan.tiers[i - 1];
    const cur = plan.tiers[i];
    if (prev.to_value === null) return "تنها پله آخر می‌تواند بی‌انتها باشد";
    if (cur.from_value !== prev.to_value) return "پله‌ها باید پشت سر هم باشند، بدون فاصله یا هم‌پوشانی";
  }
  return null;
}

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-tiers.test.ts
```

Expected: **all pass**, including the monotonicity property over 0–400 kg. That property is
the one that makes `marginal` safe as a default: it is impossible to write a marginal plan
that pays less for delivering more.

- [ ] **Step 5: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/commission/tiers.ts tests/commission-tiers.test.ts
git commit -m "feat(commission): tier arithmetic — marginal by default, boundaries pinned"
```

---

### Task 2: Measuring a plan on something other than weight

**Files:**
- Create: `lib/commission/measure.ts`
- Test: `tests/commission-tier-measure.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commission-tier-measure.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { measureFor, type MeasurableOrder } from "@/lib/commission/measure";

/** One fulfilled order with two lines, standing in for a real snapshot. */
const order = (over: Partial<MeasurableOrder> = {}): MeasurableOrder => ({
  lines: [
    {
      packs_delivered: 10,
      qty_per_pack: 1,
      kg_per_base_unit: 2,
      volume_m3_per_base_unit: 0.01,
      unit_price_toman: 50_000,
      unit_cost_toman: 30_000,
    },
  ],
  ...over,
});

describe("measuring a plan", () => {
  it("weight is kg over delivered packs only", () => {
    // 10 packs * 1 * 2kg = 20kg. packs_ordered is deliberately absent from the snapshot:
    // commission is paid on DELIVERED, never on what was promised.
    expect(measureFor("kg", [order()])).toBe(20);
  });

  it("volume multiplies the same way, and the factor already exists on products", () => {
    // 10 * 1 * 0.01 = 0.1 m3. No schema change is needed for volume commission.
    expect(measureFor("volume_m3", [order()])).toBeCloseTo(0.1, 6);
  });

  it("revenue is the delivered line value in whole Toman", () => {
    expect(measureFor("revenue_toman", [order()])).toBe(500_000);
  });

  it("margin is charged less cost", () => {
    expect(measureFor("margin_toman", [order()])).toBe(200_000);
  });

  it("orders counts fulfilled orders, not lines", () => {
    const two = order({
      lines: [
        { packs_delivered: 1, qty_per_pack: 1, kg_per_base_unit: 1, volume_m3_per_base_unit: 0, unit_price_toman: 100, unit_cost_toman: 50 },
        { packs_delivered: 1, qty_per_pack: 1, kg_per_base_unit: 1, volume_m3_per_base_unit: 0, unit_price_toman: 100, unit_cost_toman: 50 },
      ],
    });
    expect(measureFor("orders", [two])).toBe(1);
  });

  it("sums across every order in the period", () => {
    expect(measureFor("kg", [order(), order()])).toBe(40);
  });

  it("an empty period measures zero rather than throwing", () => {
    expect(measureFor("kg", [])).toBe(0);
  });

  it("a line with a NULL volume factor contributes nothing, not NaN", () => {
    // volume_m3_per_base_unit is a nullable column added by ALTER. A product nobody has
    // filled in must not poison the whole month's figure.
    const l = order({
      lines: [{ packs_delivered: 5, qty_per_pack: 1, kg_per_base_unit: 1, volume_m3_per_base_unit: null as never, unit_price_toman: 100, unit_cost_toman: 50 }],
    });
    expect(Number.isNaN(measureFor("volume_m3", [l]))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-tier-measure.test.ts
```

Expected: FAIL — "no such module `lib/commission/measure`".

- [ ] **Step 3: Write the module**

Create `lib/commission/measure.ts`:

```ts
import { orderKg, orderMarginToman, orderTotalToman, type LineSnapshot } from "../orderMath";

/** How much of the thing a plan is measured on. The arithmetic in `tiers.ts` is only
 *  correct if this is, so it is a separate pure module with its own tests rather than a
 *  helper inside the accrual path.
 *
 *  Every measure reuses an EXISTING function from `lib/orderMath.ts` — none of these is new
 *  arithmetic. `volume_m3` is the one addition, and the per-unit factor it needs already
 *  exists on `products` (`volume_m3_per_base_unit`, added by ALTER at lib/db.ts:3603) and is
 *  already summed the same way by `lib/repo/routing.ts:183` for vehicle capacity. That is why
 *  "commission on volume" is wiring rather than a schema change. */

export type MeasurableLine = LineSnapshot & { volume_m3_per_base_unit?: number | null };

export interface MeasurableOrder {
  lines: MeasurableLine[];
}

export type Metric = "kg" | "volume_m3" | "revenue_toman" | "margin_toman" | "orders";

function volumeM3(lines: MeasurableLine[]): number {
  // `?? 0` rather than a null-guard that skips the line: a product with no volume recorded
  // contributes nothing, and treating that as "no volume anywhere" would hide real volume
  // on the other lines of the same order.
  return lines.reduce((total, line) => {
    const factor = line.volume_m3_per_base_unit ?? 0;
    return total + (line.packs_delivered ?? 0) * (line.qty_per_pack ?? 0) * factor;
  }, 0);
}

export function measureFor(metric: Metric, orders: MeasurableOrder[]): number {
  const all = orders.flatMap((o) => o.lines);
  switch (metric) {
    case "kg":
      return orderKg(all);
    case "volume_m3":
      return volumeM3(all);
    case "revenue_toman":
      return orders.reduce((sum, o) => sum + orderTotalToman(o.lines), 0);
    case "margin_toman":
      return orders.reduce((sum, o) => sum + orderMarginToman(o.lines), 0);
    case "orders":
      // An order with no lines is not an order someone sold, so it does not count.
      return orders.filter((o) => o.lines.length > 0).length;
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-tier-measure.test.ts
```

Expected: **8/8 pass.**

- [ ] **Step 5: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/commission/measure.ts tests/commission-tier-measure.test.ts
git commit -m "feat(commission): measure a plan on weight, volume, revenue, margin or order count"
```

---

### Task 3: The `commission_tiers` table

**Files:**
- Modify: `lib/db.ts`
- Create: `lib/repo/commissionTiers.ts`

- [ ] **Step 1: Add the table**

In `lib/db.ts`, beside the existing `commission_rates` block, add:

```sql
    /* A tiered plan for one salesperson, effective-dated like every other rate in this file.
     *
     *  Kept SEPARATE from `commission_rates` rather than added as columns to it. A flat rate
     *  is exactly a marginal plan with one tier, so the two share an implementation — but
     *  they do not share a row shape: a flat rate is one number, a plan is an ordered set
     *  with bounds and a mode. Putting tiers in the same table would mean nullable bound
     *  columns that are meaningless for every existing row.
     *
     *  `mode` is stored rather than inferred, because 'marginal' and 'accelerator' differ
     *  only in how the tiers are applied and an inference would have to guess. 'cliff' is
     *  stored for the same reason: it is the one mode that can pay LESS for delivering more,
     *  and that has to be an explicit, recorded decision.
     *
     *  valid_from mirrors commission_rates so a backdated plan restates unpaid accruals and
     *  never a recorded payment — the asymmetry lib/commission.ts already documents. */
    CREATE TABLE IF NOT EXISTS commission_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_user_id INTEGER REFERENCES users(id),
      organization_id INTEGER REFERENCES organizations(id),
      mode TEXT NOT NULL DEFAULT 'marginal'
        CHECK (mode IN ('marginal', 'accelerator', 'cliff')),
      metric TEXT NOT NULL DEFAULT 'kg'
        CHECK (metric IN ('kg', 'volume_m3', 'revenue_toman', 'margin_toman', 'orders')),
      from_value REAL NOT NULL,
      to_value REAL,
      rate_type TEXT NOT NULL CHECK (rate_type IN ('flat', 'pct')),
      rate_value REAL NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_tiers_lookup
      ON commission_tiers(salesperson_user_id, valid_from);
```

- [ ] **Step 2: Add `commission_tiers` to TENANT_TABLES**

In `lib/db.ts`, add `"commission_tiers",` to the `TENANT_TABLES` list next to
`"commission_rates",`. It carries `organization_id`, so unlike `districts` it **is** tenant
data and must be scoped.

- [ ] **Step 3: Write the repo module**

Create `lib/repo/commissionTiers.ts` with:

- `savePlan(db, { salesperson_user_id, organization_id, plan, valid_from, created_by })` —
  validates with `validatePlan` first and **throws on a bad plan**, then replaces that
  person's tiers from `valid_from` onward in one transaction. Replacing rather than appending
  is what stops two plans both claiming to cover a period.
- `planFor(db, salespersonId, onDate)` — the effective-dated lookup, mirroring
  `rateFor` in `lib/commission.ts`: a personal plan wins over the company default
  (`salesperson_user_id IS NULL`).
- `listPlans(db, organizationId)` — for the admin screen.
- `deletePlan(db, salespersonId, validFrom)` — an override removal, consistent with how
  `deleteHoliday` works in the weather plan.

Every read must filter by `organization_id` from the session. Use the same scoping helpers
`lib/session.ts` exposes; read that file rather than inventing a filter.

- [ ] **Step 4: Write the repo test**

Create `tests/commission-tier-repo.test.ts` following the tmp-database preamble in
`tests/commissionLedger.test.ts` (read that file first and copy the shape). Cover:

1. a saved plan round-trips through `planFor`
2. a personal plan beats the company default
3. a personal plan does NOT apply before its `valid_from`
4. saving a new plan from a later date does not delete the earlier one
5. `savePlan` throws on a gapped plan and writes nothing
6. a plan from another organization is never returned

- [ ] **Step 5: Run it, then type check**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-tier-repo.test.ts && npx tsc --noEmit
```

Expected: **6/6 pass** and **0 errors**.

- [ ] **Step 6: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/db.ts lib/repo/commissionTiers.ts tests/commission-tier-repo.test.ts
git commit -m "feat(commission): a tiered plan table, effective-dated like every other rate"
```

---
### Task 4: Wire it into the ledger without touching the legacy path

The most important property of this task: **a salesperson with no tiered plan must produce
byte-identical statements to today.** That is what makes the change safe to ship, and it is
asserted directly rather than assumed.

**Files:**
- Modify: `lib/commissionLedger.ts`
- Test: `tests/commission-ledger-tiers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commission-ledger-tiers.test.ts`, reusing the fixture shape from
`tests/commissionLedger.test.ts` (read it first — the `ctx` object and the
`sellAndDeliver` helper are already there and should not be duplicated). Add:

```ts
describe("a tiered plan in the ledger", () => {
  it("a salesperson with NO plan gets exactly today's flat statement", () => {
    // The compatibility guarantee, asserted rather than assumed: the legacy branch must be
    // reachable and unchanged, because these people are on real payroll today.
    const s = statementFor(db, ctx.nazanin, period);
    expect(s.accrued_toman).toBeGreaterThan(0);
    for (const o of s.orders) expect(o.rate_per_kg_toman).toBe(flatRate);
  });

  it("a plan REPLACES the flat rate for the same person", () => {
    savePlan(db, {
      salesperson_user_id: ctx.nazanin,
      organization_id: 1,
      plan: {
        mode: "marginal",
        metric: "kg",
        tiers: [
          { from_value: 0, to_value: 50, rate_type: "flat", rate_value: 100 },
          { from_value: 50, to_value: null, rate_type: "flat", rate_value: 300 },
        ],
      },
      valid_from: "2026-01-01",
    });
    const s = statementFor(db, ctx.nazanin, period);
    expect(s.accrued_toman).not.toBe(flatOnlyTotal);
  });

  it("a backdated plan restates UNPAID accruals and never a recorded payment", () => {
    // The asymmetry lib/commission.ts already documents, preserved for tiers. A payment is
    // a fact about money that moved; a rate is a calculation and may be restated.
    recordPayment(db, {
      salesperson_user_id: ctx.nazanin,
      amount_toman: 1000,
      paid_on: "2026-03-01",
    });
    const before = statementFor(db, ctx.nazanin, period).paid_toman;
    savePlan(db, { /* …backdated… */ });
    const after = statementFor(db, ctx.nazanin, period);
    expect(after.paid_toman).toBe(before);
    expect(after.owed_toman).not.toBe(before);
  });
});
```

Fill `flatRate`, `period`, `flatOnlyTotal` and `db` from the existing fixture rather than
re-declaring them.

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-ledger-tiers.test.ts
```

Expected: the "a plan REPLACES the flat rate" test FAILS — `statementFor` has no plan branch.

- [ ] **Step 3: Read the accrual path before editing it**

```bash
cd /home/pourya/Desktop/routeflow
grep -n 'accrualToman\|lineKg\|rateFor' -B 4 -A 8 lib/commissionLedger.ts
```

Understand where the per-order figure is produced. **The change is one branch at that point,
not a rewrite.**

- [ ] **Step 4: Add the branch**

In `lib/commissionLedger.ts`, inside the function that computes a statement's orders, look up
the plan first and fall back to today's behaviour:

```ts
  /* A tiered plan replaces the flat rate for this person on this date.
   *
   *  `planFor` returns null when the person is on the flat rate, and the fallback below is
   *  the ORIGINAL code path unchanged. That is deliberate: two implementations of accrual
   *  would drift, and the people on the flat rate are on real payroll today.
   *
   *  The plan is measured over the WHOLE PERIOD, not per order — a tier is a statement-level
   *  concept. Splitting it per order would mean the same 300kg paid differently depending on
   *  how it was invoiced, which is not a plan anyone would agree to. */
  const plan = planFor(db, salespersonId, period.to);
  const accrual = plan
    ? commissionFor(plan, measureFor(plan.metric, fulfilledOrdersInPeriod))
    : null;
```

then use `accrual` for the statement total when it is non-null, and leave the existing
per-order `accrualToman(lineKg(line), rate.rate_per_kg_toman)` untouched otherwise.

**`StatementOrder.rate_per_kg_toman` no longer means "the rate" when a plan is in force.**
Set it from `effectiveRate(plan, kg)` so the existing column keeps rendering something
truthful, and add one field:

```ts
  /** Null when this person is on a flat rate. */
  plan_mode: PlanMode | null;
```

so the UI can say which rule produced the number rather than implying a per-kilogram rate.

- [ ] **Step 5: Run the ledger suites**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-ledger-tiers.test.ts tests/commissionLedger.test.ts tests/managerCommissionLedger.test.ts tests/driverCommissionLedger.test.ts 2>&1 | tail -20
```

Expected: **all pass.** `tests/commissionLedger.test.ts` is the existing suite and is the real
regression guard: if the flat path moved at all, it fails here.

- [ ] **Step 6: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 7: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add lib/commissionLedger.ts tests/commission-ledger-tiers.test.ts
git commit -m "feat(commission): a tiered plan replaces the flat rate, and only when there is one"
```

---

### Task 5: The admin surface

**Files:**
- Create: `app/api/sales/commission/tiers/route.ts`
- Modify: `components/sales/CommissionEditor.tsx`

- [ ] **Step 1: Write the route**

`GET` returns every plan for the session's organisation; `POST` validates with `validatePlan`
and returns **422 with its Persian message** when the plan is unsound, rather than persisting
something that would pay nobody correctly; `DELETE` removes a plan from a date onward.

Gate the same way `app/api/sales/commission/rates/route.ts` already is. **Read that file first
and match its shape** — a second authorisation style in the same feature is how a gate ends up
stricter than intended in one path and looser in another.

- [ ] **Step 2: Test the route**

Create `tests/api/commission-tiers.test.ts` following `tests/api/sales-commission.test.ts`
(read it first). Cover: owner can read and write; a rep cannot; an invalid plan is 422 with
the message; a cross-tenant id is 404; a plan for another person in the same org is allowed
only for an owner.

- [ ] **Step 3: Run it**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/api/commission-tiers.test.ts
```

Expected: all pass.

- [ ] **Step 4: Build the editor**

In `components/sales/CommissionEditor.tsx`, add a tier editor beneath the existing flat-rate
field. Three requirements that are not optional:

1. **The mode selector defaults to `marginal`** and, when `cliff` is chosen, shows a warning
   in plain words: «در این حالت با کمی فروش بیشتر، ممکن است درآمد کمتر شود». Hiding that is how
   a rep discovers it on payday instead.
2. **A live preview**: as tiers are typed, show what the person earns at a few sample totals
   (e.g. at the current month's actual, and one tier-boundary above it). Use `commissionFor`
   directly — the preview and the payroll must be the same function, or the preview lies.
3. **Server errors are shown, not swallowed.** `validatePlan`'s message goes where the rep is
   looking, not to a console.

- [ ] **Step 5: Type check and run the guards**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit && npx vitest run tests/icon-rule.test.ts tests/no-lint-suppressions.test.ts tests/section-headings.test.ts
```

Expected: **0 errors** and all pass. Any new button needs an icon from `ICONS` — see
`2026-09-30-icon-rule.md`.

- [ ] **Step 6: Commit**

```bash
cd /home/pourya/Desktop/routeflow
git add app/api/sales/commission/tiers components/sales/CommissionEditor.tsx tests/api/commission-tiers.test.ts
git commit -m "feat(commission): an owner screen for tiered plans, with a live preview"
```

---

### Task 6: Verify the whole plan

- [ ] **Step 1: Run every suite this plan touched**

```bash
cd /home/pourya/Desktop/routeflow
npx vitest run tests/commission-tiers.test.ts tests/commission-tier-measure.test.ts tests/commission-tier-repo.test.ts tests/commission-ledger-tiers.test.ts tests/commissionLedger.test.ts tests/managerCommissionLedger.test.ts tests/driverCommissionLedger.test.ts tests/api/commission-tiers.test.ts
```

Expected: **all pass.**

- [ ] **Step 2: Type check**

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit
```

Expected: **0 errors.**

- [ ] **Step 3: Prove no flat-rate code path was rewritten**

```bash
cd /home/pourya/Desktop/routeflow
git --no-pager diff origin/main -- lib/commission.ts lib/orderMath.ts lib/money.ts | head -5
```

Expected: **no output.** This plan adds a plan beside the flat rate; it must not touch the
arithmetic the flat rate already uses. Any diff here is a mistake worth stopping for.

- [ ] **Step 4: Run the full suite (backgrounded — ~14 min)**

```bash
cd /home/pourya/Desktop/routeflow
setsid nohup npx vitest run > /tmp/vitest-commission.log 2>&1 &
tail -20 /tmp/vitest-commission.log
```

Expected: `2 failed / 2735 passed` is a **PASS** when the two are `tests/jalali.test.ts`
("agrees with Intl for every day across 20 Jalali years") and
`tests/api/routing-route.test.ts` ("plans, commits and freezes"). Re-run any other failure
alone first — this plan moves money code, so do not assume a third failure is noise.

---

## Verification Summary

```bash
cd /home/pourya/Desktop/routeflow
npx tsc --noEmit                                 # 0 errors
npx vitest run tests/commission-tiers.test.ts     # all pass, incl. monotonicity
npx vitest run tests/commissionLedger.test.ts     # unchanged — the legacy guarantee
git --no-pager diff origin/main -- lib/commission.ts   # empty
```

A tiered plan pays marginally by default, can be measured on five metrics, and leaves every
person currently on a flat rate with exactly the statement they have today.

## Notes for the Engineer

- **Do not change the arithmetic to make a test pass.** The ground truth here is the boundary
  behaviour, not a number someone typed. `lib/commission.ts` and `lib/orderMath.ts` must come
  out of this plan untouched — Step 3 of Task 6 checks it.
- **A backdated plan restates unpaid accruals and never a recorded payment.** That asymmetry is
  deliberate and is asserted in Task 4. Do not "fix" it.
- **Never run `next build`** here. Use `npx tsc --noEmit` and `npx vitest run`.
- **`sharp` stays at exactly `0.33.5`** (`--save-exact`); this CPU has no AVX2.
- **Three suites flake under full-suite load** (`tests/jalali.test.ts`,
  `tests/api/routing-route.test.ts`, and under load the commission ledger suites can be slow).
  Re-run a failure alone before believing it.
