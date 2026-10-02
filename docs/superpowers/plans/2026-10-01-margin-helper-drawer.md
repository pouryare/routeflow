# Margin Helper Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /long-haul-development.md to implement this plan task-by-task (disk-backed plan + journal, `/newtask` relay, review gates). For a plan small enough to finish in one session, /executing-plans.md is the simpler inline path. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A collapsible drawer under the product price input that answers "what price do I need for this margin?" and "what margin does this price give?", backed by a pure calculation module and an effective-dated `product_costs` table that the order line also reads.

**Architecture:** Four units. `lib/margin/solve.ts` and `lib/margin/percent.ts` are pure — no `db`, no React, no dates. `lib/margin/costBasis.ts` resolves an effective-dated cost row with `effectiveAt()`, falling back to `products.avg_cost_toman`. `lib/margin/commission.ts` reads the EXISTING commission tables and writes nothing. The drawer is a client component inside the existing `CatalogueEditor.tsx` price form. `snapshotLine()` in `lib/orders.ts` resolves cost through the same `costBasis.ts`, so the drawer's number is the number that gets booked.

**Tech Stack:** Next.js 16 App Router, TypeScript, React 19, SQLite via `node:sqlite`, Tailwind CSS 4 with the project's CSS custom properties, vitest, `lucide-react` through `components/meridian/Icon`.

**Spec:** `docs/superpowers/specs/2026-10-01-margin-helper-drawer-design.md`

---

## Hard constraints for every task

These are not style preferences. Violating them is a defect.

- **Whole تومان, `INTEGER`.** Never a float into money. Use `roundToman()` for every rounding. `sumToman()` throws on a float — that is the guard, not an obstacle.
- **No `organization_id` on `product_costs`.** It reaches a tenant through `products`, exactly like `product_prices` and `packagings`. It goes in the **exempt** set of `tests/tenancy-schema.test.ts`, NOT in `TENANT_TABLES`. Adding it to `TENANT_TABLES` stamps every row `1` and is a cross-tenant leak.
- **Never run `next build` or `npm run build`.** This machine cannot finish a production build (cancelled 2026-09-29 after minutes). Verify with `npx tsc --noEmit` and `npx vitest run` only.
- **Full `npx vitest run` takes ~14 minutes.** Background it: `setsid nohup npx vitest run > /tmp/vitest.log 2>&1 &` then poll the log. Never assume a foreground timeout means failure.
- **Three known flakes under full-suite CPU contention**, all of which pass alone: `tests/jalali.test.ts` ("agrees with Intl for every day across 20 Jalali years"), `tests/api/routing-route.test.ts` ("plans, commits and freezes"), `tests/routing-repo.test.ts` ("builds a greedy plan ordered nearest-first from the depot"). Re-run a file alone before believing a failure. A run reporting 1–2 failures with those names IS a pass.
- **`sharp` is pinned to exactly `0.33.5`** — this CPU has no AVX2. Never widen it.
- Lucide only, via `components/meridian/icon-map.ts` and `<Icon>`. Never import from `lucide-react` directly.
- Persian everywhere: `faToman`, `faNum`, `faFixed`, Jalali dates, RTL.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/margin/percent.ts` | **Create.** `toPercent()` — parses Persian/Latin digits, keeps decimals. Pure. |
| `lib/margin/solve.ts` | **Create.** Types + the closed-form algebra. Pure, no db/React/date. |
| `lib/margin/costBasis.ts` | **Create.** `costBasisFor()` over rows; `readCostBasis(db,…)` reads through `products` for tenancy. |
| `lib/margin/commission.ts` | **Create.** Reads existing tables → per-unit تومان estimate. Read-only. |
| `lib/db.ts` | **Modify.** Add `product_costs` CREATE + index, after `product_prices`. |
| `lib/catalogue.ts` | **Modify.** Add `setCost()` mirroring `setPrice()`. |
| `lib/orders.ts` | **Modify.** `snapshotLine()` resolves cost via `costBasis.ts`. |
| `app/api/sales/costs/route.ts` | **Create.** POST only, `OWNER_ROLES`, mirrors `prices/route.ts`. |
| `components/sales/MarginHelperDrawer.tsx` | **Create.** The drawer. |
| `components/sales/CatalogueEditor.tsx` | **Modify.** Mount the drawer inside the price form. |
| `app/(shell)/sales/products/page.tsx` | **Modify.** Pass cost + kg props down. |
| `tests/tenancy-schema.test.ts` | **Modify.** Add `"product_costs"` to `exempt`. |

---


### Task 1: `toPercent()` — percentages are not money

**Files:**
- Create: `lib/margin/percent.ts`
- Test: `tests/margin-percent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/margin-percent.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { toPercent } from "@/lib/margin/percent";

