import type { Db } from "@/lib/database/client";
import type { DeliveryStatus } from "./deliveries";

/** One attempt at delivering one order — the row the order's own page shows.
 *
 *  `deliveries` is keyed by order_id + seq, so it is the history of attempts on a single
 *  order rather than a queue. It used to be listed on a cross-order page, where it
 *  answered "what happened recently"; the order's own page had no trace of it, which is a
 *  gap rather than a design.
 *
 *  `listDeliveries` reads the same table and would work, but it takes the WHOLE
 *  organisation and filters afterwards, and it selects `d.*` — photo and signature paths
 *  for rows this table does not show. This read states the columns the history actually
 *  renders, and joins the two reason codes so a failed attempt says WHY without a second
 *  query per row.
 *
 *  Oldest first, and that is the reading order: a manager asking "what happened to this
 *  order" wants the sequence, not the latest entry. `seq` is the natural order and matches
 *  created_at without needing it. */
export interface OrderDeliveryAttempt {
  id: number;
  seq: number;
  status: DeliveryStatus;
  planned_arrival: string | null;
  actual_arrival: string | null;
  completed_at: string | null;
  /** Why it failed, in words. Null when the attempt succeeded or none was given. */
  fail_reason: string | null;
  /** Why it was late, in words. Independent of `fail_reason`. */
  delay_reason: string | null;
  receiver_name: string | null;
  /** Whether there is a photo, without carrying its path to a table that does not show
   *  it. `number`, not `boolean`: SQLite hands back 0/1 here. */
  has_photo: number;
}

export async function readOrderDeliveryHistory(
  conn: Db,
  organizationId: number,
  orderId: number,
): Promise<OrderDeliveryAttempt[]> {
  return await conn
    .prepare(
      `SELECT d.id, d.seq, d.status, d.planned_arrival, d.actual_arrival, d.completed_at,
              fr.label_fa AS fail_reason, dr.label_fa AS delay_reason,
              d.receiver_name,
              (d.photo_path IS NOT NULL AND d.photo_path != '') AS has_photo
         FROM deliveries d
         LEFT JOIN reason_codes fr ON fr.id = d.fail_reason_id
         LEFT JOIN reason_codes dr ON dr.id = d.delay_reason_id
        WHERE d.organization_id = ? AND d.order_id = ?
        ORDER BY d.seq`,
    )
    .all(organizationId, orderId) as unknown as OrderDeliveryAttempt[];
}
