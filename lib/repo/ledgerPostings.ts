import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { postJournal, accountIdByCode, LedgerError, type LedgerLeg } from "./ledger";
import { TRANSFER_ACCOUNTS } from "@/lib/transferAccounts";

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
  if (method === "CREDIT_NOTE" || method === "OTHER" || method === "LEFTOVER") {
    throw new LedgerError("برای این روش پرداخت باید حساب را خودتان انتخاب کنید");
  }
  const code = method === "CASH" ? "1101" : method === "CHEQUE" ? "1202" : "1102";
  return await accountOrThrow(code);
}

/** D1: cash held by field people until the office counts it. */
const HAND_CODE = "1104";

/** Where a customer receipt's money side goes. A LEFTOVER (D3) is no money coming in: the balance is forgiven, so the
 *  other side is the write-off expense. Only receipts may use it; an expense, a supplier payment or a commission paid
 *  by "LEFTOVER" is refused by cashAccountFor. A CREDIT_NOTE (B1) is goods coming back: the other side is 4102 sales returns. */
const receiptAccountFor = async (method: string): Promise<number> =>
  method === "LEFTOVER" ? await accountOrThrow("5110") : method === "CREDIT_NOTE" ? await accountOrThrow("4102") : await cashAccountFor(method);

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
    /** D1: the cash went into a person's box (1104), not the office cash account. */
    intoHand?: boolean;
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
      { accountId: input.intoHand ? await accountOrThrow(HAND_CODE) : await receiptAccountFor(input.method), side: "D", amountToman: input.amountToman },
      {
        accountId: await accountOrThrow("1201"),
        side: "C",
        amountToman: input.amountToman,
        customerId: input.customerId,
      },
    ],
  });
}

/** A cheque clears: Dr bank / Cr cheques receivable (H5).
 *
 *  The receipt put the money in 1202 when the cheque came in; without this entry it stays
 *  there for ever and the bank balance is short by every cleared cheque. */
