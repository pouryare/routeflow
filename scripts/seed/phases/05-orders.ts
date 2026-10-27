/** 36 months of orders, planned onto runs and delivered.
 *
 *  Everything goes through the real writers — `createOrder`, `confirmOrder`, `createRun`,
 *  `addStop`, `recordDelivery` — so `order_events` and `deliveries` are written by the app's
 *  own code. That is the point of the design: the demo's history is not a reimplementation
 *  of the order pipeline, it IS the order pipeline.
 *
 *  FOUR RULES, each verified against the source:
 *    1. `createOrder(db, input)` takes a db and opens NO transaction (landmine: the
 *       `recordPayment`-style wrappers crash inside ours).
 *    2. `confirmOrder(db, orderId)` (lib/orders.ts:375) is the one-call DRAFT -> CONFIRMED
 *       path; it calls submitOrder then passReview itself.
 *    3. `addStop` refuses anything not CONFIRMED | PLANNED | READY (lib/delivery.ts:129), so
 *       confirm before adding.
 *    4. `createRun` requires delivery_driver in `user_roles` (lib/delivery.ts:88), which
 *       phase 01's driver has.
 */

import { createOrder, confirmOrder } from "@/lib/orders";
import { createRun, addStop, recordDelivery } from "@/lib/delivery";
import { DAY_MS, type SeedContext } from "../context";

/** Winter-slow and Nowruz-busy, so a 12-month chart is not a flat line. */
function seasonalFactor(date: Date): number {
  const month = date.getUTCMonth() + 1;
  if (month === 1 || month === 12) return 1.25;
  if (month >= 7 && month <= 9) return 0.85;
  return 1;
}

