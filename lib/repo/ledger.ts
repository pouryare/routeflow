import { getDb } from "@/lib/db";
import { postJournal, type PostInput } from "./ledgerCore";
export * from "./ledgerCore";

/** The chart is global, so this lookup is deliberately NOT tenant-scoped. */
export function accountIdByCode(code: string): number | undefined {
  const row = getDb().prepare("SELECT id FROM accounts WHERE code = ?").get(code) as
    | { id: number }
    | undefined;
  return row?.id;
}

/** The wrapper for callers that are NOT already inside a transaction. Mirrors the
 *  recordPayment / recordPaymentTxn convention already in lib/repo/payments.ts. */
export function postJournalIn(input: PostInput): number {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const id = postJournal(db, input);
    db.exec("COMMIT");
    return id;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export interface TrialBalanceRow {
  accountId: number;
  code: string;
  nameFa: string;
  type: string;
  debit: number;
  credit: number;
  /** Signed in the account's own normal direction. */
  balance: number;
}

export function trialBalance(orgId: number): {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
} {
  // Grouped by account through the legs, so an account with no movement produces no row
  // at all. The reports want that: a trial balance padded with 27 empty accounts buries
  // the three that moved.
  const raw = getDb()
    .prepare(
      `SELECT a.id AS accountId, a.code, a.name_fa AS nameFa, a.type,
              a.normal_balance AS normalBalance, t.debit, t.credit
         FROM (
           /* Summed per account straight off the covering index, THEN joined to the chart: the
              other way round looks the account up once per ledger entry. */
           SELECT account_id,
                  COALESCE(SUM(CASE WHEN side = 'D' THEN amount_toman END), 0) AS debit,
                  COALESCE(SUM(CASE WHEN side = 'C' THEN amount_toman END), 0) AS credit
             FROM ledger_entries
            WHERE organization_id = ?
            GROUP BY account_id
         ) t
         JOIN accounts a ON a.id = t.account_id
        ORDER BY a.code`
    )
    .all(orgId) as Array<{
    accountId: number;
    code: string;
    nameFa: string;
    type: string;
    debit: number;
    credit: number;
    normalBalance: "DEBIT" | "CREDIT";
  }>;

  const rows: TrialBalanceRow[] = raw.map((r) => ({
    accountId: r.accountId,
    code: r.code,
    nameFa: r.nameFa,
    type: r.type,
    debit: r.debit,
    credit: r.credit,
    balance: r.normalBalance === "DEBIT" ? r.debit - r.credit : r.credit - r.debit,
  }));

  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  };
}
