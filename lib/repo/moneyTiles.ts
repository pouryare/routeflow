import { getDb } from "@/lib/db";
import { trialBalance } from "@/lib/repo/ledger";
import { agedPayables } from "@/lib/repo/reports";
import { customerDebtsForOrgOnce } from "@/lib/repo/payments";
import { tehranTodayIso } from "@/lib/jalali";

export interface MoneyTiles {
  cash: { balance: number; accountId: number | null };
  bank: { balance: number; accountId: number | null };
  owedToUs: { total: number; overdue: number };
  weOwe: { total: number; suppliers: number };
  chequesThisWeek: { n: number; total: number };
}

/** A7: the owner's money at a glance, each figure read from the page its tile opens: the cash and
 *  bank accounts' ledgers, the customer debts (overdue = older than 30 days), payables, and cheques
 *  in hand or deposited that fall due in the next 7 days. */
export async function moneyTilesFor(organizationId: number, today = tehranTodayIso()): Promise<MoneyTiles> {
  const tb = await trialBalance(organizationId);
  const acct = (code: string) => {
    const r = tb.rows.find((x) => x.code === code);
    return { balance: r?.balance ?? 0, accountId: r?.accountId ?? null };
  };
  let total = 0;
  let overdue = 0;
  for (const d of (await customerDebtsForOrgOnce(organizationId)).values()) {
    if (d.total <= 0) continue;
    total += d.total;
    overdue += Math.min(d.total, d.bucket_30_plus);
  }
  const payables = (await agedPayables(organizationId)).filter((p) => p.balanceToman > 0);
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const ch = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_toman), 0) AS total FROM cheques
        WHERE organization_id = ? AND status IN ('in_hand', 'deposited') AND due_date >= ? AND due_date <= ?`
    )
    .get(organizationId, today, week)) as { n: number; total: number };
  return {
    cash: acct("1101"),
    bank: acct("1102"),
    owedToUs: { total, overdue },
    weOwe: { total: payables.reduce((s, p) => s + p.balanceToman, 0), suppliers: payables.length },
    chequesThisWeek: { n: Number(ch.n), total: Number(ch.total) },
  };
}
