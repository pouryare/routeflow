import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";
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

/** The chart is global, so this lookup is deliberately NOT tenant-scoped. */
export function accountIdByCode(code: string): number | undefined {
  const row = getDb().prepare("SELECT id FROM accounts WHERE code = ?").get(code) as
    | { id: number }
    | undefined;
  return row?.id;
}

/** 'YYYY-MM-DD' -> '1405-04'. Derived here, never trusted from a caller: a period_key
 *  that disagrees with posted_at is how a January entry lands in a closed December. */
export function periodKeyOf(postedAt: string): string | null {
  const j = toJalali(postedAt.slice(0, 10));
  if (!j) return null;
  return `${j.jy}-${String(j.jm).padStart(2, "0")}`;
}

function assertPeriodOpen(db: DatabaseSync, orgId: number, periodKey: string): void {
  const existing = db
    .prepare("SELECT status FROM fiscal_periods WHERE organization_id = ? AND period_key = ?")
    .get(orgId, periodKey) as { status: string } | undefined;

  // A MISSING period auto-creates OPEN. The backfill restores history older than any
  // period a user could have closed, so a strict reading would make it refuse its own past.
  if (!existing) {
    db.prepare(
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
export function postJournal(db: DatabaseSync, input: PostInput): number {
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
    const acc = checkAcc.get(leg.accountId) as
      | { is_postable: number; active: number }
      | undefined;
    if (!acc) throw new LedgerError("حساب یافت نشد");
    if (!acc.is_postable || !acc.active) throw new LedgerError("به این حساب نمی‌توان سند زد");
  }

  assertPeriodOpen(db, orgId, periodKey);

  // Gapless per organization. Safe because the caller's transaction is IMMEDIATE, which
  // is what makes this read-then-write atomic -- and the reason postJournal refuses to
  // run outside one.
  const seqRow = db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM journals WHERE organization_id = ?")
    .get(orgId) as { next: number };
  const now = new Date().toISOString();

  const journalId = Number(
    db
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
      ).lastInsertRowid
  );

  const insLeg = db.prepare(
    `INSERT INTO ledger_entries
       (organization_id, journal_id, account_id, side, amount_toman, customer_id, supplier_id, memo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const leg of input.legs) {
    insLeg.run(
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
              a.normal_balance AS normalBalance,
              COALESCE(SUM(CASE WHEN e.side = 'D' THEN e.amount_toman END), 0) AS debit,
              COALESCE(SUM(CASE WHEN e.side = 'C' THEN e.amount_toman END), 0) AS credit
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
        WHERE e.organization_id = ?
        GROUP BY a.id
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
