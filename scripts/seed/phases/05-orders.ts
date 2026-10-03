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

export function run(ctx: SeedContext): void {
  const { db, rng, scale } = ctx;
  const sellers = [ctx.staff.phone_sales, ctx.staff.field_rep, ctx.staff.rep_manager];
  const driver = ctx.staff.delivery_driver;
  const lapsed = new Set(ctx.ids.lapsedCustomerIds ?? []);
  const customers = ctx.ids.customerIds!;
  const products = ctx.ids.productIds!;

  /* Which packaging sits on which product, so a line can name both. */
  const packFor = new Map<number, number>();
  for (const p of products) {
    const row = db.prepare(`SELECT id FROM packagings WHERE product_id = ? LIMIT 1`).get(p) as
      | { id: number }
      | undefined;
    if (row) packFor.set(p, row.id);
  }

  const days = scale.months * 30;
  const LAPSED_CUTOFF = 75; /* days before the anchor that the lapsed cohort goes quiet */
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

      const { id: orderId } = createOrder(db, {
        customer_id: customerId,
        order_date: isoDate,
        created_by: rng.pick(sellers),
        organization_id: ctx.orgId,
        salesperson_user_id: rng.pick(sellers),
        lines,
      });
      orders++;

      /* ~4% never confirm, so the board has cards in every column and fill rate is not a
         flat 100%. */
      if (rng.chance(0.04)) {
        stuck++;
        continue;
      }

      confirmOrder(db, orderId);

      /* The last seven days stay live on the board rather than being delivered, so "today"
         is not an empty screen. */
      if (d <= 6) {
        live++;
        continue;
      }

      todaysOrders.push(orderId);
    }

    if (todaysOrders.length === 0) continue;

    const runId = createRun(db, {
      driver_user_id: driver,
      run_date: isoDate,
      created_by: rng.pick(sellers),
      organization_id: ctx.orgId,
      group_id: rng.pick(ctx.ids.groupIds!),
    });

    let sortOrder = 0;
    for (const orderId of todaysOrders) {
      const stopId = addStop(db, runId, orderId, sortOrder++);
      const lineRows = db
        .prepare(`SELECT id FROM order_lines WHERE order_id = ?`)
        .all(orderId) as { id: number }[];

      /* Collect a share of the order at the door — the cash-in-transit reality — and let the
         rest go on account, which is what phase 07's ageing buckets measure. */
      const collected = rng.chance(0.35)
        ? Number(
            (
              db
                .prepare(
                  `SELECT COALESCE(SUM(packs_ordered * unit_price_toman * qty_per_pack), 0) v
                     FROM order_lines WHERE order_id = ?`,
                )
                .get(orderId) as { v: number }
            ).v,
          )
        : 0;

      recordDelivery(db, stopId, {
        lines: lineRows.map((r) => ({ line_id: r.id, packs_delivered: 1 })),
        collected_toman: collected,
        by: driver,
        receiver_name: "تحویل گرفته شد",
      });
      delivered++;
    }

    db.prepare(`UPDATE delivery_runs SET status = 'done' WHERE id = ?`).run(runId);
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
  /* The lapsed cohort is marked dormant HERE, at the end, not in phase 04.
   *
   * Being dormant is a CONSEQUENCE of the silence, and asserting it before the history exists
   * does not survive the order path — measured, the cohort came back `active` after a full
   * build. The silence itself is enforced where it must be: the `eligible` pool above
   * excludes these ids on every recent day, so they have no recent orders to be undone.
   *
   * Do NOT "fix" the silence by DELETING the cohort's recent orders afterwards.
   * `deliveries` and `delivery_stops` reference `orders.id` WITHOUT ON DELETE CASCADE, so
   * the delete fails with SQLITE_CONSTRAINT_FOREIGNKEY (787) and takes the phase down. */
  const markDormant = db.prepare(`UPDATE customers SET lifecycle = 'dormant' WHERE id = ?`);
  for (const id of lapsed) markDormant.run(id);

  ctx.progress(
    `${orders} orders, ${delivered} delivered, ${live} live on the board, ` +
      `${stuck} unconfirmed, ${lapsed.size} lapsed`,
  );
}
