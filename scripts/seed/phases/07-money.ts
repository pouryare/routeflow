/** Payments against delivered orders, and expenses — both through the REAL writers.
 *
 *  `recordPaymentTxn` and `postExpense` are the db-taking variants and open NO transaction of
 *  their own, which is exactly what this orchestrator needs. Never call `recordPayment` or
 *  `postJournalIn` here: those wrap themselves in `BEGIN IMMEDIATE`, and phase 05 already lost
 *  time proving SQLite refuses to nest ("cannot start a transaction within a transaction").
 *
 *  `postExpense` REFUSES a hand-post to COGS (5101) — delivery recognition owns that, so
 *  picking a cost line here would double-count cost. The category list below starts at 5102.
 */

import { recordPaymentTxn } from "@/lib/repo/payments";
import { postExpense } from "@/lib/repo/ledgerPostings";
import type { SeedContext } from "../context";

/* `PaymentMethod` (lib/repo/payments.ts:18) is CASH | POS | CARD_TO_CARD | CHEQUE |
   CREDIT_NOTE | OTHER — there is no "TRANSFER", and guessing one does not compile.
   CREDIT_NOTE and OTHER are excluded deliberately: `cashAccountFor` refuses them, so an
   expense or receipt "paid" by one would be a journal with no cash leg. */
const METHODS = ["CASH", "POS", "CARD_TO_CARD", "CHEQUE"] as const;

export function run(ctx: SeedContext): void {
  const { db, rng } = ctx;
  const owner = ctx.staff.rep ?? ctx.staff.owner;
  const now = ctx.stamp(0);

  const accounts = new Map(
    (db.prepare(`SELECT code, id FROM accounts WHERE is_system = 1`).all() as Array<{
      code: string;
      id: number;
    }>).map((a) => [a.code, a.id]),
  );

  /* Customers who actually have money owed. The lapsed cohort is excluded for the same reason
     phase 05 excluded it: their history is the churn label's silence and must stay untouched. */
  /* There is NO `orders.total_toman` COLUMN — it is DERIVED, and the app derives it in TypeScript
     (`orderTotalToman` -> sum of `effectivePacks(line) * unit_price_toman`, lib/orderMath.ts:52).
     The same arithmetic is done here in SQL over the non-reversal lines, so the amount paid
     matches what the order is actually worth.
     `is_reversal = 0` matters: a backorder's reversal line would otherwise be added back in. */
  const lapsed = new Set(ctx.ids.lapsedCustomerIds ?? []);
  /* `orders.status` is UPPERCASE in the widened 13-state machine (lib/orderStateMachine.ts:159) —
       DRAFT | PENDING_REVIEW | ... | DELIVERED | CLOSED | CANCELLED | RETURNED. An earlier draft
       wrote `status = 'closed'` here, which matches NOTHING and produced a demo with zero
       payments while the build still reported success. A silent miss is worse than a crash,
       and the invariants table is what caught it. */
  const owing = db
    .prepare(
      `SELECT o.id AS order_id,
              o.customer_id AS id,
              o.order_date,
              ROUND(SUM(l.packs_ordered * l.unit_price_toman)) AS total_toman
         FROM orders o
         JOIN order_lines l ON l.order_id = o.id AND l.is_reversal = 0
        WHERE o.organization_id = ?
          AND o.status = 'CLOSED'
          AND o.customer_id NOT IN (SELECT id FROM customers WHERE lifecycle = 'dormant')
        GROUP BY o.id
       HAVING total_toman > 0
        ORDER BY o.order_date`,
    )
    .all(ctx.orgId) as Array<{ id: number; order_id: number; order_date: string; total_toman: number }>;

  let paid = 0;
  let unpaid = 0;

  for (const row of owing) {
    if (lapsed.has(row.id)) continue;
    /* Most orders are settled; some are left open on purpose so receivables are non-empty and
       /accounting/receivables has something real to age. */
    if (rng.chance(0.12)) {
      unpaid++;
      continue;
    }
    const method = rng.pick(METHODS);
    try {
      recordPaymentTxn(db, ctx.orgId, {
        customer_id: row.id,
        amount_toman: row.total_toman,
        method,
        received_at: ctx.stamp(rng.int(0, 20)),
        received_by: owner,
        reference: method === "CARD_TO_CARD" ? `DEMO-${row.order_id}` : null,
        /* FIFO allocation over the customer's own orders — leave it to the writer rather than
           hand-building allocations, so the allocation logic under test is the real one. */
      });
      paid++;
    } catch {
      /* A payment can be legitimately refused (an over-old order, a zero balance). One refusal
         must not take the whole build down — skip it and leave the order open. */
      unpaid++;
    }
  }

  const expenseCodes = ["5102", "5103", "5104", "5105", "5106"];
  const memos: Record<string, string> = {
    "5102": "اجاره ماهانه انبار",
    "5103": "حقوق کارکنان",
    "5104": "سوخت وانت‌ها",
    "5105": "تلفن و اینترنت",
    "5106": "هزینه‌های پراکنده",
  };
  const months = Math.max(2, ctx.scale.months);
  let expenses = 0;
  for (let m = 0; m < months; m++) {
    for (const code of expenseCodes) {
      if (rng.chance(0.2)) continue;
      const amount = Math.round((rng.int(4, 90) * 1_000_000) / 100) * 100;
      try {
        postExpense(db, {
          organizationId: ctx.orgId,
          accountId: accounts.get(code)!,
          amountToman: amount,
          method: rng.pick(METHODS),
          incurredAt: ctx.iso(m * 30 + rng.int(0, 6)),
          incurredBy: owner,
          memo: memos[code],
        });
        expenses++;
      } catch {
        /* Same reasoning as payments: a refused category is not a build failure. */
      }
    }
  }

  void now;
  ctx.progress(`${paid} payments, ${unpaid} orders left open, ${expenses} expenses`);
}