export async function postChequeCleared(
  db: Db,
  input: {
    organizationId: number;
    chequeId: number;
    amountToman: number;
    clearedAt: string;
    clearedBy: number;
    memo?: string | null;
    bankAccountId?: number | null;
  }
): Promise<number> {
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.clearedAt,
    bankAccountId: input.bankAccountId,
    sourceType: "CHEQUE",
    sourceId: input.chequeId,
    createdBy: input.clearedBy,
    memo: input.memo ?? null,
    legs: [
      { accountId: await accountOrThrow("1102"), side: "D", amountToman: input.amountToman },
      { accountId: await accountOrThrow("1202"), side: "C", amountToman: input.amountToman },
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
    /** D1: the original cash is still in a person's box (not counted yet), so it comes out of 1104. */
    fromHand?: boolean;
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
      { accountId: input.fromHand ? await accountOrThrow(HAND_CODE) : await receiptAccountFor(input.method), side: "C", amountToman: input.amountToman },
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
/** Commission is posted by lib/repo/ledgerCommission.ts from the commission ledgers, never by hand. */
const SYSTEM_EXPENSE_CODES = [COGS_CODE, "5107", "5108", "5109", "5110", "5111"];

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
        WHERE type = 'EXPENSE' AND is_postable = 1 AND active = 1 AND code NOT IN (${SYSTEM_EXPENSE_CODES.map(() => "?").join(", ")})
        ORDER BY code`
    )
    // `as unknown as` is the house idiom off node:sqlite's Record<string, SQLOutputValue>
    // -- see listSuppliers. A direct cast is TS2352.
    .all(...SYSTEM_EXPENSE_CODES) as unknown as ExpenseCategory[];
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
    /** The group that carries this cost; none means it is shared and divided by the company's rule. */
    groupId?: number | null;
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
  if (acct.code !== COGS_CODE && SYSTEM_EXPENSE_CODES.includes(acct.code)) {
    throw new LedgerError("پورسانت و بخشودگی از جای خودشان ثبت می‌شوند و دستی ثبت نمی‌شوند");
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
      { accountId: input.accountId, side: "D", amountToman: input.amountToman, groupId: input.groupId ?? null },
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

  /* The customer's group at the time of the sale, on every leg, so a group's profit is read straight
     off the lines (the yearly split). A customer with no group leaves the lines untagged. */
  const owner = await db.prepare("SELECT group_id FROM customers WHERE id = ?").get(input.customerId) as
    | { group_id: number | null }
    | undefined;
  const groupId = owner?.group_id ?? null;

  const legs: LedgerLeg[] = [
    {
      accountId: await accountOrThrow("1201"),
      side: "D",
      amountToman: input.revenueToman,
      customerId: input.customerId,
      groupId,
    },
    { accountId: await accountOrThrow("4101"), side: "C", amountToman: input.revenueToman, groupId },
  ];

  // Only when the cost is actually known AND positive.
  if (input.costToman !== null && input.costToman > 0) {
    legs.push(
      { accountId: await accountOrThrow("5101"), side: "D", amountToman: input.costToman, groupId },
      { accountId: await accountOrThrow("1203"), side: "C", amountToman: input.costToman, groupId }
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
  return await db.tx(async () => {
    const id = await postExpense(db, input);
    return id;
  });
}

/** A4 «انتقال وجه»: money moves from one own account to another in one balanced entry; a bank fee, if any, leaves the
 *  source account too (Dr other expenses). The bank tracking number goes in the memo. Example: 5,000,000 from the box to the bank,
 *  fee 2,000, tracking 8891 → Dr bank 5,000,000, Dr fee 2,000 / Cr box 5,002,000. */
export async function postTransfer(db: Db, input: { organizationId: number; from: string; to: string; amountToman: number; feeToman?: number; postedAt: string; tracking?: string | null; by: number }): Promise<number> {
  const codes = TRANSFER_ACCOUNTS.map((a) => a.code) as string[];
  if (!codes.includes(input.from) || !codes.includes(input.to) || input.from === input.to) throw new LedgerError("حساب مبدأ و مقصد باید دو حساب متفاوت از صندوق، بانک و تنخواه باشند");
  const fee = input.feeToman ?? 0;
  if (!Number.isInteger(input.amountToman) || input.amountToman <= 0 || !Number.isInteger(fee) || fee < 0) throw new LedgerError("مبلغ نامعتبر است");
  const tracking = input.tracking?.trim();
  const legs: LedgerLeg[] = [
    { accountId: await accountOrThrow(input.to), side: "D", amountToman: input.amountToman },
    ...(fee > 0 ? [{ accountId: await accountOrThrow("5106"), side: "D" as const, amountToman: fee }] : []),
    { accountId: await accountOrThrow(input.from), side: "C", amountToman: input.amountToman + fee },
  ];
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.postedAt,
    sourceType: "MANUAL",
    createdBy: input.by,
    memo: `انتقال وجه${tracking ? ` · پیگیری ${tracking}` : ""}${fee > 0 ? " · با کارمزد" : ""}`,
    legs,
  });
}

/** postTransfer in its own transaction, for the route. */
export async function recordTransfer(input: Parameters<typeof postTransfer>[1]): Promise<number> {
  const db = getDb();
  return await db.tx(() => postTransfer(db, input));
}

/** Void an expense (H6): post the mirror entry and leave the original in the books. The «آخرین هزینه‌ها» list stops
 *  showing it (a reversal points at it); the journal and the books still show both. One transaction.
 *  Refused: a journal that is not an expense of this company, one already voided, a closed period (postJournal). */
export async function voidExpense(organizationId: number, journalId: number, actor: number, reason: string): Promise<number> {
  const why = reason.trim();
  if (why.length === 0 || why.length > 200) throw new LedgerError("دلیل باطل کردن را بنویسید");
  const db = getDb();
  return await db.tx(async () => {
    const j = (await db
      .prepare("SELECT id, posted_at FROM journals WHERE id = ? AND organization_id = ? AND source_type = 'EXPENSE'")
      .get(journalId, organizationId)) as { id: number; posted_at: string } | undefined;
    if (!j) throw new LedgerError("هزینه پیدا نشد");
    if (await db.prepare("SELECT 1 FROM journals WHERE reverses_journal_id = ?").get(journalId)) throw new LedgerError("این هزینه قبلاً باطل شده است");
    const legs = (await db
      .prepare("SELECT account_id, side, amount_toman, group_id FROM ledger_entries WHERE journal_id = ?")
      .all(journalId)) as unknown as { account_id: number; side: "D" | "C"; amount_toman: number; group_id: number | null }[];
    return await postJournal(db, {
      organizationId,
      postedAt: new Date().toISOString(),
      sourceType: "REVERSAL",
      sourceId: journalId,
      reversesJournalId: journalId,
      createdBy: actor,
      memo: `ابطال هزینه: ${why}`,
      legs: legs.map((l) => ({ accountId: Number(l.account_id), side: l.side === "D" ? "C" : "D", amountToman: Number(l.amount_toman), groupId: l.group_id === null ? null : Number(l.group_id) })),
    });
  });
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


/** D1: the office counted a person's cash. Dr office cash (what was counted) and any shortage / Cr the person's box
 *  (what was expected) and any overage. A shortage is an expense (5111), an overage reduces it. */
export async function postHandover(
  db: Db,
  input: { organizationId: number; handoverId: number; expectedToman: number; countedToman: number; postedAt: string; createdBy: number; memo: string | null }
): Promise<number> {
  const legs: LedgerLeg[] = [];
  if (input.countedToman > 0) legs.push({ accountId: await accountOrThrow("1101"), side: "D", amountToman: input.countedToman });
  if (input.countedToman < input.expectedToman) legs.push({ accountId: await accountOrThrow("5111"), side: "D", amountToman: input.expectedToman - input.countedToman });
  legs.push({ accountId: await accountOrThrow(HAND_CODE), side: "C", amountToman: input.expectedToman });
  if (input.countedToman > input.expectedToman) legs.push({ accountId: await accountOrThrow("5111"), side: "C", amountToman: input.countedToman - input.expectedToman });
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.postedAt,
    sourceType: "HANDOVER",
    sourceId: input.handoverId,
    createdBy: input.createdBy,
    memo: input.memo,
    legs,
  });
}
