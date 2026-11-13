import { getDb } from "@/lib/db";
import { jalaliMonthLength, jalaliToIsoDate, todayJalali } from "@/lib/jalali";
import { accountIdByCode } from "./ledger";
import { LedgerError, postJournal } from "./ledgerCore";
import { reopenProblem } from "@/lib/periodClose";
import { closingLegs, NOT_YEAR_CLOSE, yearCloseProblem, type YearAccount } from "@/lib/yearClose";

export interface YearCloseRow { year: number; closed: boolean }

/** The years that have entries, with whether each one is closed. */
export async function yearList(organizationId: number): Promise<YearCloseRow[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT DISTINCT substr(period_key, 1, 4) AS y FROM journals WHERE organization_id = ? ORDER BY y DESC`
    )
    .all(organizationId)) as { y: string }[];
  const closed = (await getDb().prepare("SELECT jalali_year FROM year_closes WHERE organization_id = ? AND reopened_at IS NULL").all(organizationId)) as { jalali_year: number }[];
  const set = new Set(closed.map((c) => Number(c.jalali_year)));
  return rows.map((r) => ({ year: Number(r.y), closed: set.has(Number(r.y)) }));
}

/** H2: post one entry that clears the year's revenue and expenses into 3103, dated the last day of the year, then
 *  close the twelve months. The last month must still be open (the entry lands in it). */
export async function closeYear(organizationId: number, year: number, by: number): Promise<number> {
  const problem = yearCloseProblem(year, todayJalali().jy);
  if (problem) throw new LedgerError(problem);
  const db = getDb();
  return await db.tx(async () => {
    if (await db.prepare("SELECT 1 AS ok FROM year_closes WHERE organization_id = ? AND jalali_year = ? AND reopened_at IS NULL").get(organizationId, year)) {
      throw new LedgerError("این سال قبلاً بسته شده است");
    }
    const retained = await accountIdByCode("3103");
    if (!retained) throw new LedgerError("حساب ۳۱۰۳ یافت نشد");
    const rows = (await db
      .prepare(
        `SELECT a.id AS "accountId", a.type,
                SUM(CASE WHEN e.side = 'C' THEN e.amount_toman ELSE -e.amount_toman END) AS net
           FROM ledger_entries e
           JOIN journals j ON j.id = e.journal_id
           JOIN accounts a ON a.id = e.account_id
          WHERE e.organization_id = ? AND a.type IN ('REVENUE','EXPENSE') AND j.period_key LIKE ? AND ${NOT_YEAR_CLOSE}
          GROUP BY a.id, a.type`
      )
      .all(organizationId, `${year}-%`)) as { accountId: number; type: "REVENUE" | "EXPENSE"; net: number }[];
    const accounts: YearAccount[] = rows.map((r) => ({ accountId: Number(r.accountId), type: r.type, net: Number(r.net) }));
    const legs = closingLegs(accounts, retained);
    if (legs.length === 0) throw new LedgerError("در این سال سودی یا هزینه‌ای ثبت نشده است");
    const lastDay = jalaliToIsoDate(year, 12, jalaliMonthLength(year, 12));
    const journalId = await postJournal(db, {
      organizationId, postedAt: `${lastDay}T23:59:00.000Z`, sourceType: "YEAR_CLOSE", createdBy: by,
      memo: `بستن سال ${year}`, legs,
    });
    const now = new Date().toISOString();
    for (let m = 1; m <= 12; m++) {
      await db
        .prepare(
          `INSERT INTO fiscal_periods (organization_id, period_key, status, closed_at, closed_by, created_at) VALUES (?, ?, 'closed', ?, ?, ?)
           ON CONFLICT (organization_id, period_key) DO UPDATE SET status = 'closed', closed_at = EXCLUDED.closed_at, closed_by = EXCLUDED.closed_by`
        )
        .run(organizationId, `${year}-${String(m).padStart(2, "0")}`, now, by, now);
    }
    await db.prepare("INSERT INTO year_closes (organization_id, jalali_year, journal_id, closed_by, closed_at) VALUES (?, ?, ?, ?, ?)").run(organizationId, year, journalId, by, now);
    return journalId;
  });
}

/** H2: undo a year close with a reason: the last month opens, a mirror entry cancels the closing entry. The other
 *  eleven months stay closed. */
export async function reopenYear(organizationId: number, year: number, by: number, reason: string): Promise<void> {
  const problem = reopenProblem(reason);
  if (problem) throw new LedgerError(problem);
  const db = getDb();
  await db.tx(async () => {
    const yc = (await db.prepare("SELECT id, journal_id FROM year_closes WHERE organization_id = ? AND jalali_year = ? AND reopened_at IS NULL").get(organizationId, year)) as { id: number; journal_id: number } | undefined;
    if (!yc) throw new LedgerError("این سال بسته نیست");
    const legs = (await db.prepare("SELECT account_id, side, amount_toman FROM ledger_entries WHERE journal_id = ?").all(yc.journal_id)) as { account_id: number; side: "D" | "C"; amount_toman: number }[];
    const last = `${year}-12`;
    await db.prepare("UPDATE fiscal_periods SET status = 'open', reopen_reason = ?, reopened_at = ?, reopened_by = ? WHERE organization_id = ? AND period_key = ?").run(`بازکردن سال: ${reason.trim()}`, new Date().toISOString(), by, organizationId, last);
    const lastDay = jalaliToIsoDate(year, 12, jalaliMonthLength(year, 12));
    await postJournal(db, {
      organizationId, postedAt: `${lastDay}T23:59:30.000Z`, sourceType: "REVERSAL", sourceId: yc.journal_id, reversesJournalId: yc.journal_id, createdBy: by,
      memo: `بازکردن سال ${year}: ${reason.trim()}`,
      legs: legs.map((l) => ({ accountId: Number(l.account_id), side: l.side === "D" ? "C" : "D", amountToman: Number(l.amount_toman) })),
    });
    await db.prepare("UPDATE year_closes SET reopened_at = ?, reopened_by = ?, reopen_reason = ? WHERE id = ?").run(new Date().toISOString(), by, reason.trim(), yc.id);
  });
}
