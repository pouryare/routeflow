/* The part of the ledger that needs no connection of its own: the types, the period check and
 * postJournal(db, input), which writes through the handle it is given. Split from ledger.ts so
 * lib/database/backfills.ts (run by getDb() while the connection is being opened) can post
 * journals without importing lib/db.ts back, which was an import cycle. ledger.ts re-exports
 * all of this, so no caller changes. */
import type { Db } from "@/lib/database/client";
import { sumToman } from "@/lib/money";
import { toJalali } from "@/lib/jalali";

/** A refusal the caller shows the user, not a bug. Same shape as PaymentError, and it
 *  THROWS rather than returning a flag: a posting path that returns false invites a
 *  caller that ignores it, and an unposted journal nobody noticed is worse than a
 *  failed one. */
export class LedgerError extends Error {}

export type LedgerSide = "D" | "C";

export type LedgerSourceType =
  | "PAYMENT"
  | "CHEQUE"
  | "SALE"
  | "PURCHASE"
  | "SUPPLIER_PAYMENT"
  | "EXPENSE"
  | "OPENING"
  | "MANUAL"
  | "REVERSAL";

export interface LedgerLeg {
  accountId: number;
  side: LedgerSide;
  amountToman: number;
  customerId?: number | null;
  supplierId?: number | null;
  memo?: string | null;
}

export interface PostInput {
  organizationId: number;
  postedAt: string;
  sourceType: LedgerSourceType;
  createdBy: number;
  legs: LedgerLeg[];
  memo?: string | null;
  sourceId?: number | null;
  reversesJournalId?: number | null;
}

/** 'YYYY-MM-DD' -> '1405-04'. Derived here, never trusted from a caller: a period_key
 *  that disagrees with posted_at is how a January entry lands in a closed December. */
export function periodKeyOf(postedAt: string): string | null {
  const j = toJalali(postedAt.slice(0, 10));
  if (!j) return null;
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

async function assertPeriodOpen(db: Db, orgId: number, periodKey: string): Promise<void> {
  const existing = await db
    .prepare("SELECT status FROM fiscal_periods WHERE organization_id = ? AND period_key = ?")
    .get(orgId, periodKey) as { status: string } | undefined;

  // A MISSING period auto-creates OPEN. The backfill restores history older than any
  // period a user could have closed, so a strict reading would make it refuse its own past.
  if (!existing) {
    await db.prepare(
      `INSERT INTO fiscal_periods (organization_id, period_key, status, created_at)
       VALUES (?, ?, 'open', ?)`
    ).run(orgId, periodKey, new Date().toISOString());
    return;
  }
  if (existing.status === "closed") {
    throw new LedgerError(`دورهٔ ${periodKey} بسته است و امکان ثبت ندارد`);
  }
}

/**
 * Post one balanced journal. THE ONLY function that writes a journal.
 *
 * Deliberately does NOT open a transaction: recordDelivery already holds BEGIN IMMEDIATE
 * from lib/delivery.ts:283 across the payment call at :400, and SQLite rejects a nested
 * BEGIN -- an engine that opened its own would crash on every cash collected at a
 * delivery door, the most common money event in this app. The caller owns the
 * transaction; use postJournalIn when you are not already inside one.
 */
export async function postJournal(db: Db, input: PostInput): Promise<number> {
  const orgId = input.organizationId;
  const periodKey = periodKeyOf(input.postedAt);
  if (!periodKey) throw new LedgerError("تاریخ سند نامعتبر است");
  if (input.legs.length < 2) throw new LedgerError("سند باید حداقل دو ردیف داشته باشد");

  // sumToman THROWS on a fraction, so a float cannot enter the ledger even by accident.
  const debitTotal = sumToman(
    input.legs.filter((l) => l.side === "D").map((l) => l.amountToman)
  );
  const creditTotal = sumToman(
    input.legs.filter((l) => l.side === "C").map((l) => l.amountToman)
  );
  if (debitTotal !== creditTotal) {
    throw new LedgerError("سند تراز نیست: جمع بدهکار و بستانکار برابر نیست");
  }

  // Every leg must name a postable, active account. Checked BEFORE any insert so a bad
  // account cannot leave a half-written journal behind: a header row with no legs is the
  // one outcome that reconciles against nothing.
  const checkAcc = db.prepare("SELECT is_postable, active FROM accounts WHERE id = ?");
  for (const leg of input.legs) {
    if (!(leg.amountToman > 0)) throw new LedgerError("مبلغ ردیف باید بزرگ‌تر از صفر باشد");
    const acc = await checkAcc.get(leg.accountId) as
      | { is_postable: number; active: number }
      | undefined;
    if (!acc) throw new LedgerError("حساب یافت نشد");
    if (!acc.is_postable || !acc.active) throw new LedgerError("به این حساب نمی‌توان سند زد");
  }

  await assertPeriodOpen(db, orgId, periodKey);

  // Gapless per organization. Safe because the caller's transaction is IMMEDIATE, which
  // is what makes this read-then-write atomic -- and the reason postJournal refuses to
  // run outside one.
  const seqRow = await db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM journals WHERE organization_id = ?")
    .get(orgId) as { next: number };
  const now = new Date().toISOString();

  const journalId = Number(
    (await db
      .prepare(
        `INSERT INTO journals
           (organization_id, seq, posted_at, period_key, memo, source_type, source_id,
            reverses_journal_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        orgId,
        seqRow.next,
        input.postedAt,
        periodKey,
        input.memo ?? null,
        input.sourceType,
        input.sourceId ?? null,
        input.reversesJournalId ?? null,
        input.createdBy,
        now
      )).lastInsertRowid
  );

  const insLeg = db.prepare(
    `INSERT INTO ledger_entries
       (organization_id, journal_id, account_id, side, amount_toman, customer_id, supplier_id, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const leg of input.legs) {
    await insLeg.run(
      orgId,
      journalId,
      leg.accountId,
      leg.side,
      leg.amountToman,
      leg.customerId ?? null,
      leg.supplierId ?? null,
      leg.memo ?? null,
      now
    );
  }
  return journalId;
}
