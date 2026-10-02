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

/** Goods received: Dr inventory / Cr accounts payable, carrying the supplier.
 *
 *  This is where accounts payable comes from. Until it existed, a purchase recorded goods
 *  and the money side simply vanished -- there was no answer to "what do we owe?", which
 *  is the question the whole payables half of this section exists to answer.
 *
 *  The AP leg carries `supplierId`, and that is what makes a per-supplier statement and an
 *  ageing report possible: `supplierBalanceToman` filters on it.
 *
 *  A ZERO-total purchase posts NOTHING. `lib/purchases.ts` validates `unit_cost_toman < 0`,
 *  so a zero-cost purchase is legal today and the stock movement still happens; there is
 *  simply no money side to record, and inventing a 1-Toman leg would be fabrication. */
export function postPurchase(
  db: DatabaseSync,
  input: {
    organizationId: number;
    purchaseId: number;
    supplierId: number;
    totalToman: number;
    purchasedAt: string;
    purchasedBy: number;
  }
): number | null {
  if (input.totalToman <= 0) return null; // nothing was paid for; nothing to owe
  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.purchasedAt,
    sourceType: "PURCHASE",
    sourceId: input.purchaseId,
    createdBy: input.purchasedBy,
    memo: "ثبت خرید",
    legs: [
      { accountId: accountOrThrow("1203"), side: "D", amountToman: input.totalToman },
      {
        accountId: accountOrThrow("2101"),
        side: "C",
        amountToman: input.totalToman,
        supplierId: input.supplierId,
      },
    ],
  });
}

/** Paying a supplier: cash out, payable down.
 *
 *  An overpayment never produces a negative payable. `ledger_entries` has
 *  `CHECK (amount_toman > 0)` and the sign lives in `side`, so the direction of a movement
 *  is expressed by WHICH account is debited.
 *
 *  The SPLIT is the caller's to state, and it is stated rather than guessed:
 *  `amountToman` is the cash that actually leaves, and `payableToman` is the part of it
 *  that clears what is owed. Owe 600,000 and hand over 900,000, and the honest entry is
 *
 *      Dr 2101 accounts payable   600,000
 *      Dr 1301 prepayments        300,000   <- the excess is an asset we hold
 *         Cr 1101 cash                900,000
 *
 *  Note 1301 is DEBITED. I first wrote this crediting 1301 by the full amount, which is
 *  the intuitive-looking mistake and does not balance at all: debits 900,000 against
 *  credits 1,800,000. postJournal refused it, which is the engine earning its keep.
 *  Computing the split here instead would mean this function silently reading a balance
 *  the caller may already have decided differently. */
export function postSupplierPayment(
  db: DatabaseSync,
  input: {
    organizationId: number;
    supplierId: number;
    /** Cash actually handed over. */
    amountToman: number;
    /** The portion that clears the payable. Defaults to all of it. */
    payableToman?: number;
    method: string;
    paidAt: string;
    paidBy: number;
    /** Kept for readability at the call site; the split is what does the work. */
    overpayToPrepayment?: boolean;
    memo?: string | null;
  }
): number {
  const payable = input.payableToman ?? input.amountToman;
  if (payable > input.amountToman) {
    throw new LedgerError("مبلغ پرداختی نمی‌تواند از مبلغ پرداختنی بیشتر باشد");
  }
  const excess = input.amountToman - payable;

  return postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidAt,
    sourceType: "SUPPLIER_PAYMENT",
    createdBy: input.paidBy,
    memo: input.memo ?? "پرداخت به تأمین‌کننده",
    legs: [
      {
        accountId: accountOrThrow("2101"),
        side: "D",
        amountToman: payable,
        supplierId: input.supplierId,
      },
      ...(excess > 0
        ? [
            {
              accountId: accountOrThrow("1301"),
              side: "D" as const,
              amountToman: excess,
              supplierId: input.supplierId,
            },
          ]
        : []),
      { accountId: cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}

