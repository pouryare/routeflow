import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { advanceProblem, loanBalance, type LoanKind } from "@/lib/staffLoans";
import { accountIdByCode, postJournal, LedgerError } from "./ledger";
import { cashAccountFor } from "./ledgerPostings";
import { thresholdsFor } from "./thresholds";

export class LoanError extends Error {}

export type PayMethod = "CASH" | "TRANSFER";
type Db = ReturnType<typeof getDb>;

export interface LoanEntry { id: number; kind: LoanKind; amountToman: number; note: string | null; monthlyHint: number | null; createdAt: string; createdByName: string }
export interface LoanPerson { userId: number; name: string; balanceToman: number; lastMoveAt: string; monthlyHint: number | null; reminderDue: boolean }

export async function loanEntries(organizationId: number, userId: number): Promise<LoanEntry[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT e.id, e.kind, e.amount_toman, e.note, e.monthly_hint_toman, e.created_at, u.display_name AS by_name
         FROM staff_loan_entries e JOIN users u ON u.id = e.created_by
        WHERE e.organization_id = ? AND e.user_id = ? ORDER BY e.id DESC LIMIT 100`,
    )
    .all(organizationId, userId)) as unknown as { id: number; kind: LoanKind; amount_toman: number; note: string | null; monthly_hint_toman: number | null; created_at: string; by_name: string }[];
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, amountToman: Number(r.amount_toman), note: r.note, monthlyHint: r.monthly_hint_toman === null ? null : Number(r.monthly_hint_toman), createdAt: r.created_at, createdByName: r.by_name }));
}

async function balanceIn(db: Db, organizationId: number, userId: number): Promise<number> {
  const rows = (await db.prepare("SELECT kind, amount_toman FROM staff_loan_entries WHERE organization_id = ? AND user_id = ?").all(organizationId, userId)) as unknown as { kind: LoanKind; amount_toman: number }[];
  return loanBalance(rows.map((r) => ({ kind: r.kind, amountToman: Number(r.amount_toman) })));
}
export const loanBalanceOf = (organizationId: number, userId: number) => balanceIn(getDb(), organizationId, userId);

/** Everyone who ever had a loan, with the running balance, the last time money moved and the owner's monthly hint. Owed first. */
export async function loanPeople(organizationId: number): Promise<LoanPerson[]> {
  const db = getDb();
  const days = (await thresholdsFor(organizationId)).loan_reminder_days;
  const rows = (await db
    .prepare(
      `SELECT e.user_id, u.display_name AS name,
              SUM(CASE WHEN e.kind = 'advance' THEN e.amount_toman ELSE -e.amount_toman END) AS balance,
              MAX(CASE WHEN e.kind <> 'advance' THEN e.created_at END) AS last_back,
              MAX(CASE WHEN e.kind = 'advance' THEN e.created_at END) AS last_advance
         FROM staff_loan_entries e JOIN users u ON u.id = e.user_id
        WHERE e.organization_id = ? GROUP BY e.user_id, u.display_name`,
    )
    .all(organizationId)) as unknown as { user_id: number; name: string; balance: number; last_back: string | null; last_advance: string }[];
  const hints = (await db
    .prepare("SELECT DISTINCT ON (user_id) user_id, monthly_hint_toman FROM staff_loan_entries WHERE organization_id = ? AND kind = 'advance' AND monthly_hint_toman IS NOT NULL ORDER BY user_id, id DESC")
    .all(organizationId)) as unknown as { user_id: number; monthly_hint_toman: number | null }[];
  const hint = new Map(hints.map((h) => [Number(h.user_id), h.monthly_hint_toman === null ? null : Number(h.monthly_hint_toman)]));
  const now = Date.now();
  return rows
    .map((r) => {
      const lastMoveAt = [r.last_back, r.last_advance].filter(Boolean).sort().at(-1) as string;
      const balanceToman = Number(r.balance);
      return { userId: Number(r.user_id), name: r.name, balanceToman, lastMoveAt, monthlyHint: hint.get(Number(r.user_id)) ?? null, reminderDue: balanceToman > 0 && Date.parse(lastMoveAt) + days * 86_400_000 <= now };
    })
    .sort((a, b) => b.balanceToman - a.balanceToman);
}

async function userInOrg(db: Db, organizationId: number, userId: number): Promise<{ group_id: number | null; display_name: string }> {
  const u = (await db.prepare("SELECT group_id, display_name FROM users WHERE id = ? AND organization_id = ?").get(userId, organizationId)) as { group_id: number | null; display_name: string } | undefined;
  if (!u) throw new LoanError("کاربر پیدا نشد");
  return u;
}

function hintOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v <= 0) throw new LoanError("مبلغ پیشنهادی ماهانه نامعتبر است");
  return v;
}

/** Pays an advance out of the cash box or the bank (Dr 1105 / Cr cash or bank). Owner only: the caller checks. */
async function payAdvance(db: Db, organizationId: number, p: { userId: number; amountToman: number; method: PayMethod; note: string | null; monthlyHint: number | null; by: number }): Promise<number> {
  const limit = (await thresholdsFor(organizationId)).staff_loan_limit_toman;
  const problem = advanceProblem({ amountToman: p.amountToman, balanceToman: await balanceIn(db, organizationId, p.userId), limitToman: limit });
  if (problem) throw new LoanError(problem);
  const acct = await accountIdByCode("1105");
  if (!acct) throw new LedgerError("حساب ۱۱۰۵ یافت نشد");
  const journalId = await postJournal(db, {
    organizationId, postedAt: tehranTodayIso(), sourceType: "MANUAL", createdBy: p.by, memo: `مساعده به کارمند${p.note ? ` · ${p.note}` : ""}`,
    legs: [{ accountId: acct, side: "D", amountToman: p.amountToman }, { accountId: await cashAccountFor(p.method === "CASH" ? "CASH" : "TRANSFER"), side: "C", amountToman: p.amountToman }],
  });
  return Number((await db.prepare("INSERT INTO staff_loan_entries (organization_id, user_id, kind, amount_toman, monthly_hint_toman, note, journal_id, created_by, created_at) VALUES (?, ?, 'advance', ?, ?, ?, ?, ?, ?)").run(organizationId, p.userId, p.amountToman, p.monthlyHint, p.note, journalId, p.by, new Date().toISOString())).lastInsertRowid);
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { if (e instanceof LedgerError) throw new LoanError(e.message); throw e; }
}

/** The owner gives an advance or loan straight away. */
export function giveAdvance(organizationId: number, ownerId: number, i: { userId: number; amountToman: number; method: PayMethod; note?: string | null; monthlyHint?: number | null }): Promise<number> {
  const db = getDb();
  return wrap(() => db.tx(async () => {
    await userInOrg(db, organizationId, i.userId);
    return payAdvance(db, organizationId, { userId: i.userId, amountToman: i.amountToman, method: i.method, note: i.note?.trim().slice(0, 200) || null, monthlyHint: hintOrNull(i.monthlyHint), by: ownerId });
  }));
}

/** A group manager asks for an advance for someone in their group (not themselves); the owner decides. */
export async function requestAdvance(who: { organizationId: number; userId: number; groupId: number | null }, i: { userId: number; amountToman: number; note?: string | null; monthlyHint?: number | null }): Promise<number> {
  const db = getDb();
  const target = await userInOrg(db, who.organizationId, i.userId);
  if (i.userId === who.userId) throw new LoanError("برای خودتان نمی‌توانید مساعده بخواهید");
  if (who.groupId === null || target.group_id !== who.groupId) throw new LoanError("فقط برای کارکنان گروه خودتان می‌توانید مساعده بخواهید");
  const limit = (await thresholdsFor(who.organizationId)).staff_loan_limit_toman;
  const problem = advanceProblem({ amountToman: i.amountToman, balanceToman: await balanceIn(db, who.organizationId, i.userId), limitToman: limit });
  if (problem) throw new LoanError(problem);
  return Number((await db.prepare("INSERT INTO staff_advance_requests (organization_id, user_id, group_id, amount_toman, monthly_hint_toman, note, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(who.organizationId, i.userId, target.group_id, i.amountToman, hintOrNull(i.monthlyHint), i.note?.trim().slice(0, 200) || null, who.userId, new Date().toISOString())).lastInsertRowid);
}

export interface AdvanceRequest { id: number; userId: number; userName: string; amountToman: number; note: string | null; monthlyHint: number | null; requestedByName: string; createdAt: string }
export async function pendingAdvanceRequests(organizationId: number): Promise<AdvanceRequest[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.id, r.user_id, u.display_name AS user_name, r.amount_toman, r.note, r.monthly_hint_toman, q.display_name AS by_name, r.created_at
         FROM staff_advance_requests r JOIN users u ON u.id = r.user_id JOIN users q ON q.id = r.requested_by
        WHERE r.organization_id = ? AND r.status = 'pending' ORDER BY r.id`,
    )
    .all(organizationId)) as unknown as { id: number; user_id: number; user_name: string; amount_toman: number; note: string | null; monthly_hint_toman: number | null; by_name: string; created_at: string }[];
  return rows.map((r) => ({ id: Number(r.id), userId: Number(r.user_id), userName: r.user_name, amountToman: Number(r.amount_toman), note: r.note, monthlyHint: r.monthly_hint_toman === null ? null : Number(r.monthly_hint_toman), requestedByName: r.by_name, createdAt: r.created_at }));
}

