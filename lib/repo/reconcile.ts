import { getDb } from "@/lib/db";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { reconcileGap, signedAmount } from "@/lib/reconcile";
import { TRANSFER_ACCOUNTS } from "@/lib/transferAccounts";

interface ReconcileLine { id: number; postedAt: string; memo: string | null; signed: number }
export interface ReconcileView { accountId: number; lockedToman: number; lines: ReconcileLine[] }

async function accountIdOf(code: string): Promise<number> {
  const row = (await getDb().prepare("SELECT id FROM accounts WHERE code = ?").get(code)) as { id: number } | undefined;
  if (!row || !TRANSFER_ACCOUNTS.some((a) => a.code === code)) throw new LedgerError("حساب پیدا نشد");
  return Number(row.id);
}

/** The lines of a cash or bank account not yet ticked, oldest first, and the sum of those already locked. */
export async function reconcileView(organizationId: number, code: string): Promise<ReconcileView> {
  const db = getDb();
  const accountId = await accountIdOf(code);
  const locked = (await db
    .prepare("SELECT COALESCE(SUM(CASE WHEN e.side = 'D' THEN e.amount_toman ELSE -e.amount_toman END), 0) AS s FROM reconciled_entries r JOIN ledger_entries e ON e.id = r.ledger_entry_id WHERE r.organization_id = ? AND e.account_id = ?")
    .get(organizationId, accountId)) as { s: number };
  const rows = (await db
    .prepare(
      `SELECT e.id, e.side, e.amount_toman, COALESCE(e.memo, j.memo) AS memo, j.posted_at
         FROM ledger_entries e JOIN journals j ON j.id = e.journal_id
        WHERE e.organization_id = ? AND e.account_id = ? AND NOT EXISTS (SELECT 1 FROM reconciled_entries r WHERE r.ledger_entry_id = e.id)
        ORDER BY j.posted_at, e.id LIMIT 500`
    )
    .all(organizationId, accountId)) as unknown as { id: number; side: "D" | "C"; amount_toman: number; memo: string | null; posted_at: string }[];
  return { accountId, lockedToman: Number(locked.s), lines: rows.map((r) => ({ id: Number(r.id), postedAt: r.posted_at, memo: r.memo, signed: signedAmount(r.side, Number(r.amount_toman)) })) };
}

/** Lock the ticked lines when the counted balance matches them exactly. A mistake after that is fixed by a reversal. */
export async function saveReconcile(organizationId: number, code: string, countedToman: number, entryIds: number[], by: number): Promise<void> {
  const view = await reconcileView(organizationId, code);
  const byId = new Map(view.lines.map((l) => [l.id, l.signed]));
  const ids = [...new Set(entryIds)];
  if (ids.length === 0 || ids.some((id) => !byId.has(id))) throw new LedgerError("خط‌های انتخاب‌شده معتبر نیستند");
  const ticked = ids.reduce((s, id) => s + (byId.get(id) ?? 0), 0);
  if (reconcileGap(countedToman, view.lockedToman, ticked) !== 0) throw new LedgerError("اختلاف هنوز صفر نیست");
  const db = getDb();
  await db.tx(async () => {
    const rec = Number((await db.prepare("INSERT INTO reconciliations (organization_id, account_id, counted_toman, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(organizationId, view.accountId, countedToman, by, new Date().toISOString())).lastInsertRowid);
    for (const id of ids) await db.prepare("INSERT INTO reconciled_entries (ledger_entry_id, organization_id, reconciliation_id) VALUES (?, ?, ?)").run(id, organizationId, rec);
  });
}
