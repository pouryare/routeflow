import { getDb } from "@/lib/db";
import { LedgerError, postJournal } from "./ledgerCore";

export interface PostableAccount { id: number; code: string; nameFa: string }

/** H3: the accounts a manual entry may use (postable and active). */
export async function postableAccounts(): Promise<PostableAccount[]> {
  const rows = (await getDb().prepare('SELECT id, code, name_fa AS "nameFa" FROM accounts WHERE is_postable = 1 AND active = 1 ORDER BY code').all()) as { id: number; code: string; nameFa: string }[];
  return rows.map((r) => ({ id: Number(r.id), code: r.code, nameFa: r.nameFa }));
}

/** H3: one manual سند, tagged MANUAL: debit one account, credit another, same amount (a bank fee, a loan, a correction
 *  between accounts). A reason is required. The ledger refuses a closed month and a bad account (postJournal). */
export async function postManualJournal(
  organizationId: number,
  by: number,
  input: { debitAccountId: number; creditAccountId: number; amountToman: number; memo: string; postedAt?: string },
): Promise<number> {
  const memo = input.memo.trim();
  if (memo.length === 0 || memo.length > 200) throw new LedgerError("شرح سند را بنویسید");
  if (input.debitAccountId === input.creditAccountId) throw new LedgerError("حساب بدهکار و بستانکار باید جدا باشند");
  if (!Number.isInteger(input.amountToman) || input.amountToman <= 0) throw new LedgerError("مبلغ نامعتبر است");
  const db = getDb();
  return await db.tx(() =>
    postJournal(db, {
      organizationId,
      postedAt: input.postedAt ?? new Date().toISOString(),
      sourceType: "MANUAL",
      createdBy: by,
      memo: `سند دستی: ${memo}`,
      legs: [
        { accountId: input.debitAccountId, side: "D", amountToman: input.amountToman },
        { accountId: input.creditAccountId, side: "C", amountToman: input.amountToman },
      ],
    }),
  );
}

/** H3: reverse a MANUAL سند with a reason. Only manual ones: reversing a sale or a payment here would leave its
 *  order or receipt saying the money is still there. The original stays visible; one transaction. */
export async function reverseManualJournal(organizationId: number, journalId: number, by: number, reason: string): Promise<number> {
  const why = reason.trim();
  if (why.length === 0 || why.length > 200) throw new LedgerError("دلیل ابطال را بنویسید");
  const db = getDb();
  return await db.tx(async () => {
    const j = await db.prepare("SELECT id FROM journals WHERE id = ? AND organization_id = ? AND source_type = 'MANUAL' AND memo LIKE 'سند دستی:%'").get(journalId, organizationId);
    if (!j) throw new LedgerError("سند دستی پیدا نشد");
    if (await db.prepare("SELECT 1 FROM journals WHERE reverses_journal_id = ?").get(journalId)) throw new LedgerError("این سند قبلاً باطل شده است");
    const legs = (await db.prepare("SELECT account_id, side, amount_toman FROM ledger_entries WHERE journal_id = ?").all(journalId)) as unknown as { account_id: number; side: "D" | "C"; amount_toman: number }[];
    return await postJournal(db, {
      organizationId,
      postedAt: new Date().toISOString(),
      sourceType: "REVERSAL",
      sourceId: journalId,
      reversesJournalId: journalId,
      createdBy: by,
      memo: `ابطال سند دستی: ${why}`,
      legs: legs.map((l) => ({ accountId: Number(l.account_id), side: l.side === "D" ? "C" : "D", amountToman: Number(l.amount_toman) })),
    });
  });
}
