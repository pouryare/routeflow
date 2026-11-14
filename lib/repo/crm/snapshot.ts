import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { customerDebt } from "@/lib/repo/payments";
import { activeHold } from "@/lib/repo/customerHolds";
import { getBusiness } from "./businesses";

/** F104: the five things a rep wants in the two seconds before a call, from existing data in one place. */
export interface Snapshot {
  id: number;
  name: string;
  phone: string | null;
  debtToman: number;
  overdueToman: number;
  lastOrder: { order_no: string; order_date: string; status: string } | null;
  lastNote: { note: string; at: string } | null;
  openTasks: { id: number; title: string }[];
  holdReason: string | null;
}

export async function snapshotFor(session: Session, id: number): Promise<Snapshot | null> {
  const b = await getBusiness(session, id);
  if (!b) return null;
  const org = b.organization_id;
  const db = getDb();
  const debt = await customerDebt(org, id);
  const lastOrder = (await db
    .prepare("SELECT order_no, order_date, status FROM orders WHERE organization_id = ? AND customer_id = ? AND status <> 'CANCELLED' ORDER BY order_date DESC, id DESC LIMIT 1")
    .get(org, id)) as Snapshot["lastOrder"] | undefined;
  const lastNote = (await db
    .prepare("SELECT note, occurred_at AS at FROM activities WHERE organization_id = ? AND customer_id = ? AND note IS NOT NULL AND note <> '' ORDER BY occurred_at DESC, id DESC LIMIT 1")
    .get(org, id)) as Snapshot["lastNote"] | undefined;
  const openTasks = (await db
    .prepare("SELECT id, title FROM tasks WHERE organization_id = ? AND entity_type = 'customer' AND entity_id = ? AND status = 'open' ORDER BY due_at LIMIT 3")
    .all(org, id)) as { id: number; title: string }[];
  const hold = await activeHold(org, id);
  return {
    id,
    name: b.business_name,
    phone: b.phone_norm,
    debtToman: Number(debt.total),
    overdueToman: Number(debt.bucket_30_plus),
    lastOrder: lastOrder ?? null,
    lastNote: lastNote ?? null,
    openTasks: openTasks.map((t) => ({ id: Number(t.id), title: t.title })),
    holdReason: hold?.reason ?? null,
  };
}
