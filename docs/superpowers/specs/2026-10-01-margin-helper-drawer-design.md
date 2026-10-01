# The margin helper drawer — a bi-directional profit solve under the price field

Date: 2026-10-01
Status: approved for planning, revised after an adversarial review pass
Touches: `lib/margin/*` (new), `product_costs` (new table), `CatalogueEditor.tsx`,
`app/api/sales/costs` (new), **`lib/orders.ts` `snapshotLine()` (one line — see below)**

## The problem

`/sales/products` lets an owner set a price. It does not let them answer the two
questions that decide whether a price is a *good* price:

- "This costs me ۴۰٬۰۰۰ and I need ۲۵٪ margin — what do I charge?"
- "I am charging ۵۲٬۰۰۰ — what do I actually keep, and where does it all go?"

Today the only feedback is `lib/analysis/margin.ts`, which reports margin on
orders *already sold*. It cannot advise on a price that has not been set. Nothing
in the codebase computes a price from a target, and nothing shows a full
deduction waterfall for a prospective price.

This adds that. A collapsible drawer under the existing price input, backed by a
pure calculation module.

## What was deliberately NOT built

This matters more than what was, so it is recorded first. The original brief
asked for all of the following. Each was checked against the codebase and
dropped, with the reason.

| Asked for | Status | Why |
|---|---|---|
| A dynamic tax / VAT engine, multi-jurisdiction rates, B2B/B2C exemptions | **Dropped** | Zero tax references exist anywhere in the codebase, and the brief's model (per-state rates, regional exemptions) is US-shaped. This app is تومان with Jalali dates. Building a jurisdiction matrix here would be inventing a fiction. Tax enters as a manual تومان line item until we know what is actually owed. |
| FIFO / LIFO / weighted-average costing, selectable | **Partly dropped** | Weighted average already exists and is not optional: `products.avg_cost_toman` is maintained by purchase receipts. LIFO is not a missing feature — it contradicts `lib/db.ts`, which states batches are "per-batch valuation, not for FIFO costing", consumed **FEFO** on real expiry dates. A `costing_method` enum today would leave a branch that can never fire correctly. |
| Channel / department commission overrides (Phone, Field, Delivery, Wholesale, Online) | **Dropped** | `lib/commission/tiers.ts`, `lib/commission.ts` and `manager_commission_overrides` already implement per-rep override, multi-tier plans (marginal / accelerator / cliff), flat *or* percent, across five metrics. A second commission engine beside them would eventually disagree with payroll. |
| Multi-tier + per-rep + manager commission **systems** | **Already exists — reused read-only** | See `lib/commission/tiers.ts`. The drawer reads these tables through a pure function and cannot write them. |
| Gateway fees, shrinkage, returns, damage rates | **Kept, as manual inputs** | No such concept exists. These are optional percentage/fixed fields the owner types. Not modelled, not derived, not stored as per-product defaults in v1. |
| Cents / decimal money | **Dropped** | `lib/money.ts` holds whole تومان in INTEGER columns; `sumToman()` throws on a float and `isToman()` gates every price write. |

**YAGNI ruling:** the brief lists five commission bases. `tiers.ts` supports two
(`flat`, `pct`) and channel overrides were dropped, so v1 models two real bases
(percent of gross, fixed تومان) and refuses percent-of-profit out loud.

## Architecture

