# Facility stops on routes — loading from, unloading to

**Date:** 2026-10-04
**Status:** design approved in conversation; awaiting spec review
**Part of:** a three-spec sequence. Spec 1 (`2026-10-04-schedule-runs-view-design.md`) is
the runs view. Spec 2 (`2026-10-04-facilities-and-the-place-picker-design.md`) makes
facilities real and pickable. **This is spec 3, and it needs both.**

**Audited after drafting.** A review against the source found six defects in the three specs,
three of them load-bearing: a reconciliation formula that over-counted refused deliveries, a
missing `DELIVERY_FAILED` path, and an order status (`RETURNED`) with no writer. The
corrections are in §1.4, §3.3, §7.1, §7.2 and §9. Two claims this spec previously made about
`syncPull` were **wrong** — `facilities` is not sent to drivers — and are corrected in place.

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

**4. `deliverFromVan` has no caller.** Defined at `vanStock.ts:91`, called from nowhere in
`lib/` or `app/`. **The van's balance is not being maintained today** — goods loaded at Bākeh
and delivered at noon are not tracked as having left the van. This is the reason §3.3 asks the
ledger rather than computing a figure, and it is a prerequisite, not a detail: without it there
is no correct number to reconcile against.

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

> **Should come back = `vanOnHand(van, product)`. The ledger is asked, not recomputed.**

There is no arithmetic in this spec. No `loaded − delivered`, and no term for failed
deliveries — because a failed delivery's goods never left the van, so they are already in
the balance, and adding them again would double-count.

This is only true because of one wiring rule, and this spec's most important single
requirement:

> **`deliverFromVan` fires when goods physically leave the van. A refused or skipped
> delivery does NOT call it.**

**Today `deliverFromVan` has no caller at all** (defined at `vanStock.ts:91`, called from
nowhere in `lib/` or `app/`). The van's balance is therefore not being maintained, which is
why an earlier draft of this spec reached for `loaded − delivered` — it had nothing else to
work with. That function, and the rule above, are **prerequisites**: wire them and the
formula becomes unnecessary; leave them and every reconciliation is arithmetic against a
number the ledger never agreed to.

Asking the ledger rather than recomputing it means the answer **cannot drift**, and it is
the **same answer mid-route and at the end of the day** — the balance does not care when you
ask. A driver who unloads at noon and a driver who unloads at six are both told the truth by
one function.

**Refused goods need no special case.** They are part of what is on the van, and the driver
declares them like any other goods: «برگشت به انبار», «خراب», whatever actually happened. The
confirmed inventory is the destination the run was already given — a refused delivery returns
to the same place as any other extra goods.

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

### 7.1 If the customer also refuses the replacement

Then the customer takes nothing, the order delivers nothing, and **the stop is a refusal.**

The goods the driver was going to hand over come back onto the van, and they join the §6
reconciliation like any other extras — the driver declares them at unload. The order is
**not** `DELIVERED`; nothing left the van at that door.

**The customer's balance follows the goods, not the attempt.** An adjustment was raised for
the expired line; a refusal cancels it. The customer owes nothing for goods they did not
receive, so the reversal is a credit against the order rather than a fresh charge. This is
`RETURNED`, the order status that **exists in `ORDER_STATUSES` and has no writer anywhere in
the codebase** — verified by grep across `lib/` and `app/`.

So this spec gives `RETURNED` its first writer, and gives it a precise meaning: **the customer
refused the goods, so their liability for them ends.** The stock side is `RETURN_IN` (§7) and
the order side is `RETURNED`; the two are written in the same transaction, because a half-
written return leaves goods accounted for and a customer still charged.

`RETURNED` is in `TERMINAL_ORDER_STATUSES`, so a refused replacement ends the order rather
than looping it back into the pool. That is deliberate — retrying the same goods to the same
customer who just refused them is not a plan.

### 7.2 Failed orders return to the pool

`DELIVERY_FAILED` («تحویل ناموفق») already transitions back to `PLANNED`
(`orderStateMachine.ts:104`), which means a failed order **re-enters planning by itself**.
Nothing needs building for it to come back.

