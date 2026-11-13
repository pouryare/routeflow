import { getDb } from "@/lib/db";
import { MONEY_CODES, moneyLabel, splitMoney, type MoneyFlow } from "@/lib/moneyFlow";

const IN_LIST = MONEY_CODES.map(() => "?").join(",");

/** A5: money in and out of the cash and bank accounts for one month, read from the ledger legs. Expenses are named by
 *  their category; everything else by what posted it. */
export async function moneyFlow(organizationId: number, periodKey: string): Promise<MoneyFlow> {
  const db = getDb();
  const open = (await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN e.side = 'D' THEN e.amount_toman ELSE -e.amount_toman END), 0) AS n
         FROM ledger_entries e JOIN journals j ON j.id = e.journal_id JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND a.code IN (${IN_LIST}) AND j.period_key < ?`
    )
    .get(organizationId, ...MONEY_CODES, periodKey)) as { n: number };
  const rows = (await db
    .prepare(
      `SELECT CASE WHEN j.source_type = 'EXPENSE'
                   THEN COALESCE((SELECT a2.name_fa FROM ledger_entries e2 JOIN accounts a2 ON a2.id = e2.account_id
                                   WHERE e2.journal_id = j.id AND e2.side = 'D' AND a2.type = 'EXPENSE' LIMIT 1), 'هزینه')
                   ELSE j.source_type END AS label,
              SUM(CASE WHEN e.side = 'D' THEN e.amount_toman ELSE -e.amount_toman END) AS net
         FROM ledger_entries e JOIN journals j ON j.id = e.journal_id JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ? AND a.code IN (${IN_LIST}) AND j.period_key = ?
        GROUP BY 1`
    )
    .all(organizationId, ...MONEY_CODES, periodKey)) as { label: string; net: number }[];
  return splitMoney(Number(open.n), rows.map((r) => ({ label: r.label === "هزینه" || /[^A-Z_]/.test(r.label) ? r.label : moneyLabel(r.label), net: Number(r.net) })));
}