Four units, one job each. The boundary that matters is that **`solve.ts` never
imports the database** — the same split `lib/analysis/margin.ts` draws ("a pure
module, no `db` import") and the reason `lib/commission/tiers.ts` can be tested
at every boundary in milliseconds.

```
lib/margin/solve.ts        PURE. Types + algebra. No db, no React, no date.
lib/margin/percent.ts      PURE. toPercent() — decimals survive, Persian digits accepted.
lib/margin/costBasis.ts    effectiveAt() over product_costs, falling back to avg_cost_toman.
lib/margin/commission.ts    Reads EXISTING commission tables → per-unit estimate.
components/sales/MarginHelperDrawer.tsx    The drawer.
```

`costBasis.ts` is called by **two** consumers: the drawer, and
`snapshotLine()` in `lib/orders.ts`. That is what keeps the tool honest — see
the section above.

A DB-reading module *produces* a `MarginInputs`; `solve.ts` consumes it. The
drawer can be replaced without touching a line of arithmetic.


## The load-bearing decision: the override reaches the order line

**`product_costs` is not a calculator-only override. It is what an order line
snapshots as its cost.**

This is the decision the whole design turns on, and the first draft of this spec
got it wrong — it scoped `product_costs` to the drawer alone and left
`lib/orders.ts` untouched. That would have been a tool that lies.

Today `snapshotLine()` in `lib/orders.ts` freezes:

```ts
return {
  unit_price_toman: price.price_toman,
  unit_cost_toman: packaging.avg_cost_toman,   // ← hard-wired to the moving average
  qty_per_pack: packaging.qty_per_pack,
  kg_per_base_unit: packaging.kg_per_base_unit,
  price_id: price.id,
};
```

If `product_costs` fed only the drawer, the owner would set a landed cost of
۵۰٬۰۰۰, the drawer would report 24% margin, and the order would book at
`avg_cost_toman` ۴۰٬۰۰۰ — so `/sales/dashboard`, `lib/repo/margin.ts` and
`kpiSnapshots.ts` would all report a *better* margin than the tool that advised
the price. Two numbers, one product, one of them fiction.

So `snapshotLine()` resolves cost through the **same** `costBasis.ts` the drawer
uses: a `product_costs` row in force wins, else `avg_cost_toman`. One resolver,
two callers. This is precisely the pattern `lib/pricing.ts` already documents —
"the order line then *snapshots* the answer, so the historical figure survives".

**What this does and does not touch.** It changes what gets frozen onto *future*
lines. It does not rewrite history: `lib/repo/margin.ts`, `kpiSnapshots.ts` and
`lib/repo/health.ts` all read `ol.unit_cost_toman` off the line, so a backdated
cost row restates nothing already booked. That is the same asymmetry
`lib/commission.ts` documents for a backdated rate.

**The resolver signature**, mirroring `rateFor()`'s precedence exactly:

```ts
costBasisFor(rows, productId, packagingId, onDate) → CostBasis | null
```

packaging-specific beats product-wide, each via `effectiveAt()`, with "on a
shared start date the higher id wins". `null` means *no cost is known at all* —
see the zero-cost rule below.

### Two consequences that are not optional

**Cost and price must resolve on the SAME date.** They are separate
effective-dated series and can resolve to different eras. The drawer resolves
both against one `onDate` so the margin it shows is internally coherent.

**`C = 0` with no cost row is a data problem, not a zero.** A product never
purchased has `avg_cost_toman = 0`, and `P = (C + F) / (1 − a − m)` will happily
return a price built from overheads alone — telling the owner "charge ۱۰٬۰۰۰,
margin 25%" for a product whose real cost was never entered.

`snapshotLine()` already handles the identical case for price, and the fix is the
same one:

```ts
if (!price) throw new OrderError(`«${packaging.product_name}» در این تاریخ قیمت ندارد`);
```

`priceAt()` returns `null` rather than falling back to the earliest price
because "a product with no price on the day of sale is a data problem the person
recording the order has to see, not something to paper over with a number that
was never charged." Cost gets the identical treatment: the drawer warns that cost
is unknown rather than computing a confident margin from nothing. The arithmetic
still runs — it is a calculator — but the badge is marked unverified.

### Percentages are not money and need their own parser

`toToman("2.5")` returns `3`, because it rounds to whole Toman. That is correct
for money and **wrong for a rate**: a 2.5% gateway fee must not become 3%, and
`0.5%` must not become `1%`.

A dedicated `toPercent()` parses Persian and Latin digits, accepts a decimal
point (`٫` and `.`), keeps one or two decimal places, and returns `null` on
garbage. Reusing `toToman` here would quietly inflate every percentage the owner
types by up to half a point, which on a large margin is real money.

## The new table

One table, mirroring `product_prices`, insert-only:

```sql
CREATE TABLE IF NOT EXISTS product_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  packaging_id INTEGER REFERENCES packagings(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('weighted_average', 'landed')),
  cost_toman INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_costs_lookup
  ON product_costs(organization_id, product_id, packaging_id, valid_from);
```

`organization_id` is in the CREATE and **must also be added to `TENANT_TABLES`**
in `lib/db.ts`. That list is not optional bookkeeping: `tests/tenancy-schema.test.ts`
fails the build without it, and the failure mode it prevents is a table readable
by every organisation that looks like nothing at all until a second tenant exists.

No `PATCH` or `DELETE` route, for the same reason `app/api/sales/prices/route.ts`
has none: a cost row that could be edited would take every order priced from it
with it.

## The fallback rule

**A `product_costs` row in force wins. No row in force → `products.avg_cost_toman`,
reported as `weighted_average`. No cost at all → `null`, and the caller decides.**

Once cost basis is overridable, `avg_cost_toman` stops being what the calculator
reads and becomes the default a landed-cost row overrides. The purchase-receipt
path that maintains it keeps working untouched.

Two distinct "no cost" cases, which must not be conflated:

| Case | `avg_cost_toman` | Resolver returns | Caller |
|---|---|---|---|
| Purchased, then overridden | non-zero | the `product_costs` row | normal |
| Purchased, no override | non-zero | `{ method: "weighted_average", cost_toman: avg }` | normal |
| Never purchased | **0** | `null` | drawer warns; `snapshotLine()` falls back to 0 as today |

The third row is the trap. `avg_cost_toman = 0` is a *real zero* — the same
distinction `order_lines.packs_delivered` draws, where "Zero is a real answer --
the customer refused the line at the door -- and is not the same thing as null."
A zero cost with no recorded basis is not an answer, and the resolver says so.

The drawer always displays **which** method produced the number. A reader must
never be guessing whether they are looking at a receipt-maintained average or a
hand-entered landed figure.

Precedence mirrors `rateFor()` in `lib/commission.ts`, which already does exactly
this shape — packaging-specific beats product-wide, each resolved by
`effectiveAt()`, with the same "on a shared start date the higher id wins" rule.

## The arithmetic

Whole تومان throughout. Percentages are carried as numbers and rounded through
`roundToman()` at the points stated below — never as cents.

Let `a` = summed percentage-of-gross deductions, `F` = summed fixed-per-unit
overheads, `C` = cost basis, `P` = gross price.

```
profit = P(1 − a) − C − F
margin = profit / P          (true margin: profit ÷ gross)
markup = profit / C          (derived readout only — see below)
```

**Forward** — given target margin `m`, solve in closed form:

```
P = (C + F) / (1 − a − m)
```

**Reverse** — given `P`, evaluate directly.


### Margin is one definition; markup is a readout

The engine defines `margin` as profit ÷ gross, and the target field accepts only
that. The badge shows **both**, because the team uses the words interchangeably:

```
حاشیه خالص ۲۴٫۵٪  ·  سود روی بها ۳۲٫۵٪
```

Markup is never an input. If it were, one box would mean two things depending on
where it was typed — the ambiguity `lib/commission/tiers.ts` refuses when it
declines to *infer* `marginal` vs `accelerator` "because an inference would have
to guess".

Markup is undefined when `C = 0`. It renders `—`, following `marginPct()`'s
`revenue <= 0` guard and `faNum`'s non-finite `—`. Never `Infinity`, never a
fabricated `۰٪`.

### The refusal case

The denominator `1 − a − m` can reach zero or go negative. At 3% gateway + 2%
shrinkage + a 95% target margin, `a + m = 1.0` and **no price exists** — every
price loses money.

`priceForMargin` returns a discriminated result rather than a number:

```ts
export type Solve =
  | { ok: true; price_toman: number; achieved_margin_pct: number }
  | {
      ok: false;
      reason: "no_solution";
      percent_deductions_pct: number;
      target_margin_pct: number;
    };
```

The drawer renders the Persian message naming both percentages. This is the same
instinct as `tiers.ts`, whose comment records the bug where an open-ended tier
paid `Infinity` Toman and "the whole ledger is nonsense". A refusal is more
useful than a plausible wrong number.

**Documented fallback:** if a future requirement makes percent-of-profit
necessary, iteration to a fixed point is the escape hatch. It is not built now.
It would need an explicit stop condition, because rounding to whole تومان each
pass lets the answer wobble by 1 تومان — and a wobbling price is worse than a
refused one.

### Rounding

`priceForMargin` rounds **up** (`Math.ceil`), then recomputes and reports
`achieved_margin_pct` from the reverse pass. The badge shows the **achieved**
margin, never the requested one.

A price that lands 0.3% under its target margin failed, and a badge reading
"۲۵٪" when the real figure is ۲۴٫۷٪ is a lie discovered at month end.

### "Every field is optional" — absent is not zero

The arithmetic treats an absent field as 0, so nothing crashes. The **display**
does not. An unfilled gateway-fee box renders `—`, never `۰`.

`toToman("")` returns `null` rather than 0 precisely because "0 is a real amount
and a silent zero is how a free order gets recorded". An unmeasured 0% must not
be indistinguishable from a measured one. This is the same reasoning behind
`MatchQuality.measurable` in `CostToServePanel.tsx`: *not measurable here* is not
the same claim as *nothing to measure*.

### Commission is per kilogram, not per sale

`lib/commission.ts` pays `accrualToman(kg, ratePerKgToman)` on **delivered**
weight. So the drawer needs `kg_per_base_unit` (already on `products`, already
snapshotted on order lines) to convert a rate into a per-unit figure.

Under any tiered plan the answer differs at 3 units than at 30. The drawer
therefore shows the rate, the kilogram factor, and the resulting تومان, and
labels the figure as an estimate at the stated quantity. It reads the existing
tables through `lib/margin/commission.ts` and **cannot write them**.

## The drawer

Mounts inside the existing price form in `CatalogueEditor.tsx`, immediately after
the price input — not as a fourth form. Owner-only, as the whole component already is.

```
▸ محاسبه سود                        [badge: ۲۴٫۵٪ · ۱۸٬۲۰۰ تومان]
├─ بهای تمام‌شده   کالا / بسته‌بندی   [product_costs, else avg_cost_toman]
├─ هزینه‌ها        هر واحد / درصدی    [optional]
├─ پورسانت         وزن هر واحد        [needed: commission is per kg]
├─ مالیات          مبلغ دستی          [manual]
└─ صورت‌حساب کامل  حاشیه هدف          [→ price, rounded up]
```

**Asymmetric write authority**, which looks inconsistent and is not:

| What | How | Why |
|---|---|---|
| **Price** | Never written. The computed price is shown for copying. | Prices are append-only and effective-dated; `POST /api/sales/prices` stays the only writer so there is one path to history. |
| **Cost basis** | `POST /api/sales/costs` → INSERT into `product_costs`. | New data with nowhere else to live. `CatalogueEditor` has no field for it. |

Real-time: all arithmetic is client-side on values already in memory. No API call
per keystroke. Commission needs only the kg factor and rate, passed down as props.

A full breakdown ("صورت‌حساب کامل") expands to show every deduction as its own
line with its basis named, so the number is auditable rather than magic.

## Testing

Following the codebase's own split:

- **`solve.ts`** — pure boundary tests, no fixture: `C = 0` markup → `—`;
  `a + m ≥ 1` → refusal not `Infinity`; ceil-then-achieved-margin agreement;
  absent fields treated as 0; zero and negative prices; forward/reverse
  round-trip; `m ≥ 100%` refused.
- **`percent.ts`** — `toPercent("2.5") === 2.5` (**not** 3); Persian `٫` and
  Latin `.`; Persian digits `۲٫۵`; garbage → `null`; `toPercent("0") === 0`
  distinct from `toPercent("") === null`.
- **`costBasis.ts`** — fixture proving the three fallback rows above; packaging
  precedence over product-wide; `effectiveAt()` tie-break on a shared date;
  cost and price resolved on the same `onDate`.
- **`snapshotLine` integration** — **the test that proves the tool is honest.**
  Seed a `product_costs` landed row, create an order, assert
  `order_lines.unit_cost_toman` equals the landed figure and NOT `avg_cost_toman`.
  Then assert a backdated `product_costs` row does not change an order line that
  was already created. Proven non-vacuous by reverting `snapshotLine` to
  `packaging.avg_cost_toman` and watching it go red.
- **`drawer`** — rendering test that an absent field shows `—` and not `۰`, and
  that an unknown cost is marked unverified rather than shown as a confident ۲۵٪.
- **Schema** — `tests/tenancy-schema.test.ts` already covers `organization_id`
  membership; it will fail if `product_costs` is added without the `TENANT_TABLES`
  entry, which is the point.

## Conventions this must follow

- Whole تومان, `roundToman()` for every rounding. No floats into money.
- RTL Persian, IBM Plex Sans Arabic, Jalali dates, `faToman` / `faNum` / `faFixed`.
- Lucide only, through `components/meridian/icon-map.ts` and `<Icon>`.
- Every new repo function takes `organizationId` and a `Session`; tenancy
  filtering happens in `lib/repo/*`, never in a route handler. See commit
  `81ad73a` — "move the tenant check out of the API route and into the repo" —
  which moved it from `app/api/sales/commission/tiers/route.ts` into
  `lib/repo/commissionTiers.ts`.
- Comments explain *why*, in the voice already used in `lib/pricing.ts` and
  `lib/commission/tiers.ts` — including recording what went wrong first.

## Explicitly out of scope

Recorded so a later reader does not "fix" the absence:

- No tax table, no VAT, no exemption logic — manual line item only.
- No LIFO or FIFO costing engine; batches stay FEFO on expiry.
- No channel/department commission override table.
- No per-product defaults for gateway/shrinkage/return percentages in v1; they
  are typed per drawer session.
- No auto-insert of a `product_costs` row when a purchase receipt lands.
- No export, no CSV, no history chart for costs (prices have one; costs do not yet).
- **No rewrite of already-booked orders.** A backdated `product_costs` row does
  not restate `order_lines.unit_cost_toman`, for the same reason a backdated
  price does not restate revenue. If a correction is genuinely needed, it is a
  new order, not an edit.
- **No change to `products.avg_cost_toman`'s maintenance.** Purchases still own
  that column; `product_costs` only shadows it for the resolver.