/** The owner approves (and pays it from the cash box or the bank) or rejects with a reason. */
export function decideAdvanceRequest(organizationId: number, ownerId: number, id: number, d: { verdict: "approve"; method: PayMethod } | { verdict: "reject"; reason: string }): Promise<void> {
  const db = getDb();
  return wrap(() => db.tx(async () => {
    const r = (await db.prepare("SELECT user_id, amount_toman, monthly_hint_toman, note, status FROM staff_advance_requests WHERE id = ? AND organization_id = ?").get(id, organizationId)) as { user_id: number; amount_toman: number; monthly_hint_toman: number | null; note: string | null; status: string } | undefined;
    if (!r) throw new LoanError("درخواست پیدا نشد");
    if (r.status !== "pending") throw new LoanError("این درخواست قبلاً تعیین‌تکلیف شده است");
    const now = new Date().toISOString();
    if (d.verdict === "reject") {
      const why = d.reason.trim().slice(0, 200);
      if (!why) throw new LoanError("دلیل رد را بنویسید");
      await db.prepare("UPDATE staff_advance_requests SET status = 'rejected', decided_by = ?, decided_at = ?, reject_reason = ? WHERE id = ?").run(ownerId, now, why, id);
      return;
    }
    const entry = await payAdvance(db, organizationId, { userId: Number(r.user_id), amountToman: Number(r.amount_toman), method: d.method, note: r.note, monthlyHint: r.monthly_hint_toman === null ? null : Number(r.monthly_hint_toman), by: ownerId });
    await db.prepare("UPDATE staff_advance_requests SET status = 'approved', decided_by = ?, decided_at = ?, entry_id = ? WHERE id = ?").run(ownerId, now, entry, id);
  }));
}

