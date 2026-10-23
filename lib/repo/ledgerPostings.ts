import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { postJournal, accountIdByCode, LedgerError, type LedgerLeg } from "./ledger";

/* Re-exported so a caller can tell a REFUSAL (show the user) from a bug, without also
   importing the engine module. postExpense and postSupplierPayment both throw it. */
export { LedgerError };

async function accountOrThrow(code: string): Promise<number> {
  const id = await accountIdByCode(code);
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
export async function cashAccountFor(method: string): Promise<number> {
  if (method === "CREDIT_NOTE" || method === "OTHER") {
    throw new LedgerError("برای این روش پرداخت باید حساب را خودتان انتخاب کنید");
  }
  const code = method === "CASH" ? "1101" : method === "CHEQUE" ? "1202" : "1102";
  return await accountOrThrow(code);
}

/** A customer receipt: Dr cash (or cheques receivable) / Cr accounts receivable.
 *
 *  No revenue leg, ever. Revenue is recognised on delivery (Task 7), because the cash
 *  arriving and the goods moving are two different events, and a design that recognises
 *  revenue on payment is wrong even when the numbers happen to agree. */
export async function postReceipt(
  db: Db,
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
): Promise<number> {
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.receivedAt,
    sourceType: "PAYMENT",
    sourceId: input.paymentId,
    createdBy: input.receivedBy,
    memo: input.memo ?? null,
    legs: [
      { accountId: await cashAccountFor(input.method), side: "D", amountToman: input.amountToman },
      {
        accountId: await accountOrThrow("1201"),
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
export async function postReceiptReversal(
  db: Db,
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
): Promise<number> {
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.reversedAt,
    sourceType: "REVERSAL",
    sourceId: input.paymentId,
    reversesJournalId: input.originalJournalId,
    createdBy: input.reversedBy,
    memo: `ابطال: ${input.reason}`,
    legs: [
      // Sides flipped: the cash comes back out, the receivable goes back up.
      { accountId: await cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
      {
        accountId: await accountOrThrow("1201"),
        side: "D",
        amountToman: input.amountToman,
        customerId: input.customerId,
      },
    ],
  });
}

/** COGS is posted by delivery recognition, never by hand. */
const COGS_CODE = "5101";

export interface ExpenseCategory {
  id: number;
  code: string;
  nameFa: string;
  nameEn: string;
}

/** The manual expense categories: every postable, ACTIVE EXPENSE account EXCEPT COGS.
 *
 *  Populated from the chart, so adding a category is adding a row -- no code change, no
 *  migration, and no reshaping of history. That is the deliberate lesson from
 *  purchases.supplier, where free text made accounts payable impossible to build.
 *
 *  `is_postable = 1` drops the group headers (5000 هزینه‌ها is a total, not a category you
 *  can spend against), and `active = 1` drops a category an owner has retired -- which is
 *  how an account is withdrawn, since accounts_no_delete forbids removing it. */
export async function expenseCategories(): Promise<ExpenseCategory[]> {
  return await getDb()
    .prepare(
      `SELECT id, code, name_fa AS nameFa, name_en AS nameEn
         FROM accounts
        WHERE type = 'EXPENSE' AND is_postable = 1 AND active = 1 AND code <> ?
        ORDER BY code`
    )
    // `as unknown as` is the house idiom off node:sqlite's Record<string, SQLOutputValue>
    // -- see listSuppliers. A direct cast is TS2352.
    .all(COGS_CODE) as unknown as ExpenseCategory[];
}

/** An expense: Dr the category / Cr cash.
 *
 *  The category is an account id, not a string. Hand-posting to COGS is refused because
 *  delivery recognition owns it, and a manual COGS line would double-count cost on the
 *  income statement -- the one number an owner reads to decide whether the business works.
 *
 *  `cashAccountFor` refuses CREDIT_NOTE and OTHER, so an expense cannot be "paid" by a
 *  method that is not money. */
export async function postExpense(
  db: Db,
  input: {
    organizationId: number;
    accountId: number;
    amountToman: number;
    method: string;
    incurredAt: string;
    incurredBy: number;
    memo?: string | null;
  }
): Promise<number> {
  const acct = await db
    .prepare("SELECT id, type, code, is_postable, active FROM accounts WHERE id = ?")
    .get(input.accountId) as
    | { id: number; type: string; code: string; is_postable: number; active: number }
    | undefined;

  if (!acct || acct.type !== "EXPENSE" || !acct.is_postable || !acct.active) {
    throw new LedgerError("این حساب، حساب هزینه نیست");
  }
  if (acct.code === COGS_CODE) {
    throw new LedgerError("بهای تمام‌شده با تحویل کالا ثبت می‌شود و دستی ثبت نمی‌شود");
  }

  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.incurredAt,
    sourceType: "EXPENSE",
    createdBy: input.incurredBy,
    memo: input.memo ?? null,
    legs: [
      { accountId: input.accountId, side: "D", amountToman: input.amountToman },
      { accountId: await cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}

/** Revenue and cost recognised on a delivery: Dr AR / Cr revenue, plus Dr COGS / Cr inventory.
 *
 *  This is where revenue is recognised -- NOT on the order and NOT on the payment. A receipt
 *  posts Dr cash / Cr AR (Task 4); the goods moving is a different event, and recognising
 *  revenue on payment is wrong even when the two numbers happen to agree.
 *
 *  `costToman` of null OR 0 means the cost is not known, and the revenue leg posts ALONE.
 *  A fabricated cost would put a wrong number on the income statement, and a wrong number
 *  that looks right is worse than an absent one. Zero is the real "unknown" signal here:
 *  `order_lines.unit_cost_toman` DEFAULTs to 0, which is how "never purchased, so nothing is
 *  known" is recorded (lib/orders.ts:166).
 *
 *  Returns null when there is nothing to post, or when this stop was ALREADY recognised for
 *  this tenant -- the guard that makes a retried sync converge instead of stacking a second
 *  revenue journal. The check is scoped by `organization_id` as well as `source_id`: a
 *  delivery_stops id is unique per row, but an unscoped lookup would let one tenant's stop
 *  suppress another's recognition, which is a silent revenue loss. */
export async function postDeliveryRecognition(
  db: Db,
  input: {
    organizationId: number;
    deliveryStopId: number;
    customerId: number;
    deliveredAt: string;
    deliveredBy: number;
    revenueToman: number;
    costToman: number | null;
  }
): Promise<number | null> {
  if (!(input.revenueToman > 0)) return null; // nothing went out

  const already = await db
    .prepare(
      "SELECT id FROM journals WHERE organization_id = ? AND source_type = 'SALE' AND source_id = ? LIMIT 1"
    )
    .get(input.organizationId, input.deliveryStopId);
  if (already) return null;

  const legs: LedgerLeg[] = [
    {
      accountId: await accountOrThrow("1201"),
      side: "D",
      amountToman: input.revenueToman,
      customerId: input.customerId,
    },
    { accountId: await accountOrThrow("4101"), side: "C", amountToman: input.revenueToman },
  ];

  // Only when the cost is actually known AND positive.
  if (input.costToman !== null && input.costToman > 0) {
    legs.push(
      { accountId: await accountOrThrow("5101"), side: "D", amountToman: input.costToman },
      { accountId: await accountOrThrow("1203"), side: "C", amountToman: input.costToman }
    );
  }

  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.deliveredAt,
    sourceType: "SALE",
    sourceId: input.deliveryStopId,
    createdBy: input.deliveredBy,
    memo: "تحویل کالا",
    legs,
  });
}

/** Record an expense, opening its own transaction.
 *
 *  The wrapper exists so NO ROUTE ever runs `BEGIN IMMEDIATE`. `tests/repo-boundary.test.ts`
 *  fails the build for raw SQL outside `lib/repo/`, and the plan's original route did
 *  exactly that -- so the transaction moved here, mirroring recordPayment / recordPaymentTxn.
 *  A route that opened its own transaction could also get the nesting wrong against a
 *  caller already inside one, which is the crash Task 2 spent a mutation proving.
 *
 *  `postExpense` takes a db and opens nothing, and stays the only writer of a journal. */
export async function recordExpense(
  input: Parameters<typeof postExpense>[1]
): Promise<number> {
  const db = getDb();
  await db.exec("BEGIN IMMEDIATE");
  try {
    const id = await postExpense(db, input);
    await db.exec("COMMIT");
    return id;
  } catch (e) {
    await db.exec("ROLLBACK");
    throw e;
  }
}

export async function receiptJournalIdFor(paymentId: number): Promise<number | undefined> {
  const row = await getDb()
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
export async function postPurchase(
  db: Db,
  input: {
    organizationId: number;
    purchaseId: number;
    supplierId: number;
    totalToman: number;
    purchasedAt: string;
    purchasedBy: number;
  }
): Promise<number | null> {
  if (input.totalToman <= 0) return null; // nothing was paid for; nothing to owe
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.purchasedAt,
    sourceType: "PURCHASE",
    sourceId: input.purchaseId,
    createdBy: input.purchasedBy,
    memo: "ثبت خرید",
    legs: [
      { accountId: await accountOrThrow("1203"), side: "D", amountToman: input.totalToman },
      {
        accountId: await accountOrThrow("2101"),
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
export async function postSupplierPayment(
  db: Db,
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
): Promise<number> {
  const payable = input.payableToman ?? input.amountToman;
  if (payable > input.amountToman) {
    throw new LedgerError("مبلغ پرداختی نمی‌تواند از مبلغ پرداختنی بیشتر باشد");
  }
  const excess = input.amountToman - payable;

  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidAt,
    sourceType: "SUPPLIER_PAYMENT",
    createdBy: input.paidBy,
    memo: input.memo ?? "پرداخت به تأمین‌کننده",
    legs: [
      {
        accountId: await accountOrThrow("2101"),
        side: "D",
        amountToman: payable,
        supplierId: input.supplierId,
      },
      ...(excess > 0
        ? [
            {
              accountId: await accountOrThrow("1301"),
              side: "D" as const,
              amountToman: excess,
              supplierId: input.supplierId,
            },
          ]
        : []),
      { accountId: await cashAccountFor(input.method), side: "C", amountToman: input.amountToman },
    ],
  });
}

