import { getDb } from "@/lib/db";
import { jalaliMonthLength, jalaliToIsoDate, todayJalali } from "@/lib/jalali";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { mayClose, reopenProblem } from "@/lib/periodClose";

export interface CloseChecklist {
  /** Orders of that month still waiting (draft, review, credit hold). */
  waitingOrders: number;
  /** Orders of that month on a van that has not answered (out for delivery). */
  onTheRoad: number;
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
  return { waitingOrders: Number(row.waiting), onTheRoad: Number(row.road) };
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
