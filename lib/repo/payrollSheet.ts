import { getDb } from "@/lib/db";
import { orgScopeId, type Session } from "@/lib/session";
import { commissionStatementsFor } from "@/lib/repo/commissionView";
import { jalaliMonthLength, jalaliToIsoDate } from "@/lib/jalali";

/** F90 first slice: one row per person for one Jalali month, assembled from the three commission statements (never recalculated)
 *  plus the staff costs approved in that month. No base salary and no attendance: neither exists in the app. */
export interface PayrollRow {
  user_id: number;
  name: string;
  kinds: string[];
  accrued_toman: number;
  deduction_toman: number;
  net_toman: number;
  paid_toman: number;
  owed_toman: number;
  claims_approved_toman: number;
  claims_unpaid_toman: number;
}

export const monthPeriod = (jy: number, jm: number) => ({ from: jalaliToIsoDate(jy, jm, 1), to: jalaliToIsoDate(jy, jm, jalaliMonthLength(jy, jm)) });

export async function payrollSheet(session: Session, jy: number, jm: number): Promise<PayrollRow[]> {
  const period = monthPeriod(jy, jm);
  const s = await commissionStatementsFor(session, period);
  const by = new Map<number, PayrollRow>();
  const row = (id: number, name: string, kind: string): PayrollRow => {
    let r = by.get(id);
    if (!r) by.set(id, (r = { user_id: id, name, kinds: [], accrued_toman: 0, deduction_toman: 0, net_toman: 0, paid_toman: 0, owed_toman: 0, claims_approved_toman: 0, claims_unpaid_toman: 0 }));
    if (!r.kinds.includes(kind)) r.kinds.push(kind);
    return r;
  };
  const add = (r: PayrollRow, x: { accrued_toman: number; deduction_toman: number; net_toman: number; paid_toman: number; owed_toman: number }) => {
    r.accrued_toman += Number(x.accrued_toman); r.deduction_toman += Number(x.deduction_toman); r.net_toman += Number(x.net_toman);
    r.paid_toman += Number(x.paid_toman); r.owed_toman += Number(x.owed_toman);
  };
  for (const x of s.statements) add(row(x.salesperson_user_id, x.display_name, "فروشنده"), x);
  for (const x of s.driverStatements) add(row(x.driver_user_id, x.display_name, "راننده"), x);
  for (const x of s.managerStatements) add(row(x.manager_user_id, x.display_name, "مدیر گروه"), x);

  // Staff costs approved (or already repaid) with a decision date in this month, and what is still unpaid today.
  const org = orgScopeId(session);
  const claims = (await getDb()
    .prepare(
      `SELECT c.user_id, u.display_name, c.amount_toman, c.status FROM expense_claims c JOIN users u ON u.id = c.user_id
        WHERE (?::bigint IS NULL OR c.organization_id = ?) AND c.status IN ('approved', 'paid') AND substr(c.decided_at, 1, 10) BETWEEN ? AND ?`,
    )
    .all(org, org, period.from, period.to)) as unknown as { user_id: number; display_name: string; amount_toman: number; status: string }[];
  for (const c of claims) {
    const r = row(Number(c.user_id), c.display_name, "هزینه");
    r.claims_approved_toman += Number(c.amount_toman);
    if (c.status === "approved") r.claims_unpaid_toman += Number(c.amount_toman);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "fa"));
}

const PAYROLL_HEAD = ["نام", "نقش", "پورسانت ماه", "کسر تخفیف", "خالص پورسانت", "پرداخت‌شده", "مانده پورسانت", "هزینهٔ تأییدشده", "هزینهٔ هنوز پرداخت‌نشده"];
export const payrollCsvRows = (rows: PayrollRow[]): (string | number)[][] => [
  PAYROLL_HEAD,
  ...rows.map((r) => [r.name, r.kinds.join("، "), r.accrued_toman, r.deduction_toman, r.net_toman, r.paid_toman, r.owed_toman, r.claims_approved_toman, r.claims_unpaid_toman]),
];
