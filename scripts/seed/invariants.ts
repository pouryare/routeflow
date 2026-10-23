/** What "the demo is actually good" means, checked rather than hoped for.
 *
 *  These run LAST, against committed state, inside run.ts. A failure deletes the database — so
 *  a demo that is full of rows and wrong is never left behind to be misread as a real bug.
 *
 *  Every check is a BUSINESS claim, not "the table is non-empty". "There are rows" is how a
 *  demo passes while the lapsed cohort is quietly re-ordering every day.
 */

import type { SeedContext } from "./context";

import { mapSeq } from "@/lib/seq";
interface Check {
  label: string;
  count: number;
  min: number;
}

export async function assertInvariants(ctx: SeedContext): Promise<void> {
  const { db, scale } = ctx;
  const failures: string[] = [];

  const n = async (sql: string, ...params: Array<string | number>): Promise<number> =>
    (await db.prepare(sql).get(...params) as { c: number }).c;

  /* There is NO `leads` TABLE and NO `lead_status` COLUMN — a lead is a `customers` row whose
     `lifecycle` is one of the funnel's early stages (phase 04 writes 'lead'/'qualified'/'sampled'
     into `lifecycle`). Both were guessed wrong and caught by running the seed, not by tsc. */
  /* Each spec is a COMPLETE statement returning a `c` column, because one of them counts a
     filtered set of rows rather than a whole table. */
  const mins: Record<string, { sql: string; min: number }> = {
    districts: { sql: "SELECT COUNT(*) c FROM districts", min: 20 },
    customers: { sql: "SELECT COUNT(*) c FROM customers", min: scale.customers },
    leads: {
      sql: `SELECT COUNT(*) c FROM customers
             WHERE lifecycle IN ('lead','qualified','sampled')`,
      min: scale.leads,
    },
    orders: { sql: "SELECT COUNT(*) c FROM orders", min: scale.customers },
    "order lines": { sql: "SELECT COUNT(*) c FROM order_lines", min: scale.customers },
    deliveries: { sql: "SELECT COUNT(*) c FROM deliveries", min: 10 },
    products: { sql: "SELECT COUNT(*) c FROM products", min: 10 },
    payments: { sql: "SELECT COUNT(*) c FROM payments", min: 10 },
    journals: { sql: "SELECT COUNT(*) c FROM journals", min: 10 },
    "ledger entries": { sql: "SELECT COUNT(*) c FROM ledger_entries", min: 20 },
    batches: { sql: "SELECT COUNT(*) c FROM batches", min: 5 },
    suppliers: { sql: "SELECT COUNT(*) c FROM suppliers", min: 2 },
    tasks: { sql: "SELECT COUNT(*) c FROM tasks", min: 5 },
    forecasts: { sql: "SELECT COUNT(*) c FROM forecasts", min: 1 },
    "forecast models": { sql: "SELECT COUNT(*) c FROM forecast_models", min: 1 },
    "stock movements": { sql: "SELECT COUNT(*) c FROM stock_movements", min: 5 },
    purchases: { sql: "SELECT COUNT(*) c FROM purchases", min: 2 },
    organizations: { sql: "SELECT COUNT(*) c FROM organizations", min: 2 },
  };

  const checks: Check[] = await mapSeq(Object.entries(mins), async ([label, spec]) => ({
    label,
    count: await n(spec.sql),
    min: spec.min,
  }));

  for (const c of checks) {
    if (c.count < c.min) failures.push(`${c.label}: ${c.count} rows, expected >= ${c.min}`);
  }

  /* 1. THE SILENCE. The churn label reads "active at asOf-60d, then nothing for 60 days".
     A dormant customer with a recent order makes the label wrong, and the earlier defect lived
     here for exactly that reason — so it is asserted rather than trusted. */
  const loudDormant = await n(
    `SELECT COUNT(*) c FROM orders o
       JOIN customers cu ON cu.id = o.customer_id
      WHERE cu.lifecycle = 'dormant' AND o.order_date >= ?`,
    ctx.iso(60),
  );
  if (loudDormant > 0) {
    failures.push(
      `dormant customers have ${loudDormant} order(s) in the last 60 days — ` +
        `the churn label's silence is broken`,
    );
  }

  /* 2. The lapsed cohort exists at all, and is marked dormant. Without it, churn trains on
     nothing and silently returns "not trained". */
  const dormant = await n(`SELECT COUNT(*) c FROM customers WHERE lifecycle = 'dormant'`);
  if (dormant < scale.lapsedCustomers) {
    failures.push(`dormant customers: ${dormant}, expected >= ${scale.lapsedCustomers}`);
  }

  /* 3. NOTHING IN THE FUTURE. Every dated row is relative to asOf, so a row past the anchor
     means a daysAgo calculation went negative somewhere. */
  const futureOrders = await n(`SELECT COUNT(*) c FROM orders WHERE order_date > ?`, ctx.asOf);
  if (futureOrders > 0) failures.push(`${futureOrders} order(s) dated after the anchor ${ctx.asOf}`);

  /* 4. THE BOOKS BALANCE. Every journal must net to zero — Dr == Cr. This is the one check
     that catches a writer posting one leg, which no row count would ever notice. */
  const unbalanced = await n(
    `SELECT COUNT(*) c FROM (
       SELECT j.id
         FROM journals j
         JOIN ledger_entries e ON e.journal_id = j.id
        GROUP BY j.id
       HAVING SUM(CASE WHEN e.side = 'D' THEN e.amount_toman ELSE 0 END)
           <> SUM(CASE WHEN e.side = 'C' THEN e.amount_toman ELSE 0 END)
     )`,
  );
  if (unbalanced > 0) failures.push(`${unbalanced} journal(s) do not balance (Dr <> Cr)`);

  /* 5. Money owed is not invented: no payment exceeds its order. An over-allocation would show
     up on receivables as a negative age bucket.
     The order total is DERIVED — there is no `orders.total_toman` column — so it is recomputed
     here the way `orderTotalToman` does (lib/orderMath.ts:52), over non-reversal lines only. */
  const overpaid = await n(
    `SELECT COUNT(*) c FROM (
       SELECT pa.order_id
         FROM payment_allocations pa
         JOIN orders o ON o.id = pa.order_id
         LEFT JOIN (SELECT order_id, SUM(packs_ordered * unit_price_toman) AS line_total
                      FROM order_lines WHERE is_reversal = 0 GROUP BY order_id) l
                ON l.order_id = o.id
        GROUP BY pa.order_id
       HAVING SUM(pa.amount_toman) > COALESCE(l.line_total, 0)
     )`,
  );
  if (overpaid > 0) failures.push(`${overpaid} order(s) have allocations exceeding their total`);

  /* 6. No orphaned lines — the FKs are declared, but only for tables that HAVE them.
     delivery_stops/deliveries reference orders without CASCADE, so a bad delete leaves these. */
  const orphanLines = await n(
    `SELECT COUNT(*) c FROM order_lines l
       WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = l.order_id)`,
  );
  if (orphanLines > 0) failures.push(`${orphanLines} orphaned order line(s)`);

  /* 7. Tenant isolation is real: every customer row belongs to a real organisation. */
  const orphanCustomers = await n(
    `SELECT COUNT(*) c FROM customers cu
      WHERE cu.organization_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = cu.organization_id)`,
  );
  if (orphanCustomers > 0) failures.push(`${orphanCustomers} customer(s) with a dangling organization_id`);

  if (failures.length > 0) {
    throw new Error(
      `demo invariants failed (${failures.length}):\n  - ${failures.join("\n  - ")}`,
    );
  }

  ctx.progress(`invariants: ${checks.length + 6} checks passed`);
}
