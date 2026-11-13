import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { canDecideClaim, claimProblem, type ClaimStatus } from "@/lib/expenseClaims";
import { postJournal, accountIdByCode, LedgerError } from "./ledger";
import { cashAccountFor, expenseCategories } from "./ledgerPostings";
import { thresholdsFor } from "./thresholds";

export class ClaimError extends Error {}

export interface ClaimRow {
  id: number;
  user_id: number;
  user_name: string;
  group_id: number | null;
  account_id: number;
  account_name: string;
  amount_toman: number;
  note: string | null;
  incurred_at: string;
  status: ClaimStatus;
  reject_reason: string | null;
  created_at: string;
}

const SELECT = `SELECT c.id, c.user_id, u.display_name AS user_name, c.group_id, c.account_id, a.name_fa AS account_name, c.amount_toman, c.note,
                       c.incurred_at, c.status, c.reject_reason, c.created_at
                  FROM expense_claims c JOIN users u ON u.id = c.user_id JOIN accounts a ON a.id = c.account_id`;
const plain = (r: ClaimRow): ClaimRow => ({ ...r, id: Number(r.id), user_id: Number(r.user_id), group_id: r.group_id === null ? null : Number(r.group_id), account_id: Number(r.account_id), amount_toman: Number(r.amount_toman) });

