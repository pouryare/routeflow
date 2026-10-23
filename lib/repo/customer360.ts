import { getDb } from "@/lib/db";
import { MANAGE_ROLES } from "@/lib/roles";
import type { Session } from "@/lib/session";
import type { ChequeStatus } from "@/lib/chequeStates";

/** F47: the money and trouble a customer page did not show next to the balance: open cheques
 *  (in hand, at the bank, or bounced and not replaced) and open complaints (open or under
 *  investigation). The balance itself is already on the page (CustomerBento).
 *
 *  Role-gated per card: cheques are the manager's and owner's (the cheque board is theirs), so
 *  other roles get null and the card is not drawn; complaints go to anyone who can open the
 *  customer, since the person at the door is the one who hears them. The caller has checked
 *  that the session may see this customer. */

interface OpenCheque {
  id: number;
  cheque_no: string;
  amount_toman: number;
  due_date: string;
  status: ChequeStatus;
}

interface OpenComplaint {
  id: number;
  category: string;
  severity: string;
  status: string;
  reported_at: string;
  description: string | null;
}

export interface Customer360 {
  cheques: { items: OpenCheque[]; total_toman: number } | null;
  complaints: OpenComplaint[];
}

export async function customer360(session: Session, organizationId: number, customerId: number): Promise<Customer360> {
  const db = getDb();
  const items = MANAGE_ROLES.includes(session.role)
    ? (await db
        .prepare(
          `SELECT id, cheque_no, amount_toman, due_date, status FROM cheques
            WHERE customer_id = ? AND organization_id = ? AND status IN ('in_hand', 'deposited', 'bounced')
            ORDER BY CASE status WHEN 'bounced' THEN 0 ELSE 1 END, due_date, id`
        )
        .all(customerId, organizationId) as unknown as OpenCheque[])
    : null;
  const complaints = await db
    .prepare(
      `SELECT id, category, severity, status, reported_at, description FROM quality_complaints
        WHERE customer_id = ? AND organization_id = ? AND status IN ('open', 'investigating')
        ORDER BY reported_at DESC, id DESC`
    )
    .all(customerId, organizationId) as unknown as OpenComplaint[];
  return {
    cheques: items ? { items, total_toman: items.reduce((s, c) => s + c.amount_toman, 0) } : null,
    complaints,
  };
}
