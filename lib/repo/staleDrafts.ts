/** FB40: draft orders nobody finished. A draft untouched for STALE_DRAFT_DAYS shows on the action
 *  centre; one untouched for AUTO_CANCEL_DAYS is cancelled by the rule sweep, with a line on its
 *  timeline. Drafts hold no stock and no credit, so cancelling one loses nothing but clutter, and
 *  a cancelled order can be reopened for 7 days (D31).
 *  shortcut: both numbers are fixed (owner default 7, cancel a week after the card); they become
 *  owner settings with the D30 thresholds card. */
import { getDb } from "@/lib/db";
import { orderFilter, type Session } from "@/lib/session";
import { advanceOrder } from "@/lib/repo/orders";

const STALE_DRAFT_DAYS = 7;
export const AUTO_CANCEL_DAYS = 14;
const DAY_MS = 86_400_000;

interface StaleDraft {
  id: number;
  order_no: string;
  customer_name: string;
  age_days: number;
}

/** Drafts in the person's scope untouched for STALE_DRAFT_DAYS or more, oldest first. */
export async function staleDraftsFor(session: Session, nowMs = Date.now()): Promise<StaleDraft[]> {
  const scope = orderFilter(session, "o");
  const cutoff = new Date(nowMs - STALE_DRAFT_DAYS * DAY_MS).toISOString();
  const rows = await getDb()
    .prepare(
      `SELECT o.id, o.order_no, c.business_name AS customer_name, o.updated_at
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.organization_id = ? AND o.status = 'DRAFT' AND o.updated_at < ?${scope.sql}
        ORDER BY o.updated_at LIMIT 50`
    )
    .all(session.organizationId, cutoff, ...scope.params) as { id: number; order_no: string; customer_name: string; updated_at: string }[];
  return rows.map((r) => ({
    id: Number(r.id),
    order_no: r.order_no,
    customer_name: r.customer_name,
    age_days: Math.floor((nowMs - Date.parse(r.updated_at)) / DAY_MS),
  }));
}

/** The sweep's half: cancel every draft untouched for AUTO_CANCEL_DAYS. Returns how many. */
export async function cancelStaleDrafts(organizationId: number, nowMs = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - AUTO_CANCEL_DAYS * DAY_MS).toISOString();
  const ids = (await getDb()
    .prepare("SELECT id FROM orders WHERE organization_id = ? AND status = 'DRAFT' AND updated_at < ? ORDER BY id LIMIT 200")
    .all(organizationId, cutoff) as { id: number }[]).map((r) => Number(r.id));
  for (const id of ids) {
    await advanceOrder(organizationId, id, "cancel", { id: null, role: "system" }, {
      note: `لغو خودکار: پیش‌نویس ${AUTO_CANCEL_DAYS.toLocaleString("fa-IR")} روز بدون تغییر`,
    });
  }
  return ids.length;
}