export async function run(ctx: SeedContext): Promise<void> {
  const { db, rng, scale } = ctx;
  const sellers = [ctx.staff.phone_sales, ctx.staff.field_rep, ctx.staff.rep_manager];
  const driver = ctx.staff.delivery_driver;
  const lapsed = new Set(ctx.ids.lapsedCustomerIds ?? []);
  const customers = ctx.ids.customerIds!;
  const products = ctx.ids.productIds!;

  /* Which packaging sits on which product, so a line can name both. */
  const packFor = new Map<number, number>();
  for (const p of products) {
    const row = await db.prepare(`SELECT id FROM packagings WHERE product_id = ? LIMIT 1`).get(p) as
      | { id: number }
      | undefined;
    if (row) packFor.set(p, row.id);
  }

  const days = scale.months * 30;
  /* 90, not 75. The churn label needs 60 days of silence (`trainChurnFromLapses`: active at
   * asOf-60d, no order in the following 60d), and 75 left a boundary order sitting exactly ON
   * the cutoff — measurable as 3 DELIVERED orders the backorder sweep cannot remove, because
   * deleting a delivered order throws SQLITE_CONSTRAINT_FOREIGNKEY (787). The buffer means
   * the cohort's last real order is 90+ days back and nothing can land on the boundary. */
  const LAPSED_CUTOFF = 90;
  let orders = 0;
  let delivered = 0;
  let live = 0;
  let stuck = 0;

  for (let d = days; d >= 0; d--) {
    const date = new Date(ctx.asOfMs - d * DAY_MS);
    const isoDate = date.toISOString().slice(0, 10);

    const expected =
      ((scale.customers * scale.ordersPerCustomerPerWeek) / 4.3) * seasonalFactor(date);
    const count = Math.max(0, Math.round(expected + rng.next() - 0.5));

    /* One run per driver per day — `delivery_runs` is UNIQUE (driver_user_id, run_date),
       and a driver having a run per ORDER would be nonsense besides. So the day's
       deliverable orders are collected first, then planned onto a single run. */
    const todaysOrders: number[] = [];

    /* Eligibility is computed ONCE per day rather than testing membership inside the
       per-order loop. Measured: with an inline `lapsed.has(id) && d < CUTOFF` check the
       lapsed cohort still came back with same-day orders on the anchor date, even though
       the Set provably contained their ids. Filtering the pool makes the exclusion
       structural — there is no code path that can pick a lapsed customer on a recent day —
       instead of a condition that has to hold at one call site. */
    const eligible =
      d < LAPSED_CUTOFF ? customers.filter((c) => !lapsed.has(c)) : customers;
    if (eligible.length === 0) continue;

    for (let k = 0; k < count; k++) {
      const customerId = rng.pick(eligible);

      const lines: { product_id: number; packaging_id: number; packs: number }[] = [];
      for (let l = 0; l < rng.int(1, 3); l++) {
        const productId = rng.pick(products);
        const packagingId = packFor.get(productId);
        if (packagingId) {
          lines.push({ product_id: productId, packaging_id: packagingId, packs: rng.int(1, 8) });
        }
      }
      if (lines.length === 0) continue;

      const { id: orderId } = await createOrder(db, {
        customer_id: customerId,
        order_date: isoDate,
        created_by: rng.pick(sellers),
        organization_id: ctx.orgId,
        salesperson_user_id: rng.pick(sellers),
        historical: true,
        lines,
      });
      orders++;

      /* ~4% never confirm, so the board has cards in every column and fill rate is not a
         flat 100%. */
      if (rng.chance(0.04)) {
        stuck++;
        continue;
      }

      await confirmOrder(db, orderId);

      /* A customer already near their credit limit has the order held for approval, and a held order cannot
         go on a run. Which orders that is depends on the day's accumulated balances, so it is checked here
         rather than assumed: the held ones stay on the board as pending approval. */
      const held = await db.prepare("SELECT credit_hold FROM orders WHERE id = ?").get(orderId) as { credit_hold: number } | undefined;
      if (held?.credit_hold) {
        stuck++;
        continue;
      }

      /* The last seven days stay live on the board rather than being delivered, so "today"
         is not an empty screen. */
      if (d <= 6) {
        live++;
        continue;
      }

      todaysOrders.push(orderId);
    }

    if (todaysOrders.length === 0) continue;

    const runId = await createRun(db, {
      driver_user_id: driver,
      run_date: isoDate,
      created_by: rng.pick(sellers),
      organization_id: ctx.orgId,
      group_id: rng.pick(ctx.ids.groupIds!),
    });

    let sortOrder = 0;
    for (const orderId of todaysOrders) {
      const stopId = await addStop(db, runId, orderId, sortOrder++);

      /* Collect a share of the order at the door — the cash-in-transit reality — and let the
         rest go on account, which is what phase 07's ageing buckets measure. */
      const collected = rng.chance(0.35)
        ? Number(
            (
              await db
                .prepare(
                  `SELECT COALESCE(SUM(packs_ordered * unit_price_toman * qty_per_pack), 0) v
                     FROM order_lines WHERE order_id = ?`,
                )
                .get(orderId) as { v: number }
            ).v,
          )
        : 0;

      /* `packs_delivered` must be the FULL quantity ordered, or the order is left short.
       *
       * THIS WAS THE DEFECT, twice over.
       *
       * 1. `packs_delivered: 1` on lines of 1-8 packs marked almost every order
       *    PARTIALLY_DELIVERED. Closing one SPAWNS A BACKORDER — `lib/repo/deliveries.ts:320`
       *    inserts a fresh DRAFT order for the shortfall.
       *
       * 2. That backorder is dated `new Date().toISOString()` — WALL-CLOCK TODAY, not the
       *    anchor. So seeding with `--as-of 2026-06-30` on 2026-10-03 produced 289 orders dated
       *    in the FUTURE, and every one of them belonged to the lapsed cohort, destroying the
       *    silence `trainChurnFromLapses` reads. Measured, and caught by the invariants'
       *    "nothing in the future" check.
       *
       * Delivering in full removes the cause rather than filtering the symptom: the earlier
       * backorder sweep (see the end of this file) is now belt-and-braces for whatever the
       * partial-delivery path still produces on its own. */
      const lineRows = await db
        .prepare(`SELECT id, packs_ordered FROM order_lines WHERE order_id = ?`)
        .all(orderId) as Array<{ id: number; packs_ordered: number }>;

      await recordDelivery(db, stopId, {
        lines: lineRows.map((r) => ({ line_id: r.id, packs_delivered: r.packs_ordered })),
        collected_toman: collected,
        by: driver,
        receiver_name: "تحویل گرفته شد",
      });
      /* The real writer stamps delivery with the wall clock, but the seed is replaying history:
       * left as is, every order "took" as long as it is old (a 552-day average lead time on
       * the dashboard). Delivery happened on the order's own day. */
      await db.prepare(`UPDATE orders SET delivered_at = order_date WHERE id = ? AND delivered_at IS NOT NULL`).run(orderId);
      delivered++;
    }

    await db.prepare(`UPDATE delivery_runs SET status = 'done' WHERE id = ?`).run(runId);
  }

  /* ENFORCE the lapsed cohort's silence as a POST-CONDITION rather than trusting the loop.
   *
   * The intent has always been "these customers ordered, then went quiet for 60+ days".
   * Measured, an inline membership check AND a pre-filtered pick pool both still left the
   * cohort with orders on the anchor date, despite the Set provably containing their ids —
   * so the exclusion is now applied to the finished data instead of at every call site,
   * where one missed branch cannot defeat it.
   *
   * This is the signal `churnFeaturesFor` reads: recency and the absence of orders. A single
   * stray recent order destroys the label, so this delete is the difference between a trained
   * churn model and `churn_trained: false`. */
  /* The lapsed cohort is marked dormant HERE, at the end, not in phase 04 — being dormant is
   * a CONSEQUENCE of the silence, and asserting it before the history exists does not survive
   * the order path.
   *
   * THE SILENCE NEEDS ONE MORE STEP, and finding it took the whole budget on this phase.
   *
   * The `eligible` pool above already stops the cohort being *picked* for a recent day — the
   * filter is verified working (`eligible.includes(1) === false` at d=0). That is not
   * sufficient, because `recordDelivery` on a short line marks the order PARTIALLY_DELIVERED,
   * and closing one spawns a BACKORDER: `lib/repo/deliveries.ts:315` inserts a fresh DRAFT
   * order for the shortfall. It inherits the parent's CUSTOMER but is dated TODAY
   * (`باقی‌ماندهٔ سفارش N`), so the cohort kept acquiring same-day orders no matter how the
   * pick loop behaved. Measured: 12 such orders per lapsed customer.
   *
   * So the backorders are removed. This is FK-SAFE by construction, and deliberately not
   * "delete recent orders": `deliveries` and `delivery_stops` reference `orders.id` WITHOUT
   * ON DELETE CASCADE, so deleting a delivered order throws SQLITE_CONSTRAINT_FOREIGNKEY (787)
   * — that was tried and reverted. A DRAFT order with no deliveries, stops or payments has
   * only `order_lines`, which DO cascade. Measured on the cohort: 77 backorders, 0 with
   * deliveries, 0 with stops, 0 with payments. */
  const markDormant = db.prepare(`UPDATE customers SET lifecycle = 'dormant' WHERE id = ?`);
  for (const id of lapsed) await markDormant.run(id);

  if (lapsed.size > 0) {
    const ids = [...lapsed];
    const ph = ids.map(() => "?").join(",");
    const removed = await db
      .prepare(
        `DELETE FROM orders
          WHERE customer_id IN (${ph})
            AND status = 'DRAFT'
            AND NOT EXISTS (SELECT 1 FROM deliveries    dv WHERE dv.order_id = orders.id)
            AND NOT EXISTS (SELECT 1 FROM delivery_stops ds WHERE ds.order_id = orders.id)
            AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.order_id = orders.id)
            AND order_date >= ?`,
      )
      .run(...ids, ctx.iso(LAPSED_CUTOFF));
    if (removed.changes > 0) {
      ctx.progress(`lapsed cohort: ${removed.changes} backorders removed to restore the silence`);
    }
  }

  ctx.progress(
    `${orders} orders, ${delivered} delivered, ${live} live on the board, ` +
      `${stuck} unconfirmed, ${lapsed.size} lapsed`,
  );
}