export async function submitClaim(
  who: { organizationId: number; userId: number; groupId: number | null },
  input: { account_id: number; amount_toman: number; incurred_at?: string | null; note?: string | null },
): Promise<number> {
  const today = tehranTodayIso();
  const incurred = input.incurred_at || today;
  const note = input.note?.trim() || null;
  const problem = claimProblem({ amountToman: input.amount_toman, incurredAt: incurred, today, note });
  if (problem) throw new ClaimError(problem);
  if (!(await expenseCategories()).some((c) => c.id === input.account_id)) throw new ClaimError("این حساب، حساب هزینه نیست");
  return Number(
    (await getDb()
      .prepare("INSERT INTO expense_claims (organization_id, user_id, group_id, account_id, amount_toman, note, incurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(who.organizationId, who.userId, who.groupId, input.account_id, input.amount_toman, note, incurred, new Date().toISOString())).lastInsertRowid,
  );
}

export async function myClaims(organizationId: number, userId: number): Promise<ClaimRow[]> {
  return ((await getDb().prepare(`${SELECT} WHERE c.organization_id = ? AND c.user_id = ? ORDER BY c.id DESC LIMIT 50`).all(organizationId, userId)) as unknown as ClaimRow[]).map(plain);
}

/** The claims this person may decide today (oldest first), by the same rule `decideClaim` applies. */
export async function claimsToDecide(who: { role: string; organizationId: number; userId: number; groupId: number | null }): Promise<ClaimRow[]> {
  const limit = (await thresholdsFor(who.organizationId)).expense_claim_limit_toman;
  const rows = ((await getDb().prepare(`${SELECT} WHERE c.organization_id = ? AND c.status = 'pending' ORDER BY c.id`).all(who.organizationId)) as unknown as ClaimRow[]).map(plain);
  return rows.filter((r) => canDecideClaim(who, { userId: r.user_id, groupId: r.group_id, amountToman: r.amount_toman }, limit));
}

export async function decideClaim(
  who: { role: string; organizationId: number; userId: number; groupId: number | null },
  id: number,
  verdict: "approve" | "reject",
  reason?: string | null,
): Promise<ClaimStatus> {
  const db = getDb();
  const c = (await db.prepare("SELECT user_id, group_id, account_id, amount_toman, incurred_at, status, note FROM expense_claims WHERE id = ? AND organization_id = ?").get(id, who.organizationId)) as
    | { user_id: number; group_id: number | null; account_id: number; amount_toman: number; incurred_at: string; status: ClaimStatus; note: string | null }
    | undefined;
  if (!c) throw new ClaimError("درخواست پیدا نشد");
  if (c.status !== "pending") throw new ClaimError("این درخواست قبلاً تعیین‌تکلیف شده است");
  const limit = (await thresholdsFor(who.organizationId)).expense_claim_limit_toman;
  const claim = { userId: Number(c.user_id), groupId: c.group_id === null ? null : Number(c.group_id), amountToman: Number(c.amount_toman) };
  if (!canDecideClaim(who, claim, limit)) throw new ClaimError("این درخواست را شما نمی‌توانید تعیین‌تکلیف کنید");
  const now = new Date().toISOString();
  if (verdict === "reject") {
    const why = reason?.trim().slice(0, 200);
    if (!why) throw new ClaimError("دلیل رد را بنویسید");
    await db.prepare("UPDATE expense_claims SET status = 'rejected', decided_by = ?, decided_at = ?, reject_reason = ? WHERE id = ?").run(who.userId, now, why, id);
    return "rejected";
  }
  try {
    return await db.tx(async () => {
      const owed = await accountIdByCode("2107");
      if (!owed) throw new LedgerError("حساب ۲۱۰۷ یافت نشد");
      const journalId = await postJournal(db, {
        organizationId: who.organizationId,
        postedAt: c.incurred_at,
        sourceType: "EXPENSE",
        createdBy: who.userId,
        memo: `هزینهٔ پرداخت‌شده از جیب کارمند${c.note ? ` · ${c.note}` : ""}`,
        legs: [
          { accountId: Number(c.account_id), side: "D", amountToman: claim.amountToman, groupId: claim.groupId },
          { accountId: owed, side: "C", amountToman: claim.amountToman },
        ],
      });
      await db.prepare("UPDATE expense_claims SET status = 'approved', decided_by = ?, decided_at = ?, expense_journal_id = ? WHERE id = ?").run(who.userId, now, journalId, id);
      return "approved" as const;
    });
  } catch (e) {
    if (e instanceof LedgerError) throw new ClaimError(e.message);
    throw e;
  }
}

export interface OwedRow { user_id: number; user_name: string; owed_toman: number; claims: number }

/** What the business owes each person: their approved, unpaid claims. */
export async function owedToStaff(organizationId: number): Promise<OwedRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT c.user_id, u.display_name AS user_name, SUM(c.amount_toman) AS owed_toman, COUNT(*) AS claims
         FROM expense_claims c JOIN users u ON u.id = c.user_id
        WHERE c.organization_id = ? AND c.status = 'approved' GROUP BY c.user_id, u.display_name ORDER BY u.display_name`,
    )
    .all(organizationId)) as unknown as OwedRow[];
  return rows.map((r) => ({ user_id: Number(r.user_id), user_name: r.user_name, owed_toman: Number(r.owed_toman), claims: Number(r.claims) }));
}

/** Pays back everything approved for one person in one entry (Dr 2107 / Cr the cash box or the bank). Owner only: the caller checks. */
export async function repayStaff(organizationId: number, userId: number, method: "CASH" | "TRANSFER", paidBy: number): Promise<number> {
  const db = getDb();
  const rows = (await db.prepare("SELECT id, amount_toman FROM expense_claims WHERE organization_id = ? AND user_id = ? AND status = 'approved' ORDER BY id").all(organizationId, userId)) as unknown as { id: number; amount_toman: number }[];
  if (rows.length === 0) throw new ClaimError("چیزی برای پرداخت به این نفر نیست");
  const total = rows.reduce((n, r) => n + Number(r.amount_toman), 0);
  const today = tehranTodayIso();
  try {
    return await db.tx(async () => {
      const owed = await accountIdByCode("2107");
      if (!owed) throw new LedgerError("حساب ۲۱۰۷ یافت نشد");
      const journalId = await postJournal(db, {
        organizationId,
        postedAt: today,
        sourceType: "MANUAL",
        createdBy: paidBy,
        memo: "بازپرداخت هزینهٔ کارمند",
        legs: [
          { accountId: owed, side: "D", amountToman: total },
          { accountId: await cashAccountFor(method === "CASH" ? "CASH" : "TRANSFER"), side: "C", amountToman: total },
        ],
      });
      await db.prepare("UPDATE expense_claims SET status = 'paid', paid_by = ?, paid_at = ?, repay_journal_id = ? WHERE organization_id = ? AND user_id = ? AND status = 'approved'").run(paidBy, new Date().toISOString(), journalId, organizationId, userId);
      return total;
    });
  } catch (e) {
    if (e instanceof LedgerError) throw new ClaimError(e.message);
    throw e;
  }
}
