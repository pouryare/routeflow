import { getDb } from "@/lib/db";

/** The photo of the paper behind an expense (one per journal). The journal must be an EXPENSE of the
 *  caller's own organisation; everything else answers "not found". */
export interface ExpenseReceipt {
  id: number;
  journal_id: number;
  file_stem: string;
  created_at: string;
}

export const isOwnExpense = async (organizationId: number, journalId: number): Promise<boolean> =>
  !!await getDb()
    .prepare("SELECT 1 FROM journals WHERE id = ? AND organization_id = ? AND source_type = 'EXPENSE'")
    .get(journalId, organizationId);

export async function receiptFor(organizationId: number, journalId: number): Promise<ExpenseReceipt | null> {
  if (!await isOwnExpense(organizationId, journalId)) return null;
  const row = await getDb()
    .prepare("SELECT id, journal_id, file_stem, created_at FROM expense_receipts WHERE journal_id = ? AND organization_id = ?")
    .get(journalId, organizationId);
  return row ? { ...(row as unknown as ExpenseReceipt) } : null;
}

/** Attach (or replace) the receipt. Returns the stem it replaced, so the caller can delete those
 *  files, or null when there was none; throws when the journal is not this organisation's expense. */
export async function saveReceipt(organizationId: number, journalId: number, userId: number, stem: string): Promise<{ replaced: string | null }> {
  if (!await isOwnExpense(organizationId, journalId)) throw new Error("هزینه پیدا نشد");
  const db = getDb();
  const prev = await db.prepare("SELECT file_stem FROM expense_receipts WHERE journal_id = ?").get(journalId) as { file_stem: string } | undefined;
  if (prev) await db.prepare("DELETE FROM expense_receipts WHERE journal_id = ?").run(journalId);
  await db.prepare("INSERT INTO expense_receipts (organization_id, journal_id, file_stem, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(
    organizationId,
    journalId,
    stem,
    userId,
    new Date().toISOString(),
  );
  return { replaced: prev?.file_stem ?? null };
}

/** The journal ids (of those given) that have a receipt, for showing a «رسید» link. */
export async function journalsWithReceipt(organizationId: number, journalIds: number[]): Promise<Set<number>> {
  if (journalIds.length === 0) return new Set();
  const rows = await getDb()
    .prepare(`SELECT journal_id FROM expense_receipts WHERE organization_id = ? AND journal_id IN (${journalIds.map(() => "?").join(",")})`)
    .all(organizationId, ...journalIds) as { journal_id: number }[];
  return new Set(rows.map((r) => r.journal_id));
}