What is new is that **the runs view now shows it.** The pool in spec 1 must therefore:

- **include** orders that are `PLANNED` again after a failure — they are ordinary plannable
  orders and must not need a manual rescue;
- **show the failure**, because a customer who refused yesterday is a fact the planner needs
  today. The stop's `fail_reason_id` is the reason, and the card says what it was;
- **not re-plan it into the run it just failed on**, unless the planner chooses to. A failed
  order returning to the pool is automatic; putting it straight back on the same van is a
  decision, not a default.

Spec 1's pool is therefore not "orders with no run" but "orders that can be planned", and a
failed order is in that set on the same terms as any other.

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

**`facilities` is not currently in `syncPull` — this spec has to put it there.** The reader
pulls `orders`, `customers`, `delivery_runs`, `delivery_stops`, `lead_run_stops`,
`saved_locations`, `deliveries` and `order_lines`, but **`facilities` is absent**. So today a
driver's offline bundle has no address for any warehouse, van or home — and this feature's
whole premise is that the driver **must know where he is going**. A card reading
«بارگیری · انبار بکه» with no address and no pin fails the requirement outright.

`saved_locations` is not a substitute: it is a different table, for geocoding scratch rows,
and nothing keeps it in step with `facilities`. So the reader gains a `facilities` select
alongside the two new tables — **three** additions, all scoped through `delivery_runs` and
`organization_id` in the same way as the rest.

What already works: a run's stops and its orders arrive with the snapshot, so the driver can
see his manifest offline. What does not: the destination's address. That gap is the fix.

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
| **the van balance is maintained** | a successful delivery decrements the van; **a refused one does not** |
| **the reconciliation balances** | declaring less than `vanOnHand` **refuses**, and the refusal names the gap |
| **the same answer at noon and at six** | unloading mid-route and at end of day report the same balance |
| a facility visit is not a stop | it does not appear in `delivery_stops`, and `UNIQUE (run_id, order_id)` is never weakened |
| one load, one unload | `UNIQUE (run_id, role)` refuses a second |
| the unload is unordered | it has no `sort_order` and reordering stops does not move it |
| a sample pays nobody | a `sample` disposition creates no `deliveries` row and no commission |
| samples leave stock | warehouse on-hand falls by the sampled amount and the samples facility rises |
| a refused replacement is `RETURNED` | the order ends, the customer owes nothing for the goods, and the stock is back on the van |
| a failed order is plannable again | a `DELIVERY_FAILED` order appears in the pool without manual rescue |
| **offline converges** | a re-pushed reconciliation does not double-write the van balance |
| **the driver can find the place** | an offline bundle contains the facility's address, not just its name |

The first two are the ones that matter most, and they are the ones the current codebase would
**fail**: `deliverFromVan` is never called today, so there is no test that could catch it. The
offline test is next — the whole feature is used where there is no signal, so a double-write
would corrupt the one number everybody trusts.

## 11. Scope

**In:** `run_facility_stops` and `run_unload_lines`; **`deliverFromVan` wiring** (§3.3) and
the unload verb `vanStock` does not have; the six dispositions; the driver's two cards; the
tap-flow; the door-side replacement and its refusal path (§7.1); failed orders re-entering
the pool (§7.2); the samples facility; `facilities` in `syncPull` (§9).

**Out:** spec 1's runs view and spec 2's picker, both of which this consumes. The factory
case from spec 2 §3 is *supported* — a factory is just a facility a run loads from — but no
production-specific behaviour is built here.

## 12. Risks

- **`deliverFromVan` has never been called.** The van's balance is not maintained today, so
  this spec's central number does not exist yet. Everything in §3.3 depends on wiring it
  first, and it is the single highest-value line in the implementation.
- **A wrong reconciliation silently corrupts the van's balance.** Mitigated by comparing
  against `vanOnHand` rather than a recomputed figure, and by the single transaction, but it
  remains the sharpest edge in this spec.
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
- **`RETURNED` also has no writer**, and this spec gives it one (§7.1). Same obligation: its
  meaning should be written down where the status is defined, or the next flow will invent a
  second one.
