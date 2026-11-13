import { getDb } from "@/lib/db";
import { ChequeError } from "@/lib/repo/cheques";

export interface BankAccountView {
  id: number;
  name: string;
  /** Cheques cleared into this account, from the ledger. */
  cleared: number;
}

/** D2: the company's bank accounts, each with the money cleared into it. */
export async function bankAccountsFor(organizationId: number): Promise<BankAccountView[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT b.id, b.name,
              COALESCE(SUM(CASE WHEN e.side = 'D' THEN e.amount_toman WHEN e.side = 'C' THEN -e.amount_toman END), 0) AS cleared
         FROM bank_accounts b
         LEFT JOIN journals j ON j.bank_account_id = b.id
         LEFT JOIN ledger_entries e ON e.journal_id = j.id AND e.account_id = (SELECT id FROM accounts WHERE code = '1102')
        WHERE b.organization_id = ?
        GROUP BY b.id, b.name ORDER BY b.id`
    )
    .all(organizationId)) as unknown as { id: number; name: string; cleared: number }[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name, cleared: Number(r.cleared) }));
}

export async function addBankAccount(organizationId: number, name: string, by: number): Promise<number> {
  const n = name.trim();
  if (n.length < 1 || n.length > 60) throw new ChequeError("نام حساب بانکی باید ۱ تا ۶۰ نویسه باشد");
  const db = getDb();
  const dup = await db.prepare("SELECT 1 AS x FROM bank_accounts WHERE organization_id = ? AND name = ?").get(organizationId, n);
  if (dup) throw new ChequeError("این حساب بانکی قبلاً ثبت شده است");
  return Number(
    (await db.prepare("INSERT INTO bank_accounts (organization_id, name, created_by, created_at) VALUES (?, ?, ?, ?)").run(organizationId, n, by, new Date().toISOString())).lastInsertRowid
  );
}
