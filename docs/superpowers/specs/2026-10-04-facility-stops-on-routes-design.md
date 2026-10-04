# Facility stops on routes — loading from, unloading to

**Date:** 2026-10-04
**Status:** design approved in conversation; awaiting spec review
**Part of:** a three-spec sequence. Spec 1 (`2026-10-04-schedule-runs-view-design.md`) is
the runs view. Spec 2 (`2026-10-04-facilities-and-the-place-picker-design.md`) makes
facilities real and pickable. **This is spec 3, and it needs both.**

---

## 1. Why this exists

A driver loads goods at **Bākeh**, delivers the east side of Rud-e Hen and Pardis, then
returns to **the founder's house** to unload what came back. Weekly for Bākeh; the house
receives every time.

Those two visits are not stops. A stop is *"one order at one door"* — `delivery_stops`
says so in a comment, and `order_id` is `NOT NULL`. There is no way to express a visit that
is not a delivery.

Three findings from the source:

**1. The obvious shortcut silently breaks a constraint.** `delivery_stops` carries
`UNIQUE (run_id, order_id)`, which is what stops one order appearing twice on one run.
SQLite treats NULLs as distinct from each other, so making `order_id` nullable to squeeze a
facility in **turns that guard off** — with no error, just a duplicate stop. This is the
trap that makes a separate table the right answer rather than a lazy one.

**2. The ledger has the verbs and none of the calls.** `lib/repo/vanStock.ts` exports
`loadVan`, `deliverFromVan` and `vanOnHand`. **There is no way to move goods from a van
back into a building.** The return trip has no verb.

**3. Three movement kinds already exist and are unused for this.** `WRITE_OFF`, `RETURN_IN`
and `SAMPLE_OUT` are in `MovementKind` (stock.ts:7-16) and permitted by the CHECK
(db.ts:2551-2553). Nothing emits them for a van. The concept is half-designed; this spec
finishes it.

## 2. What a run carries

A run gains two things that are not stops:

| | what | when |
|---|---|---|
| **بارگیری** — load from | the facility goods go **into** the van at | **always first.** Ordered. Non-negotiable. |
| **تخلیه** — unload to | the facility goods come **back** out at | **whenever the driver decides.** End of day or middle — his call. |

The difference is the whole point, and it must survive into the data model rather than
being flattened into one ordered list. If the unload were stop 3, every time the driver
moved it every later number changed — and «مسیر» would claim an order that is not real.

## 3. Data

### 3.1 `run_facility_stops`

```
run_facility_stops
  id            PK
  run_id        → delivery_runs(id) ON DELETE CASCADE
  facility_id   → facilities(id)
  role          'load' | 'unload'
  status        'pending' | 'done'
  done_at, done_by, notes
  UNIQUE (run_id, role)
```

`UNIQUE (run_id, role)` — one load and one unload per run. `load` carries no position
because it is always first; `unload` carries no position because it has none.

Reached through `delivery_runs`, which is in `TENANT_TABLES`, so this table needs no
`organization_id` of its own — the same reasoning already recorded for `lead_run_stops`.

**One unload per run, and a second one is an amendment.** A driver who empties the van at
noon and again at six records one reconciliation whose quantities are cumulative. Two
separate unload events would need the total across them to equal what should return, which
is a harder invariant to state and to test for no operational gain.

### 3.2 The reconciliation lines

```
run_unload_lines
  id, run_id → delivery_runs ON DELETE CASCADE
  product_id → products(id)      -- which goods, from the van's manifest
  disposition 'returned' | 'damaged' | 'expired' | 'discarded' | 'lost' | 'sample'
  qty_base                        -- in base units, the app's unit of truth
  note                            -- free text, optional
  occurred_at, created_by
```

**Per product, not a bulk weight.** The van's manifest is a short list, and a driver who
breaks 5 kg of one thing and 2 cartons of another is describing two products, not one
number. The card shows kilograms derived from `qty_base` — the app shows the unit the
driver thinks in and stores the unit it can add up.

### 3.3 The rule that makes it safe

> **The dispositions for a product must sum to what should come back for that product.**

"Should come back" = loaded − delivered, from the ledger. If the driver declares less, the
sheet says so **by name and by number**: «۲۴ کیلو باید برگردد، ۲۳ اعلام شد». It never
silently accepts the difference, and it never quietly drops the missing goods.

This is the contract `commitDaySplit` already has — individual refusals collected and
returned, never thrown.

## 4. Where the manager sets it