/** The person brings money back (Dr cash or bank / Cr 1105). */
export function recordLoanRepayment(organizationId: number, ownerId: number, i: { userId: number; amountToman: number; method: PayMethod; note?: string | null }): Promise<void> {
  const db = getDb();
  return wrap(() => db.tx(async () => {
    const balance = await balanceIn(db, organizationId, i.userId);
    if (!Number.isInteger(i.amountToman) || i.amountToman <= 0) throw new LoanError("مبلغ را به تومان و بدون اعشار وارد کنید");
    if (i.amountToman > balance) throw new LoanError("مبلغ از مانده وام بیشتر است");
    const acct = await accountIdByCode("1105");
    if (!acct) throw new LedgerError("حساب ۱۱۰۵ یافت نشد");
    const journalId = await postJournal(db, {
      organizationId, postedAt: tehranTodayIso(), sourceType: "MANUAL", createdBy: ownerId, memo: "بازپرداخت مساعده توسط کارمند",
      legs: [{ accountId: await cashAccountFor(i.method === "CASH" ? "CASH" : "TRANSFER"), side: "D", amountToman: i.amountToman }, { accountId: acct, side: "C", amountToman: i.amountToman }],
    });
    await db.prepare("INSERT INTO staff_loan_entries (organization_id, user_id, kind, amount_toman, note, journal_id, created_by, created_at) VALUES (?, ?, 'repayment', ?, ?, ?, ?, ?)").run(organizationId, i.userId, i.amountToman, i.note?.trim().slice(0, 200) || null, journalId, ownerId, new Date().toISOString());
  }));
}

