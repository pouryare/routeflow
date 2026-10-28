/** Commission in the ledger.
 *
 *  The commission ledgers (commissionLedger, driverCommissionLedger, managerCommissionLedger) stay the
 *  source of what each person has earned: accruals are derived from delivered weight and the rate in force,
 *  so a backdated rate restates them. The books follow that figure instead of copying it:
 *
 *   - `syncCommissionAccrual` brings the books up to the lifetime accrual: Dr commission expense (the
 *     kind's account, tagged with the person's group) / Cr 2103 (tagged with the person). It posts only
 *     the DIFFERENCE from what the books already hold, so running it twice posts nothing, and a backdated
 *     rate cut posts a reversing difference rather than editing an old journal.
 *   - `postCommissionPayment` records money that left: Dr 2103 / Cr cash. A negative payment (a claw-back)
 *     swaps the sides.
 *
 *  Profit on the income statement is therefore after commission once the sync has run. */
import type { Db } from "@/lib/database/client";
import { allStatements, statementFor } from "@/lib/commissionLedger";
import { allDriverStatements, driverStatementFor } from "@/lib/driverCommissionLedger";
import { allManagerStatements, managerStatementFor } from "@/lib/managerCommissionLedger";
import { mapSeq } from "@/lib/seq";
import { postJournal, LedgerError, type LedgerLeg } from "./ledgerCore";
import { accountIdByCode } from "./ledger";
import { cashAccountFor } from "./ledgerPostings";
import { ensureStaffParty } from "./parties";

export type CommissionKind = "sales" | "driver" | "manager";

const EXPENSE_CODE: Record<CommissionKind, string> = { sales: "5107", driver: "5108", manager: "5109" };
const PAYABLE_CODE = "2103";
const KIND_FA: Record<CommissionKind, string> = { sales: "فروشنده", driver: "راننده", manager: "مدیر گروه" };
const EVERYTHING = { from: "0000-01-01", to: "9999-12-31" };

async function account(code: string): Promise<number> {
  const id = await accountIdByCode(code);
  if (!id) throw new LedgerError(`حساب ${code} یافت نشد`);
  return id;
}

async function groupOf(db: Db, userId: number): Promise<number | null> {
  const row = await db.prepare("SELECT group_id FROM users WHERE id = ?").get(userId) as
    | { group_id: number | null }
    | undefined;
  return row?.group_id ?? null;
}

/** Net debit the books hold on a kind's expense account for one person. */
async function postedAccrual(db: Db, organizationId: number, partyId: number, expenseAccountId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN side = 'D' THEN amount_toman ELSE -amount_toman END), 0) AS net
         FROM ledger_entries WHERE organization_id = ? AND party_id = ? AND account_id = ?`
    )
    .get(organizationId, partyId, expenseAccountId) as { net: number };
  return Number(row.net);
}

/** Post the difference between what a person has accrued (lifetime) and what the books hold. Returns the journal id, or null when they agree. */
async function syncPersonAccrual(
  db: Db,
  input: { organizationId: number; kind: CommissionKind; personId: number; accruedToman: number; asOf: string; createdBy: number }
): Promise<number | null> {
  const expenseId = await account(EXPENSE_CODE[input.kind]);
  const partyId = await ensureStaffParty(db, input.organizationId, input.personId);
  const diff = input.accruedToman - (await postedAccrual(db, input.organizationId, partyId, expenseId));
  if (diff === 0) return null;

  const groupId = await groupOf(db, input.personId);
  const amount = Math.abs(diff);
  const legs: LedgerLeg[] = [
    { accountId: expenseId, side: diff > 0 ? "D" : "C", amountToman: amount, partyId, groupId },
    { accountId: await account(PAYABLE_CODE), side: diff > 0 ? "C" : "D", amountToman: amount, partyId, groupId },
  ];
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.asOf,
    sourceType: "COMMISSION",
    sourceId: input.personId,
    createdBy: input.createdBy,
    memo: `پورسانت ${KIND_FA[input.kind]}`,
    legs,
  });
}

/** The same sync for one person, working the lifetime accrual out from their own commission ledger. */
export async function syncOnePerson(
  db: Db,
  input: { organizationId: number; kind: CommissionKind; personId: number; asOf: string; createdBy: number }
): Promise<number | null> {
  const accruedToman =
    input.kind === "sales"
      ? (await statementFor(db, input.personId, EVERYTHING)).accrued_toman
      : input.kind === "driver"
        ? (await driverStatementFor(db, input.personId, EVERYTHING)).accrued_toman
        : (await managerStatementFor(db, input.personId, EVERYTHING)).accrued_toman;
  return await syncPersonAccrual(db, { ...input, accruedToman });
}

/** Bring the books up to every person's lifetime accrual in one company. Returns the journals posted. */
export async function syncCommissionAccrual(
  db: Db,
  input: { organizationId: number; asOf: string; createdBy: number }
): Promise<number> {
  const opts = { organizationId: input.organizationId };
  const todo: { kind: CommissionKind; personId: number; accruedToman: number }[] = [
    ...(await allStatements(db, EVERYTHING, opts)).map((s) => ({ kind: "sales" as const, personId: s.salesperson_user_id, accruedToman: s.accrued_toman })),
    ...(await allDriverStatements(db, EVERYTHING, opts)).map((s) => ({ kind: "driver" as const, personId: s.driver_user_id, accruedToman: s.accrued_toman })),
    ...(await allManagerStatements(db, EVERYTHING, input.organizationId)).map((s) => ({ kind: "manager" as const, personId: s.manager_user_id, accruedToman: s.accrued_toman })),
  ];
  const posted = await mapSeq(todo, (t) => syncPersonAccrual(db, { ...t, ...input }));
  return posted.filter((id) => id !== null).length;
}

/** Money paid to a person: Dr 2103 / Cr cash (reversed for a claw-back). */
export async function postCommissionPayment(
  db: Db,
  input: {
    organizationId: number;
    kind: CommissionKind;
    personId: number;
    amountToman: number;
    paidOn: string;
    createdBy: number;
    paymentId?: number | null;
    method?: string;
  }
): Promise<number> {
  const partyId = await ensureStaffParty(db, input.organizationId, input.personId);
  const groupId = await groupOf(db, input.personId);
  const out = input.amountToman > 0;
  const amount = Math.abs(input.amountToman);
  return await postJournal(db, {
    organizationId: input.organizationId,
    postedAt: input.paidOn,
    sourceType: "COMMISSION_PAYMENT",
    sourceId: input.paymentId ?? null,
    createdBy: input.createdBy,
    memo: `پرداخت پورسانت ${KIND_FA[input.kind]}`,
    legs: [
      { accountId: await account(PAYABLE_CODE), side: out ? "D" : "C", amountToman: amount, partyId, groupId },
      { accountId: await cashAccountFor(input.method ?? "CASH"), side: out ? "C" : "D", amountToman: amount },
    ],
  });
}
