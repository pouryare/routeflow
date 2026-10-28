/** What approved discounts take out of a person's commission, read for the commission statements.
 *
 *  Only orders that count for commission (delivered ones) carry a deduction: a returned or cancelled
 *  order voids its shares with no extra bookkeeping. Dated by the order's own date, like the accruals
 *  they are set against. */

import type { Db } from "@/lib/database/client";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { applyDeductions, type ShareLedger } from "@/lib/discounts";

export interface DeductionItem {
  order_id: number;
  order_no: string;
  order_date: string;
  customer_name: string;
  amount_toman: number;
}

export async function deductionsFor(
  db: Db,
  userId: number,
  ledger: ShareLedger,
  period: { from: string; to: string }
): Promise<DeductionItem[]> {
  return await db
    .prepare(
      `SELECT o.id AS order_id, o.order_no, o.order_date, c.business_name AS customer_name, s.amount_toman
         FROM discount_commission_shares s
         JOIN order_discounts d ON d.id = s.discount_id AND d.status = 'approved'
         JOIN orders o ON o.id = s.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE s.user_id = ? AND s.ledger = ? AND s.amount_toman > 0
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
          AND o.order_date BETWEEN ? AND ?
        ORDER BY o.order_date, o.id`
    )
    .all(userId, ledger, period.from.slice(0, 10), period.to.slice(0, 10)) as unknown as DeductionItem[];
}

const sumDeductions = (items: readonly DeductionItem[]) => items.reduce((t, i) => t + i.amount_toman, 0);

/** The statement fields every ledger adds: the period's deductions, the part the period's earnings
 *  cover, the part that carries forward, and what is left of the earnings. */
export function deductionFields(accrued: number, items: DeductionItem[]) {
  const total = sumDeductions(items);
  const { applied, carried } = applyDeductions(accrued, total);
  return { deductions: items, deduction_toman: total, carried_toman: carried, net_toman: accrued - applied };
}

const ALL_TIME = { from: "0000-01-01", to: "9999-12-31" };

/** Lifetime deductions, for «still owed»: carried amounts stay on the person until earnings cover them. */
export async function lifetimeDeductions(db: Db, userId: number, ledger: ShareLedger): Promise<number> {
  return sumDeductions(await deductionsFor(db, userId, ledger, ALL_TIME));
}
