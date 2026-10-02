import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
import { postJournal, accountIdByCode, LedgerError } from "./ledger";

function accountOrThrow(code: string): number {
  const id = accountIdByCode(code);
  if (!id) throw new LedgerError(`حساب ${code} یافت نشد`);
  return id;
}

/** Which account a payment method lands in.
 *
 *  A map in code, not a lookup table: there are six methods and this is accounting
 *  POLICY, not data. CREDIT_NOTE and OTHER are deliberately refused -- a credit note
 *  is not cash in, and OTHER needs the user to pick an account rather than have the app
 *  guess on their behalf. Guessing is how a receipt lands in the wrong ledger and nobody
 *  notices for a quarter. */
export function cashAccountFor(method: string): number {
  if (method === "CREDIT_NOTE" || method === "OTHER") {
    throw new LedgerError("برای این روش پرداخت باید حساب را خودتان انتخاب کنید");
  }
  const code = method === "CASH" ? "1101" : method === "CHEQUE" ? "1202" : "1102";
  return accountOrThrow(code);
}

/** A customer receipt: Dr cash (or cheques receivable) / Cr accounts receivable.
 *
 *  No revenue leg, ever. Revenue is recognised on delivery (Task 7), because the cash
 *  arriving and the goods moving are two different events, and a design that recognises
 *  revenue on payment is wrong even when the numbers happen to agree. */
export function postReceipt(
  db: DatabaseSync,
  input: {
    organizationId: number;
    paymentId: number;
    customerId: number;
    amountToman: number;
    method: string;
    receivedAt: string;
    receivedBy: number;
    memo?: string | null;
  }
): number {
  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.receivedAt,
    sourceType: "PAYMENT",
    sourceId: input.paymentId,
    createdBy: input.receivedBy,
    memo: input.memo ?? null,
    legs: [
      { accountId: cashAccountFor(input.method), side: "D", amountToman: input.amountToman },
      {
        accountId: accountOrThrow("1201"),
        side: "C",
        amountToman: input.amountToman,
        customerId: input.customerId,
      },
    ],
  });
}

/** Undo a receipt by posting the mirror image, referencing the original.
 *
 *  Nothing is edited or deleted. The reversal points back at the journal it cancels, so
 *  a reader sees the story of what happened instead of one quietly-corrected number. */
export function postReceiptReversal(
  db: DatabaseSync,
  input: {
    organizationId: number;
    paymentId: number;
    customerId: number;
    amountToman: number;
    method: string;
    originalJournalId: number;
    reversedAt: string;
    reversedBy: number;
    reason: string;
  }
): number {
  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.reversedAt,
    sourceType: "REVERSAL",
    sourceId: input.paymentId,
    reversesJournalId: input.originalJournalId,
    createdBy: input.reversedBy,
    memo: `ابطال: ${input.reason}`,
    legs: [
      // Sides flipped: the cash comes back out, the receivable goes back up.
      { accountId: cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
      {
        accountId: accountOrThrow("1201"),
        side: "D",
        amountToman: input.amountToman,
        customerId: input.customerId,
      },
    ],
  });
}

/** The journal a payment's receipt produced, or undefined if it has none yet. */
export function receiptJournalIdFor(paymentId: number): number | undefined {
  const row = getDb()
    .prepare(
      "SELECT id FROM journals WHERE source_type = 'PAYMENT' AND source_id = ? ORDER BY id LIMIT 1"
    )
    .get(paymentId) as { id: number } | undefined;
  return row?.id;
}