On the run, in the runs view (spec 1). Both fields use spec 2's `PlacePicker`, which
returns a **facility id**, not just coordinates — so "this run loads from Bākeh" is stored
as Bākeh, and re-picking it a month later does not depend on coordinates still matching.

The **load** field defaults to **the last facility this driver loaded from** (spec 2 §8.2).
The **unload** field has no default — it is a choice, and an empty one is the honest state
for a run that returns everything to where it came from.

Neither field is required. A run with no load and no unload is an ordinary delivery run and
must keep working: most days nobody uses this feature, and it must not be a new thing to
fill in.

## 5. What the driver sees

Two cards above the stop list. **Neither takes a number in the sequence, and neither is
numbered.**

```
┌ بارگیری · انبار بکه ──────────── اولِ روز ──── ✓ انجام شد ┐
├ تخلیه · خانهٔ من ──────── هر وقت خواستی ──── [هنوز نکرده] ┤
│                                                            │
│  ۱  بازرگانی کیان          تحویل                 ۳.۱ ک.م  │
│  ۲  پخش البرز              تحویل                 ۱.۸ ک.م  │
│  ۳  فروشگاه امید                                ۴.۲ ک.م  │
└────────────────────────────────────────────────────────────┘
```

The unload is a **destination, not a stop.** It is always visible, it does not consume a
number, and moving it cannot disturb anybody's sequence. Its tick tells the manager whether
the extras came back — which is the question the manager actually has.

## 6. The unload reconciliation

A tap-flow, opened from the unload card. The app pre-fills every number, because it knows
what was loaded and what was delivered. **The driver confirms or corrects — never computes.**

For each product on the manifest, the sheet offers a disposition and a quantity that is
already filled in:

```
بازرگانی کیان — کارتن
  باقی‌مانده: ۶ کارتن
  ┌──────────────────────────────┐
  │ برگشت به انبار            ۴ │  ← TRANSFER_OUT + TRANSFER_IN
  │ خراب                      ۱ │  ← WRITE_OFF
  │ تاریخ مصرف گذشته            ۱ │  ← WRITE_OFF
  └──────────────────────────────┘
  ✚ خطِ دیگر اضافه کن
```

**Multiple lines per unload, freely.** The driver may add several — *خراب ۵ کیلو* and
*تاریخ مصرف گذشته ۲ کارتن* — for the same product or different ones. Each is one row with a
disposition and a quantity. The total is checked live against what should return.

### 6.1 Dispositions

| button | `disposition` | ledger |
|--------|---------------|--------|
| برگشت به انبار | `returned` | `TRANSFER_OUT` van + `TRANSFER_IN` facility |
| خراب | `damaged` | `WRITE_OFF` |
| تاریخ مصرف گذشته | `expired` | `WRITE_OFF` |
| دور ریخته شد | `discarded` | `WRITE_OFF` |
| گم شده | `lost` | `WRITE_OFF` |
| نمونه | `sample` | `SAMPLE_OUT` → the samples facility (§8) |

**خراب and تاریخ مصرف گذشته are separate buttons writing the same `WRITE_OFF`.** *"we broke
it"* and *"the supplier sent it expired"* are different problems, and a manager watching
the rates needs to see which one keeps happening.

The confirmation writes every line in **one transaction**. A half-written reconciliation is
worse than none — the van's balance would be wrong and nothing would say so.

## 7. The replacement, at the door

Not a disposition — a **delivery-time swap**, because it happens while the driver is at the
customer.

The customer says *"this is expired / this is broken."* The driver gives fresh goods.

| what happens | ledger |
|---|---|
| bad goods: customer → van | `RETURN_IN` |
| fresh goods: van → customer | `DELIVERY_OUT` |
| the customer's bill drops by the bad goods | order adjustment |

The expired boxes now sit **on the van**, so they flow into §6's reconciliation at the end
of the day. The replacement is not a special case — it is what puts the goods in the driver's
hands to begin with.

The bill adjustment is stated here because it is a money decision, not a layout one: **the
customer must not be charged for goods that arrived expired.** If the customer kept the
expired goods and paid for them, it is an ordinary delivery and no replacement is recorded.

## 8. Samples

A sample leaves the business permanently: it is given away, not stocked. **It earns a
destination, and that destination is a real facility** — one per organisation, named
«نمونه‌های داده‌شده», `kind: other`, created automatically, never edited and never deleted.

The reason it must be a facility: **every movement needs somewhere to land, or the books do
not balance.** A sample that left the van and went nowhere would leave the warehouse's
on-hand permanently wrong by exactly the sampled amount, with nothing recording that it went
wrong. A named, permanent destination makes three things true at once:

- on-hand correctly **excludes** them, because they are gone;
- *"how many samples went out this month"* is a query, not a guess;
- the audit trail survives, because `SAMPLE_OUT` already exists and has simply never been
  given a destination.

Zero price means no revenue leg, so **profit and loss are untouched.**

### 8.1 A sample earns the driver nothing

Not money, and **not kilograms.** Commission in this app is earned by weight
(`commission.kg`, spec 1 §12), so a sample that moved kilograms would hand a driver
commission for work that produced no revenue — and would do it invisibly, because the
sample sheet looks like an unload.

A disposition must therefore never produce commission. The test is structural rather than
declarative: **commission is earned on `deliveries`, and a disposition creates no delivery.**
A sample is a stock movement; a delivery is what pays.

This is a policy choice and it is recorded as one. The opposing argument is real — the
driver did load it, carry it and hand it over — and a business that wants to pay for that
should pay through an explicit allowance, not by accident through the weight of a
`SAMPLE_OUT`.

## 9. Offline

Everything here must work with no signal, because the van is where the signal is worst.

`syncPull` already pulls `SELECT *` from `orders`, `customers`, `delivery_runs` and
`delivery_stops` (spec 2 §12), so a run's facility stops and its manifest arrive with the
snapshot. The **two** new tables join `syncPull`'s reader the same way `lead_run_stops` does —
reached through `delivery_runs`, which is in `TENANT_TABLES`, so neither needs an
`organization_id` of its own.

A reconciliation is a **queued mutation**, not a lost one: the driver completes the sheet in
a tunnel, and the lines land when there is signal. `delivery_stop_id` already gives the
ledger its idempotency key; the unload lines need the same treatment so a retried sync
converges rather than double-writes the van's balance.

The one thing that must **not** be optimistic: the unload card's tick reflects the last
*confirmed* reconciliation. A queued-but-unsent one still reads as pending, because the
manager's question is *"did the extras physically come back"*, and that is only true when the
server says so.

## 10. Testing

| rule | assertion |
|------|-----------|
| a facility visit is not a stop | it does not appear in `delivery_stops`, and `UNIQUE (run_id, order_id)` is never weakened |
| one load, one unload | `UNIQUE (run_id, role)` refuses a second |
| the reconciliation balances | declaring less than should-return **refuses**, and the refusal names the gap |
| the unload is unordered | it has no `sort_order` and reordering stops does not move it |
| a sample pays nobody | a `sample` disposition creates no `deliveries` row and no commission |
| samples leave stock | warehouse on-hand falls by the sampled amount and the samples facility rises |
| replacement is not a delivery of the bad goods | the expired goods never appear as delivered |
| offline converges | a re-pushed reconciliation does not double-write the van balance |

The last one matters most: the whole feature is used in places with no signal, so a
double-write would corrupt the one number everybody trusts.

## 11. Scope

**In:** `run_facility_stops` and `run_unload_lines`, the unload verb `vanStock` is missing,
the six dispositions, the driver's two cards, the tap-flow, the door-side replacement, the
samples facility, and the sync reader.

**Out:** spec 1's runs view and spec 2's picker, both of which this consumes. The factory
case from spec 2 §3 is *supported* — a factory is just a facility a run loads from — but no
production-specific behaviour is built here.

## 12. Risks

- **A wrong reconciliation silently corrupts the van's balance.** Mitigated by the
  must-sum rule and the single transaction, but it is the sharpest edge in this spec and the
  first thing to test end to end.
- **`WRITE_OFF` and `SAMPLE_OUT` have never been emitted by `vanStock`.** They exist in the
  type and the CHECK but in no code path, so there is no precedent for their side effects.
  The first implementation is the first test.
- **A driver who unloads twice will reach for a second event.** The spec makes one
  reconciliation per run, with cumulative quantities. If that proves wrong in practice, the
  change is a `run_id` scope on the lines — not a redesign.
- **`RETURN_IN` has no writer today.** It appears in `MovementKind` and in
  `MANUAL_MOVEMENT_KINDS` (stock.ts:414-421), and nothing else emits it — a grep for writers
  returns only the list itself and a comment in `batchStates.ts`. So the door-side swap would
  give the verb its first meaning. That is convenient and also worth stating plainly: a
  second flow adopting it later would be ambiguous. This spec's use should be recorded in the
  `MovementKind` comment, which currently explains only `PURCHASE_IN` and `DELIVERY_OUT`.
