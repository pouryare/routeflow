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

/** Every person's lifetime deductions on one ledger in one query, by user id, oldest first like
 *  `deductionsFor`. A statement page filters a period out of these rather than asking again. */
export async function deductionsByUser(db: Db, userIds: number[], ledger: ShareLedger): Promise<Map<number, DeductionItem[]>> {
  const out = new Map<number, DeductionItem[]>();
  if (userIds.length === 0) return out;
  const rows = await db
    .prepare(
      `SELECT s.user_id, o.id AS order_id, o.order_no, o.order_date, c.business_name AS customer_name, s.amount_toman
         FROM discount_commission_shares s
         JOIN order_discounts d ON d.id = s.discount_id AND d.status = 'approved'
         JOIN orders o ON o.id = s.order_id
         JOIN customers c ON c.id = o.customer_id
        WHERE s.user_id IN (${userIds.map(() => "?").join(",")}) AND s.ledger = ? AND s.amount_toman > 0
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
        ORDER BY o.order_date, o.id`
    )
    .all(...userIds, ledger) as unknown as (DeductionItem & { user_id: number })[];
  for (const { user_id, ...item } of rows) {
    const list = out.get(user_id);
    if (list) list.push(item);
    else out.set(user_id, [item]);
  }
  return out;
}

export const sumDeductions = (items: readonly DeductionItem[]) => items.reduce((t, i) => t + i.amount_toman, 0);

/** The statement fields every ledger adds: the period's deductions, the part the period's earnings
 *  cover, the part that carries forward, and what is left of the earnings. */
export function deductionFields(accrued: number, items: DeductionItem[]) {
  const total = sumDeductions(items);
  const { applied, carried } = applyDeductions(accrued, total);
  return { deductions: items, deduction_toman: total, carried_toman: carried, net_toman: accrued - applied };
}