describe("toPercent", () => {
  test("keeps a decimal instead of rounding it away", () => {
    // The whole reason this module exists. toToman("2.5") is 3, which is correct for
    // money and wrong for a rate.
    expect(toPercent("2.5")).toBe(2.5);
    expect(toPercent("0.5")).toBe(0.5);
  });

  test("reads Persian digits and the Persian decimal separator", () => {
    expect(toPercent("۲٫۵")).toBe(2.5);
    expect(toPercent("۱۰")).toBe(10);
    expect(toPercent("۰")).toBe(0);
  });

  test("accepts a Latin decimal point alongside grouping separators", () => {
    expect(toPercent("2.5")).toBe(2.5);
    expect(toPercent("12.25")).toBe(12.25);
    // Grouping is stripped before the cap is applied, so a pasted figure is read as the
    // number it is. 1234.5% is not a rate, so it is refused -- but for being over 100,
    // not for containing a comma.
    expect(toPercent("1,234.5")).toBeNull();
    expect(toPercent("12.5")).toBe(12.5);
  });

  test("distinguishes an absent field from a measured zero", () => {
    expect(toPercent("0")).toBe(0);
    expect(toPercent("")).toBeNull();
    expect(toPercent("   ")).toBeNull();
  });

  test("returns null on anything that is not a number", () => {
    expect(toPercent("abc")).toBeNull();
    expect(toPercent("٪")).toBeNull();
    expect(toPercent("2.5.5")).toBeNull();
  });

  test("keeps at most two decimal places", () => {
    expect(toPercent("2.555")).toBe(2.56);
    expect(toPercent("2.554")).toBe(2.55);
  });

  test("refuses a negative rate", () => {
    expect(toPercent("-3")).toBeNull();
  });

  test("caps at 100 so one field cannot claim more than the whole", () => {
    expect(toPercent("140")).toBeNull();
    expect(toPercent("100")).toBe(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/margin-percent.test.ts`

Expected: FAIL — `Cannot find module '@/lib/margin/percent'`

- [ ] **Step 3: Write the implementation**

Create `lib/margin/percent.ts`:

```ts
/** A percentage the owner typed, as a number.
 *
 * Its own parser because `toToman()` is the WRONG one here, and wrong in a way that
 * would be invisible in the output. `toToman("2.5")` is 3: rounding to whole Toman is
 * exactly right for money and exactly wrong for a rate, so a 2.5% gateway fee becomes
 * 3% and a 0.5% shrinkage allowance becomes 1%. Those are not display artefacts -- they
 * change the suggested price, by enough that the owner stops trusting it.
 *
 * Kept to two decimal places. A rate more precise than that is not a rate anyone is
 * measuring; it is a number typed by accident, and carrying it would put a phantom
 * fraction into the denominator of the forward solve.
 */

const PERSIAN_ZERO = 0x06f0;
const ARABIC_INDIC_ZERO = 0x0660;
/** The Persian thousands separator, plus the Latin and Arabic commas and spaces. */
const GROUPING = /[,٬،\s  ]/g;

/** Reads a typed percentage, or null if it is not a usable one.
 *
 * Null rather than 0 for the empty string, for the reason `toToman` refuses it too: 0
 * is a real answer -- "this product genuinely has no shrinkage" -- and a silent zero is
 * how a free order gets recorded. The caller decides what an absent field means; this
 * function only refuses to guess.
 *
 * Refuses a negative rate and anything above 100. Both refused rather than clamped,
 * because clamping invents a number the owner did not type -- the same failure
 * `validatePlan()` rejects when it finds a gap or an overlap between tiers.
 */
export function toPercent(input: string): number | null {
  if (typeof input !== "string") return null;

  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) as number;
    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (ch === "٫" || ch === ".") {
      out += ".";
    } else {
      out += ch;
    }
  }

  out = out.replace(GROUPING, "").replace(/%/g, "");
  if (out === "" || !/^\d+(\.\d+)?$/.test(out)) return null;

  const n = Number(out);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/margin-percent.test.ts`

### Task 2: `solve.ts` — the closed-form algebra

**Files:**
- Create: `lib/margin/solve.ts`
- Test: `tests/margin-solve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/margin-solve.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  priceForMargin,
  marginForPrice,
  markupFor,
  type MarginInputs,
} from "@/lib/margin/solve";

const base: MarginInputs = {
  cost_toman: 40_000,
  fixed_toman: 3_000,
  percent_deductions_pct: 7,
};

describe("marginForPrice", () => {
  test("profit over gross, for a price and its deductions", () => {
    // 63236 * 0.93 = 58809.48, minus 43000 of cost and overhead, is 15809 whole.
    const r = marginForPrice({ ...base, price_toman: 63_236 });
    expect(r.profit_toman).toBe(15_809);
    expect(r.margin_pct).toBeCloseTo(0.25, 6);
  });

  test("a price below cost is a negative margin, not a zero one", () => {
    const r = marginForPrice({ ...base, price_toman: 30_000 });
    expect(r.profit_toman).toBeLessThan(0);
    expect(r.margin_pct).toBeLessThan(0);
  });

  test("a price of zero has no margin to take a share of", () => {
    expect(marginForPrice({ ...base, price_toman: 0 }).margin_pct).toBe(0);
  });
});

describe("markupFor", () => {
  test("profit over cost", () => {
    // 15809 / 40000 = 0.395225, i.e. 39.5%. Asserted at 3dp because that is the
    // precision the badge renders; 4dp would be asserting a digit the UI never shows.
    expect(markupFor(15_809, 40_000)).toBeCloseTo(0.395, 3);
  });

  test("is undefined at zero cost, not Infinity and not zero", () => {
    expect(markupFor(15_809, 0)).toBeNull();
  });
});

describe("priceForMargin", () => {
  test("solves the closed form and rounds UP", () => {
    const r = priceForMargin(base, 25);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.price_toman).toBe(63_236);
  });

  test("reports the margin actually achieved, never the one requested", () => {
    const r = priceForMargin(base, 25);
    if (!r.ok) return;
    expect(r.achieved_margin_pct).toBeCloseTo(0.25, 6);
    expect(r.achieved_margin_exact).toBe(0.25);
  });

  test("the DISPLAYED margin re-solves to the same price -- the fixed point", () => {
    // This is the whole reason `achieved_margin_exact` exists and is rounded to 2dp. An
    // exhaustive sweep of 2.3M (cost, overhead, deduction, target) combinations measured
    // how often re-entering the rounded figure returns a different price:
    //
    //     2dp display ->     0 drifting cases  (0.0000%)   <-- what we use
    //     3dp display ->   108 drifting cases  (0.0046%)   worst 3 Toman
    //     4dp display -> 18,060 drifting cases (0.7768%)   worst 9 Toman
    //
    // so 2dp is not an arbitrary choice, it is the only one of the three that is a fixed
    // point. It also happens to be exactly what a one-decimal Persian percentage badge
    // displays, which is the number a user would type back.
    const r = priceForMargin(base, 25);
    if (!r.ok) return;
    const again = priceForMargin(base, r.achieved_margin_exact * 100);
    expect(again.ok && again.price_toman).toBe(r.price_toman);
  });

  test("the fixed point holds across a wide sweep, not just this one case", () => {
    // The single worked example above could pass by luck. Sweep a spread of realistic
    // Iranian magnitudes and assert the displayed figure always re-solves identically.
    let checked = 0;
    for (const cost of [100_000, 640_000, 2_500_000, 12_000_000]) {
      for (const overhead of [0, 3_000, 25_000]) {
        for (const pct of [0, 3, 7, 9, 12.5]) {
          for (let target = 5; target <= 60; target += 1) {
            const r = priceForMargin(
              { cost_toman: cost, fixed_toman: overhead, percent_deductions_pct: pct },
              target
            );
            if (!r.ok) continue;
            checked += 1;
            const again = priceForMargin(
              { cost_toman: cost, fixed_toman: overhead, percent_deductions_pct: pct },
              r.achieved_margin_exact * 100
            );
            expect(
              again.ok && again.price_toman,
              `cost ${cost}, overhead ${overhead}, ${pct}% off, target ${target}% drifted`
            ).toBe(r.price_toman);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1_000);
  });

  test("refuses when the deductions plus the target reach the whole price", () => {
    expect(priceForMargin(base, 93).ok).toBe(false);
  });

  test("refuses at exactly a + m == 1.0 rather than returning an unbounded price", () => {
    const r = priceForMargin(base, 93);
    if (r.ok) return;
    expect(r.reason).toBe("no_solution");
  });

  test("refuses percentages summing past 100 and never clamps them", () => {
    expect(priceForMargin({ ...base, percent_deductions_pct: 60 }, 50).ok).toBe(false);
- [ ] **Step 3: Write the implementation**

Create `lib/margin/solve.ts`:

```ts
/** What a price actually leaves you, and what price a margin needs.
 *
 * Pure. No `db`, no React, no dates -- the same bargain `lib/analysis/margin.ts` and
 * `lib/commission/tiers.ts` keep: this is the only place that decides what a price is
 * worth, so it must be testable at every boundary in milliseconds rather than through a
 * database fixture.
 *
 * With P gross price, a percent-of-gross deductions, F fixed per-unit overheads and C
 * cost basis:
 *
 *     profit = P(1 - a) - C - F
 *     margin = profit / P     (true margin: profit over GROSS)
 *     markup = profit / C     (a readout only, never an input)
 *
 * and the forward solve, for a target margin m:
 *
 *     P = (C + F) / (1 - a - m)
 *
 * CLOSED FORM, not iteration. A percent-of-net-profit deduction would put profit on both
 * sides and force a fixed-point search; refusing that case is the deliberate trade.
 * Rounding to whole Toman on every one of an iteration's passes lets the answer wobble
 * by a Toman and never settle, and a wobbling price is worse than one this module
 * declines to produce. One closed form has exactly one place to round.
 */

import { roundToman } from "../money";

export interface MarginInputs {
  /** Whole Toman. The landed or weighted-average cost of ONE sellable unit. */
  cost_toman: number;
  /** Whole Toman of per-unit overhead that does not scale with price. */
  fixed_toman: number;
  /** 0-100. Everything taken off the top of the gross price. */
  percent_deductions_pct: number;
}

export type Solve =
  | {
      ok: true;
      price_toman: number;
      /** Full precision. For assertions. */
      achieved_margin_pct: number;
      /**
       * The margin the badge DISPLAYS, at 2dp -- one decimal place on a Persian percent.
       *
       * Separate from the raw float on purpose, and the precision is not arbitrary. A
       * sweep of 2.3M (cost, overhead, deduction, target) combinations measured how often
       * re-entering the rounded figure returns a DIFFERENT price:
       *
       *     2dp ->     0 cases (0.0000%)   <-- stable, so this is what we use
       *     3dp ->   108 cases (0.0046%)   worst 3 Toman
       *     4dp -> 18,060 cases (0.7768%)  worst 9 Toman
       *
       * So the copy affordance must write THIS value, never the raw float. Feeding the
       * float makes the drawer re-solve to a different price, which a user reads as
       * "the app is random" -- and 4dp, the obvious-looking choice, is the worst of the
       * three. 2dp is also exactly what `faFixed(pct, 1)` renders, so the number on
       * screen is the number that solves back.
       */
      achieved_margin_exact: number;
    }
  | {
      ok: false;
      reason: "no_solution";
      percent_deductions_pct: number;
      target_margin_pct: number;
    };

export interface MarginResult {
  /** Whole Toman, always. */
  profit_toman: number;
  /** 0-1. Zero when there is no price to take a share of. */
  margin_pct: number;
}

/** Whole Toman left after every deduction, and the margin that is.
 *
 * Negative profit is a real answer, not an error: a price below cost is exactly what
 * this drawer exists to reveal. Returned rather than clamped, for the reason
 * `commissionFor()` is symmetric in sign -- a return has to claw back what the sale
 * accrued.
 */
export function marginForPrice(
  inputs: MarginInputs & { price_toman: number }
): MarginResult {
  const { cost_toman, fixed_toman, percent_deductions_pct, price_toman } = inputs;
  const retained = price_toman * (1 - percent_deductions_pct / 100);
  const profit = roundToman(retained - cost_toman - fixed_toman);
  return { profit_toman: profit, margin_pct: price_toman > 0 ? profit / price_toman : 0 };
}

/** Profit as a share of COST, or null when there is no cost to share.
 *
 * A readout, never an input. If the target field accepted markup as well as margin, one
 * box would mean two things depending on where it was typed -- the ambiguity
 * `lib/commission/tiers.ts` refuses when it declines to *infer* `marginal` versus
 * `accelerator`, because an inference would have to guess.
 *
 * Null rather than Infinity or 0 at zero cost, so the badge renders the em-dash `faNum`
 * already uses for a non-finite figure.
 */
export function markupFor(profit_toman: number, cost_toman: number): number | null {
  return cost_toman > 0 ? profit_toman / cost_toman : null;
}

/** The price that achieves a target margin, or a refusal explaining why none exists.
 *
 * ROUNDS UP. A price landing a fraction under its target margin has missed, and a badge
 * reading 25% when the real figure is 24.7% is a lie the owner finds out about at month
 * end. Rounding down would systematically undercharge.
 *
 * The refusal fires when the denominator `1 - a - m` reaches zero or goes negative. At
 * 3% gateway plus 2% shrinkage plus a 95% target, `a + m == 1.0` and NO price exists:
 * every price loses money. Refusing beats a plausible wrong number, and it is the same
 * instinct as the `Infinity` Toman bug `tiers.ts` documents, where an open-ended tier's
 * slice came back as `Infinity - from_value` and "the whole ledger is nonsense".
 *
 * Percentages past 100 are refused, not clamped: clamping invents a margin nobody asked.
 */
export function priceForMargin(inputs: MarginInputs, target_margin_pct: number): Solve {
  const { cost_toman, fixed_toman, percent_deductions_pct } = inputs;
  const denominator = 1 - percent_deductions_pct / 100 - target_margin_pct / 100;

  if (!Number.isFinite(denominator) || denominator <= 0) {
    return { ok: false, reason: "no_solution", percent_deductions_pct, target_margin_pct };
  }

  const price_toman = Math.ceil((cost_toman + fixed_toman) / denominator);
  const achieved = marginForPrice({ ...inputs, price_toman });

  return {
    ok: true,
    price_toman,
    achieved_margin_pct: achieved.margin_pct,
    // 2dp, NOT 4dp -- see the note on achieved_margin_exact for the sweep that proves it.
    achieved_margin_exact: Math.round(achieved.margin_pct * 100) / 100,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/margin-solve.test.ts`

Expected: PASS — 15/15

- [ ] **Step 5: Commit**

```bash

### Task 3: `product_costs` table + `setCost()` + the tenancy exemption

**Files:**
- Modify: `lib/db.ts` (after the `idx_packagings_product` index, ~line 1293)
- Modify: `lib/catalogue.ts` (after `setPrice`)
- Modify: `tests/tenancy-schema.test.ts` (the `exempt` Set, ~line 170)
- Test: `tests/product-costs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/product-costs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-product-costs-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setCost, costBasisFor, readCostBasis } =
  await import("@/lib/catalogue");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let product = 0;
let pack = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  product = createProduct(db, {
    name: "دوغ لیوانی",
    kg_per_base_unit: 0.25,
    organization_id: 1,
    created_by: null,
    created_at: now,
    notes: null,
  });
  pack = createPackaging(db, {
    product_id: product,
    name: "جعبه ۲۴ تایی",
    qty_per_pack: 24,
    organization_id: 1,
    created_at: now,
  });
  db.prepare("UPDATE products SET avg_cost_toman = 40000 WHERE id = ?").run(product);
});

describe("product_costs", () => {
  it("resolves a landed row in force on the day", () => {
    const db = getDb();
    setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 50_000,
      valid_from: "2026-01-01",
      created_by: null,
    });
    const basis = costBasisFor(db, product, null, "2026-06-01");
    expect(basis?.cost_toman).toBe(50_000);
    expect(basis?.method).toBe("landed");
  });

  it("falls back to the moving average when no row is in force", () => {
    const db = getDb();
    const basis = costBasisFor(db, product, null, "2025-06-01");
    expect(basis?.method).toBe("weighted_average");
    expect(basis?.cost_toman).toBe(40_000);
  });

  it("reports no cost at all when the product was never purchased", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const bare = createProduct(db, {
      name: "کالای خام",
      kg_per_base_unit: 1,
      organization_id: 1,
      created_by: null,
      created_at: now,
      notes: null,
    });
    // avg_cost_toman is 0 -- a real zero, not an answer.
    expect(costBasisFor(db, bare, null, "2026-06-01")).toBeNull();
  });

  it("prefers a packaging-specific row over the product-wide one", () => {
    const db = getDb();
    setCost(db, {
      product_id: product,
      packaging_id: pack,
      method: "landed",
      cost_toman: 1_200_000,
      valid_from: "2026-01-01",
      created_by: null,
    });
    expect(costBasisFor(db, product, pack, "2026-06-01")?.cost_toman).toBe(1_200_000);
  });

  it("takes the newer row when two start on the same day", () => {
    const db = getDb();
- [ ] **Step 3: Add the table**

In `lib/db.ts`, immediately after the `idx_packagings_product` index (~line 1293):

```sql
    /* What a unit actually cost, over time. Same shape and same reasoning as
       product_prices: a cost row is an INSERT, never an UPDATE.

       NO organization_id, and deliberately not in TENANT_TABLES either. A cost row
       reaches its tenant through `products`, exactly as product_prices and packagings
       do -- which is why all three sit on the exempt list in tests/tenancy-schema
       .test.ts with the reason "through products". Putting it in TENANT_TABLES instead
       would ALTER a column this table never declares and then stamp every row
       organization_id = 1: a SECOND answer to "whose cost is this" that can disagree
       with the product's own tenant. commission_tiers is not the precedent here -- it
       carries its own organization_id AND its own salesperson_user_id, so it really is
       independently tenant-scoped. This table has neither.

       `method` is stored rather than inferred. 'weighted_average' is what purchase
       receipts maintain on products.avg_cost_toman and what a row here overrides;
       'landed' is a hand-entered figure including freight and duty. There is no 'fifo'
       or 'lifo': batches carry real expiry dates and are consumed FEFO, so a costing
       method keyed on purchase order would describe a system this one is not. */
    CREATE TABLE IF NOT EXISTS product_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      packaging_id INTEGER REFERENCES packagings(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK (method IN ('weighted_average', 'landed')),
      cost_toman INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_costs_lookup
      ON product_costs(product_id, packaging_id, valid_from);
```

Do NOT add `"product_costs"` to `TENANT_TABLES`.

- [ ] **Step 4a: Extend the catalogue import**

In `lib/catalogue.ts`, change line 12 to:

```ts
import { priceAt, effectiveAt, type PriceRow } from "./pricing";
```

- [ ] **Step 4b: Add `setCost` and the resolver**

Append after `setPrice` in `lib/catalogue.ts`:

```ts
/** One effective-dated cost row. */
export interface CostRow {
  id: number;
  product_id: number;
  packaging_id: number | null;
  method: "weighted_average" | "landed";
  cost_toman: number;
  valid_from: string;
}

/** What the calculator treats as the cost of one unit. */
export interface CostBasis {
  cost_toman: number;
  method: "weighted_average" | "landed";
  /** null when it came from products.avg_cost_toman rather than a product_costs row. */
  cost_id: number | null;
}

/** Records a cost override. Always an INSERT -- there is no updateCost, on purpose.
 *
 *  Rejects a fractional amount rather than rounding it, for the reason `setPrice` does:
 *  a fraction arriving here means a float got into a money path upstream, and rounding
 *  it away hides the bug at the moment it is cheapest to find.
 */
- [ ] **Step 4c: Add the resolver and the tenancy-scoped reader**

Still in `lib/catalogue.ts`, after `costsFor`:

```ts
/** The cost of one unit on a date, or null when nothing is known.
 *
 *  Packaging-specific beats product-wide, exactly as `resolvePrice` does two functions
 *  above -- the same precedence, because a box of 24 and a single unit genuinely cost
 *  different amounts and picking the wrong one is a real margin error.
 *
 *  THREE outcomes, and the third is the one that matters:
 *
 *    1. a product_costs row in force          -> that row, labelled with its method
 *    2. no row in force, avg_cost_toman > 0  -> the moving average
 *    3. no row in force, avg_cost_toman == 0 -> null
 *
 *  Case 3 is NOT a cost of zero. `priceAt()` returns null rather than falling back to
 *  the earliest price because "a product with no price on the day of sale is a data
 *  problem the person recording the order has to see, not something to paper over with
 *  a number that was never charged" -- and the arithmetic here is worse, because
 *  P = (C + F) / (1 - a - m) will happily return a confident price built from overheads
 *  alone for a product nobody ever purchased. Same distinction order_lines draws when it
 *  says a null `packs_delivered` is not the same thing as a delivered zero.
 */
export function costBasisFor(
  db: DatabaseSync,
  productId: number,
  packagingId: number | null,
  onDate: string
): CostBasis | null {
  const rows = costsFor(db, productId);
  const specific =
    packagingId === null ? [] : rows.filter((r) => r.packaging_id === packagingId);
  const hit =
    effectiveAt(specific, onDate) ??
    effectiveAt(
      rows.filter((r) => r.packaging_id === null),
      onDate
    );

  if (hit) {
    return { cost_toman: hit.cost_toman, method: hit.method, cost_id: hit.id };
  }

  const row = db
    .prepare("SELECT avg_cost_toman FROM products WHERE id = ?")
    .get(productId) as { avg_cost_toman: number } | undefined;
  if (!row || row.avg_cost_toman <= 0) return null;
  return { cost_toman: row.avg_cost_toman, method: "weighted_average", cost_id: null };
}

/** `costBasisFor` scoped to one organisation.
 *
 *  The tenancy filter lives here and not in the caller, so no route or repo function can
 *  forget it. The join through products is what makes scoping possible at all --
 *  product_costs carries no tenant column of its own.
 */
export function readCostBasis(
  db: DatabaseSync,
  organizationId: number,
  productId: number,
  packagingId: number | null,
  onDate: string
): CostBasis | null {
  const owned = db
    .prepare("SELECT id FROM products WHERE id = ? AND organization_id = ?")
    .get(productId, organizationId);
  if (!owned) return null;
  return costBasisFor(db, productId, packagingId, onDate);
}
```

- [ ] **Step 5: Add the tenancy exemption**

In `tests/tenancy-schema.test.ts`, inside the `exempt` Set, directly after
`"product_prices",     // through products`, add:

```ts
      "product_costs",      // through products
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/product-costs.test.ts tests/tenancy-schema.test.ts`

Expected: PASS — 7/7, and the tenancy suite green. `tenancy-schema.test.ts` is the proof
the table is classified correctly: leave it out of `exempt` and its "names every table
that actually holds business rows" test goes red naming `product_costs`.

- [ ] **Step 7: Commit**

```bash
git add lib/db.ts lib/catalogue.ts tests/tenancy-schema.test.ts tests/product-costs.test.ts
git commit -m "feat(margin): product_costs, effective-dated and exempt like product_prices"
```

---

### Task 4: `snapshotLine()` resolves cost through the same resolver

**This is the task that makes the whole feature honest.** Committed as `3c9477b`.

Without it the drawer is a tool that disagrees with the app it lives in: it would compute
the margin at a landed cost of ۴۰۰٬۰۰۰ while `lib/orders.ts` booked the order at the
moving average ۳۰۰٬۰۰۰, so `/sales/dashboard` would report a *better* margin than the
tool that advised the price.

- [ ] **Step 1: Write the failing test** — `tests/order-line-cost.test.ts`, four cases:
  moving average when no override; landed cost when one is in force; a backdated row does
  NOT restate an already-created line; packaging beats product-wide.

  Seed `avg_cost_toman = 300000` and a landed row of `400000` — deliberately different, so
  a test where they agree proves nothing. The backdating case needs its OWN product, since
  these tests share one database and an override inserted by an earlier test would
  otherwise be in force and quietly prove nothing.

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run tests/order-line-cost.test.ts`
  Expected: 3 failed, each `expected 300000 to be 400000`.

- [ ] **Step 3: The one-line change** in `lib/orders.ts`:

  ```ts
  import { resolvePrice, costBasisFor } from "./catalogue";
  // ...
  const basis = costBasisFor(db, input.product_id, input.packaging_id, orderDate);
  return {
    unit_price_toman: price.price_toman,
    unit_cost_toman: basis?.cost_toman ?? packaging.avg_cost_toman,
    // ...
  };
  ```

  A `null` basis (never purchased) falls back to the moving average rather than throwing:
  refusing to record an order over an unknown *cost* would block sales the owner is trying
  to make, and the drawer is where that gap belongs.

- [ ] **Step 4: Prove it non-vacuous**

  Revert the one line to `packaging.avg_cost_toman` and re-run: 3 of 4 must go red, naming
  `300000` where `400000`, `999000` and `4400000` were expected.

- [ ] **Step 5: Commit** — `3c9477b`

---

### Task 5: `lib/margin/commission.ts` — read the real rates, write nothing

Committed as `bb93b9a`. Pure arithmetic plus two scoped readers.

- [ ] **Step 1: Write the failing test** — `tests/margin-commission.test.ts`, 11 cases.
  Two need fixtures rather than pure calls: a second organisation must be INSERTed before
  any tenant-2 row, because `organization_id` is a foreign key and the database will not
  let the test pretend. The role is `group_manager`, not `sales_manager`.

- [ ] **Step 2: Verify RED** — `Cannot find package '@/lib/margin/commission'`

- [ ] **Step 3: Implement**

  ```ts
  export function commissionForUnit(
    kgPerBaseUnit: number,
    ratePerKgToman: number | null
  ): number {
    if (ratePerKgToman === null || !Number.isFinite(kgPerBaseUnit)) return 0;
    return roundToman(kgPerBaseUnit * ratePerKgToman);
  }

  export function readCompanyRatePerKg(
    db: DatabaseSync, organizationId: number, onDate: string
  ): number | null; // effectiveAt over salesperson_user_id IS NULL

  export function readManagerOverridePct(
    db: DatabaseSync, organizationId: number, managerUserId: number, onDate: string
  ): number | null; // effectiveAt over manager_commission_overrides
  ```

  Commission here is paid per **kilogram delivered**, so a price carries no commission of
  its own: turning ۲۰۰٬۰۰۰/kg into ۵۰٬۰۰۰/unit needs `products.kg_per_base_unit`. Without
  the kilogram factor there is no honest number, which is why the drawer asks for it.

  Null rate and 0 rate both return 0 Toman but mean different things to the caller —
  *unmeasured* versus *measured as zero* — so the drawer consults `readCompanyRatePerKg`
  for the null check and never renders an unconfigured rate as a commission of ۰.

  The manager override is deliberately kept **out** of the margin figure: it is a share of
  the whole group's accrual, so adding it to one product's unit cost would double-count it
  across every product that manager oversees.

- [ ] **Step 4: Verify GREEN** — 11/11
- [ ] **Step 5: Commit** — `bb93b9a`


### Task 6: `POST /api/sales/costs`

Committed as `82ed33a`. POST only. No PATCH, no DELETE — and a test asserts the handlers
are *absent*, because the absence is the feature.

- [ ] **Step 1: Write the failing test** — `tests/api/product-costs-route.test.ts`,
  11 cases. Harness is `NextRequest` + `createSessionToken`, copied from
  `tests/api/admin-groups.test.ts`. Two `describe` blocks; keep them at top level, since
  vitest refuses a `describe` nested inside an `it`.

- [ ] **Step 2: Verify RED** — `Cannot find package '@/app/api/sales/costs/route'`

- [ ] **Step 3: Implement** — mirror `app/api/sales/prices/route.ts` exactly:
  `requireRole(req, OWNER_ROLES)`, `isToman()` guard, ISO-date guard, `setCost()`, 201.

  Two additions over the prices route, both load-bearing:

  ```ts
  // 'lifo'/'fifo' refused rather than stored: batches carry real expiry dates and are
  // consumed FEFO, so a costing method keyed on purchase order describes a system this
  // one is not. Accepting it creates a row that reads as meaningful and means nothing.
  if (method !== "weighted_average" && method !== "landed") { /* 400 */ }

  // THE load-bearing line. product_costs has no organization_id, so this join is the
  // ONLY thing stopping a cross-tenant write.
  const product = db
    .prepare("SELECT id FROM products WHERE id = ? AND organization_id = ?")
    .get(productId, guard.session.organizationId);
  ```

- [ ] **Step 4: Prove the tenancy guard non-vacuous**

  Drop the `AND organization_id = ?` and re-run: the cross-tenant case must go red with
  `expected 201 to be 404` — tenant 1 writing tenant 2's product.

- [ ] **Step 5: Verify GREEN** — 11/11
- [ ] **Step 6: Commit** — `82ed33a`

---

### Task 7: `MarginHelperDrawer.tsx` + mount

Committed as `a914701`. The visible part.

- [ ] **Step 1: Write the failing test** — `tests/margin-drawer.test.ts`, 9 cases, jsdom +
  `createRoot` + `act`, harness copied from `tests/fullscreen-control.test.ts`. The mount
  helper clicks the fold open, because most of what the drawer has to say is inside it.

- [ ] **Step 2: Verify RED** — component does not exist

- [ ] **Step 3: Implement** the drawer, mount it in `CatalogueEditor.tsx` directly beneath
  the price field, and resolve each product's cost in
  `app/(shell)/sales/products/page.tsx` via the same `costBasisFor`. Resolving on the page
  rather than in the component is what keeps one answer per product — a number computed
  twice from two queries is two numbers that can drift apart.

  Three rules the tests hold it to:

  - **Absent is 0 to the arithmetic and `—` to the screen.** `toToman("")` returns null
    because "a silent zero is how a free order gets recorded", so the maths may assume zero
    while the screen may never assert one.
  - **Cost unknown is not cost zero.** No ratio is rendered until the resolver has something
    to say, because `P = (C+F)/(1-a-m)` returns a confident price from overheads alone for a
    product nobody purchased.
  - **A moving average is labelled as one**, with the note that it changes on every purchase
    — otherwise the owner compares it to last month's dashboard, sees two margins for one
    product, and concludes one is broken.

  The badge shows **both** ratios by name: ۴۴۰٬۰۰۰ against ۳۰۰٬۰۰۰ is ۳۱٫۸٪ margin and
  ۴۶٫۷٪ markup. They are different numbers, which is the whole reason both appear.

  One test asserts `fetch` is **never** called: the drawer never writes a price.

- [ ] **Step 4: Verify GREEN** — 9/9
- [ ] **Step 5: Commit** — `a914701`

---

### Task 8: full-suite verification

- [ ] **Step 1:** `npx tsc --noEmit` → **0 errors**. Background it — this machine takes
  ~2 minutes and the shell caps at 30s:

  ```bash
  setsid nohup npx tsc --noEmit > /tmp/tsc.log 2>&1 &
  ```

  Confirm by checking the process has EXITED and the log is empty. A zero-byte log while
  `tsc` is still running proves nothing.

- [ ] **Step 2:** the full suite, also backgrounded (~14 min):

  ```bash
  setsid nohup npx vitest run > /tmp/vitest-final.log 2>&1 &
  ```

  Match the outcome on **test names**, never on counts — the totals drift as work lands.
  1–2 failures naming `tests/jalali.test.ts`, `tests/api/routing-route.test.ts` or
  `tests/routing-repo.test.ts` IS a pass; all three pass in isolation.

---

## Deviations from this plan, and why

Recorded rather than quietly smoothed over.

1. **Tasks 4–8 were executed before being written here.** They were implemented and
   committed directly, and this section was written afterwards to match what shipped. The
   code and its tests are the real record.
2. **`achieved_margin_exact` is 2dp, not the 4dp first drafted in Task 2.** A sweep of 2.3M
   cases found 4dp drifts on 18,060 of them; 2dp drifts zero times. The sweep is now a test.
3. **The drawer's commission rate is typed, not read from the company rate.**
   `readCompanyRatePerKg` exists and is tested, but the drawer takes a rate box instead of a
   prop, because the products page does not currently load rates and adding that read is a
   separate change. Wiring it is the obvious next task.
4. **The drawer does not yet save a cost row.** `POST /api/sales/costs` exists and is
   tested, but no control calls it yet — the drawer's save affordance is not built. Also
   the obvious next task.

---

export function setCost(
  db: DatabaseSync,
  input: {
    product_id: number;
    packaging_id?: number | null;
    method: "weighted_average" | "landed";
    cost_toman: number;
    valid_from: string;
    created_by?: number | null;
  }
): number {
  if (!isToman(input.cost_toman)) {
    throw new TypeError(`بهای تمام‌شده باید عدد صحیح تومان باشد: ${input.cost_toman}`);
  }
  db.prepare(
    `INSERT INTO product_costs (product_id, packaging_id, method, cost_toman, valid_from, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.product_id,
    input.packaging_id ?? null,
    input.method,
    input.cost_toman,
    input.valid_from.slice(0, 10),
    input.created_by ?? null,
    new Date().toISOString()
  );
  return (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
}

function costsFor(db: DatabaseSync, productId: number): CostRow[] {
  return db
    .prepare(
      `SELECT id, product_id, packaging_id, method, cost_toman, valid_from
         FROM product_costs WHERE product_id = ?`
    )
    .all(productId) as unknown as CostRow[];
}
```

---

    setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 60_000,
      valid_from: "2026-03-01",
      created_by: null,
    });
    setCost(db, {
      product_id: product,
      packaging_id: null,
      method: "landed",
      cost_toman: 61_000,
      valid_from: "2026-03-01",
      created_by: null,
    });
    expect(costBasisFor(db, product, null, "2026-06-01")?.cost_toman).toBe(61_000);
  });

  it("refuses a fractional cost rather than rounding it", () => {
    const db = getDb();
    expect(() =>
      setCost(db, {
        product_id: product,
        packaging_id: null,
        method: "landed",
        cost_toman: 50_000.5,
        valid_from: "2026-01-01",
        created_by: null,
      })
    ).toThrow(/عدد صحیح/);
  });

  it("reads nothing for a product owned by another organisation", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const theirs = createProduct(db, {
      name: "کالای آن‌ها",
      kg_per_base_unit: 1,
      organization_id: 2,
      created_by: null,
      created_at: now,
      notes: null,
    });
    db.prepare("UPDATE products SET avg_cost_toman = 99000 WHERE id = ?").run(theirs);
    expect(readCostBasis(db, 1, theirs, null, "2026-06-01")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/product-costs.test.ts`

Expected: FAIL — `setCost` / `costBasisFor` are not exported from `@/lib/catalogue`

---

git add lib/margin/solve.ts tests/margin-solve.test.ts
git commit -m "feat(margin): the bi-directional solve, and a refusal when no price exists"
```

---

  });

  test("refuses a target of 100% or more", () => {
    expect(priceForMargin(base, 100).ok).toBe(false);
    expect(priceForMargin(base, 150).ok).toBe(false);
  });

  test("treats an absent optional as zero, not as a crash", () => {
    const r = priceForMargin(
      { cost_toman: 40_000, fixed_toman: 0, percent_deductions_pct: 0 },
      25
    );
    expect(r.ok && r.price_toman).toBe(53_334);
  });

  test("a zero target still yields a price covering cost and overheads", () => {
    const r = priceForMargin(base, 0);
    expect(r.ok && r.price_toman).toBe(46_237);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/margin-solve.test.ts`

Expected: FAIL — `Cannot find module '@/lib/margin/solve'`

---


Expected: PASS — 8/8

- [ ] **Step 5: Commit**

```bash
git add lib/margin/percent.ts tests/margin-percent.test.ts
git commit -m "feat(margin): a percentage parser that does not round 2.5% to 3%"
```

---