/** The owner forgives part or all of a loan with a reason; it is booked as an expense (5110). */
export function writeOffLoan(organizationId: number, ownerId: number, i: { userId: number; amountToman: number; reason: string }): Promise<void> {
  const db = getDb();
  return wrap(() => db.tx(async () => {
    const why = i.reason.trim().slice(0, 200);
    if (!why) throw new LoanError("دلیل بخشودگی را بنویسید");
    const balance = await balanceIn(db, organizationId, i.userId);
    if (!Number.isInteger(i.amountToman) || i.amountToman <= 0 || i.amountToman > balance) throw new LoanError("مبلغ بخشودگی باید بین یک تومان و مانده وام باشد");
    const loan = await accountIdByCode("1105");
    const expense = await accountIdByCode("5110");
    if (!loan || !expense) throw new LedgerError("حساب پیدا نشد");
    const journalId = await postJournal(db, {
      organizationId, postedAt: tehranTodayIso(), sourceType: "MANUAL", createdBy: ownerId, memo: `بخشودگی وام کارمند: ${why}`,
      legs: [{ accountId: expense, side: "D", amountToman: i.amountToman }, { accountId: loan, side: "C", amountToman: i.amountToman }],
    });
    await db.prepare("INSERT INTO staff_loan_entries (organization_id, user_id, kind, amount_toman, note, journal_id, created_by, created_at) VALUES (?, ?, 'writeoff', ?, ?, ?, ?, ?)").run(organizationId, i.userId, i.amountToman, why, journalId, ownerId, new Date().toISOString());
  }));
}

/** Used by repayStaff: books `deduct` of what is owed to the person against their loan, inside the caller's transaction. */
export async function recordDeductionIn(db: Db, organizationId: number, userId: number, deduct: number, by: number, journalId: number): Promise<void> {
  await db.prepare("INSERT INTO staff_loan_entries (organization_id, user_id, kind, amount_toman, note, journal_id, created_by, created_at) VALUES (?, ?, 'deduction', ?, ?, ?, ?, ?)").run(organizationId, userId, deduct, "کسر هنگام بازپرداخت هزینه‌ها", journalId, by, new Date().toISOString());
}
export const balanceInTx = balanceIn;

/** Owner's «today» row: how many people have owed money for too long without paying any back. */
export async function loanRemindersCount(organizationId: number): Promise<number> {
  return (await loanPeople(organizationId)).filter((p) => p.reminderDue).length;
}

/** Who may be named in an advance form: the owner picks anyone on staff; a group manager, others in their own group. */
export async function loanPickList(who: { organizationId: number; role: string; userId: number; groupId: number | null }): Promise<{ id: string; label: string }[]> {
  const isOwnerRole = who.role === "owner" || who.role === "platform_owner";
  if (!isOwnerRole && who.groupId === null) return [];
  const rows = (await getDb()
    .prepare(
      `SELECT id, display_name FROM users WHERE organization_id = ? AND active = 1 AND role NOT IN ('shareholder', 'platform_owner', 'accountant')
          AND id <> ? ${isOwnerRole ? "" : "AND group_id = ?"} ORDER BY display_name`,
    )
    .all(...(isOwnerRole ? [who.organizationId, who.userId] : [who.organizationId, who.userId, who.groupId]))) as unknown as { id: number; display_name: string }[];
  return rows.map((r) => ({ id: String(r.id), label: r.display_name }));
}
