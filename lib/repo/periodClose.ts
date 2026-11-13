import { getDb } from "@/lib/db";
import { jalaliMonthLength, jalaliToIsoDate, todayJalali } from "@/lib/jalali";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { mayClose, reopenProblem, openRangeProblem, OPENING_HOURS } from "@/lib/periodClose";

export interface CloseChecklist {
  /** Orders of that month still waiting (draft, review, credit hold). */
  waitingOrders: number;
  /** Orders of that month on a van that has not answered (out for delivery). */
  onTheRoad: number;
  /** Z7: the month's expenses with no receipt photo or no note (not voided). */
  needsAttention: number;
}

const currentKey = () => {
  const t = todayJalali();
  return `${t.jy}-${String(t.jm).padStart(2, "0")}`;
};

/** What to look at before closing: the month's orders that are not finished. Counted by order date. */
export async function closeChecklist(organizationId: number, periodKey: string): Promise<CloseChecklist> {
  const [jy, jm] = periodKey.split("-").map(Number);
  const from = jalaliToIsoDate(jy, jm, 1);
  const to = jalaliToIsoDate(jy, jm, jalaliMonthLength(jy, jm));
  const row = (await getDb()
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE status IN ('DRAFT','PENDING_REVIEW','PENDING_CREDIT','ON_HOLD')) AS waiting,
              COUNT(*) FILTER (WHERE status = 'OUT_FOR_DELIVERY') AS road
         FROM orders WHERE organization_id = ? AND order_date >= ? AND order_date <= ?`
    )
    .get(organizationId, from, to)) as { waiting: number; road: number };
  // shortcut: the month is cut by the UTC date of posted_at, not the Tehran day; fine for a count, tighten if it ever drives a refusal.
  const att = (await getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM journals j
        WHERE j.organization_id = ? AND j.source_type = 'EXPENSE' AND substr(j.posted_at, 1, 10) >= ? AND substr(j.posted_at, 1, 10) <= ?
          AND NOT EXISTS (SELECT 1 FROM journals r WHERE r.reverses_journal_id = j.id)
          AND (btrim(COALESCE(j.memo, '')) = '' OR NOT EXISTS (SELECT 1 FROM expense_receipts x WHERE x.journal_id = j.id AND x.organization_id = j.organization_id))`
    )
    .get(organizationId, from, to)) as { n: number };
  return { waitingOrders: Number(row.waiting), onTheRoad: Number(row.road), needsAttention: Number(att.n) };
}

export async function closePeriod(organizationId: number, periodKey: string, by: number): Promise<void> {
  const problem = mayClose(periodKey, currentKey());
  if (problem) throw new LedgerError(problem);
  const now = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO fiscal_periods (organization_id, period_key, status, closed_at, closed_by, created_at) VALUES (?, ?, 'closed', ?, ?, ?)
       ON CONFLICT (organization_id, period_key) DO UPDATE SET status = 'closed', closed_at = EXCLUDED.closed_at, closed_by = EXCLUDED.closed_by`
    )
    .run(organizationId, periodKey, now, by, now);
}

export async function reopenPeriod(organizationId: number, periodKey: string, by: number, reason: string): Promise<void> {
  const problem = reopenProblem(reason);
  if (problem) throw new LedgerError(problem);
  const res = await getDb()
    .prepare("UPDATE fiscal_periods SET status = 'open', reopen_reason = ?, reopened_at = ?, reopened_by = ? WHERE organization_id = ? AND period_key = ? AND status = 'closed'")
    .run(reason.trim(), new Date().toISOString(), by, organizationId, periodKey);
  if (!res.changes) throw new LedgerError("این ماه بسته نیست");
}

/** B2: open days fromDay..toDay of a closed month for OPENING_HOURS hours. Logged by the row itself (who, when, why). */
export async function openRange(organizationId: number, periodKey: string, fromDay: number, toDay: number, by: number, reason: string): Promise<void> {
  const problem = reopenProblem(reason);
  if (problem) throw new LedgerError(problem);
  const closed = await getDb().prepare("SELECT 1 AS ok FROM fiscal_periods WHERE organization_id = ? AND period_key = ? AND status = 'closed'").get(organizationId, periodKey);
  if (!closed) throw new LedgerError("این ماه بسته نیست");
  const [jy, jm] = periodKey.split("-").map(Number);
  const rangeProblem = openRangeProblem(fromDay, toDay, jalaliMonthLength(jy, jm));
  if (rangeProblem) throw new LedgerError(rangeProblem);
  const now = new Date();
  await getDb()
    .prepare("INSERT INTO period_openings (organization_id, period_key, from_date, to_date, reason, opened_by, opened_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(organizationId, periodKey, jalaliToIsoDate(jy, jm, fromDay), jalaliToIsoDate(jy, jm, toDay), reason.trim(), by, now.toISOString(), new Date(now.getTime() + OPENING_HOURS * 3_600_000).toISOString());
}
