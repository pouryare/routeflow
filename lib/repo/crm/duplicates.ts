import { getDb, logActivity } from "@/lib/db";
import { canSeeBusiness, type Session } from "@/lib/session";
import { chooseSurvivor, pairKey, type DupSide } from "@/lib/duplicates";

export class DuplicateError extends Error {}

export interface DupSideCard {
  id: number;
  name: string;
  phone: string | null;
  instagram: string | null;
  area: string | null;
  owner_name: string | null;
  orders: number;
  last_activity: string;
}
export interface DupPair {
  reason: "phone" | "instagram";
  /** The record the merge would keep, and the one folded into it. */
  keep: DupSideCard;
  drop: DupSideCard;
}

interface Row {
  id: number;
  business_name: string;
  phone: string | null;
  instagram: string | null;
  area_label: string | null;
  owner_user_id: number | null;
  group_id: number | null;
  organization_id: number;
  owner_name: string | null;
  orders: number;
  last_activity: string | null;
}

const CARD_SQL = `SELECT c.id, c.business_name, c.phone, c.instagram, c.area_label, c.owner_user_id, c.group_id, c.organization_id,
                         u.display_name AS owner_name,
                         (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders,
                         c.last_activity_at AS last_activity
                    FROM customers c LEFT JOIN users u ON u.id = c.owner_user_id`;

const ledgerLines = async (id: number): Promise<number> =>
  (await getDb().prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE customer_id = ?").get(id) as { n: number }).n;

const card = (r: Row): DupSideCard => ({
  id: r.id,
  name: r.business_name,
  phone: r.phone,
  instagram: r.instagram,
  area: r.area_label,
  owner_name: r.owner_name,
  orders: r.orders,
  last_activity: r.last_activity ?? "",
});
const side = (c: DupSideCard): DupSide => ({ id: c.id, orders: c.orders, lastActivity: c.last_activity });

/** Pairs of live customer records that share a phone number or an Instagram page and have not been
 *  marked «not the same». Only pairs the caller can see on BOTH sides. */
export async function duplicatePairs(session: Session, limit = 30): Promise<DupPair[]> {
  const db = getDb();
  const pairs = await db
    .prepare(
      `SELECT a.id AS a_id, b.id AS b_id,
              CASE WHEN a.phone_norm IS NOT NULL AND a.phone_norm = b.phone_norm THEN 'phone' ELSE 'instagram' END AS reason
         FROM customers a JOIN customers b
           ON b.id > a.id AND b.organization_id = a.organization_id
        WHERE a.organization_id = ? AND a.merged_into_id IS NULL AND b.merged_into_id IS NULL
          AND ((a.phone_norm IS NOT NULL AND a.phone_norm = b.phone_norm)
               OR (a.instagram IS NOT NULL AND a.instagram <> '' AND a.instagram = b.instagram))
          AND NOT EXISTS (SELECT 1 FROM crm_not_duplicates n
                           WHERE n.organization_id = a.organization_id AND n.low_id = a.id AND n.high_id = b.id)
        ORDER BY a.id, b.id LIMIT ?`
    )
    .all(session.organizationId, limit * 4) as { a_id: number; b_id: number; reason: "phone" | "instagram" }[];

  const one = db.prepare(`${CARD_SQL} WHERE c.id = ? AND c.organization_id = ?`);
  const out: DupPair[] = [];
  for (const p of pairs) {
    const a = await one.get(p.a_id, session.organizationId) as unknown as Row | undefined;
    const b = await one.get(p.b_id, session.organizationId) as unknown as Row | undefined;
    if (!a || !b || !canSeeBusiness(session, a) || !canSeeBusiness(session, b)) continue;
    const la = await ledgerLines(a.id);
    const lb = await ledgerLines(b.id);
    if (la > 0 && lb > 0) continue; // both have journal lines: the books cannot be merged, so do not offer it
    // The record that owns accounting lines must survive; otherwise the busier one does.
    const keep = la > 0 ? side(card(a)) : lb > 0 ? side(card(b)) : chooseSurvivor(side(card(a)), side(card(b))).keep;
    out.push({ reason: p.reason, keep: card(keep.id === a.id ? a : b), drop: card(keep.id === a.id ? b : a) });
    if (out.length >= limit) break;
  }
  return out;
}

/** «Not the same business»: remember it, so the pair is not offered again. */
export async function markSeparate(session: Session, aId: number, bId: number): Promise<void> {
  const [low, high] = pairKey(aId, bId);
  const db = getDb();
  for (const id of [low, high]) {
    const r = await db.prepare(`${CARD_SQL} WHERE c.id = ? AND c.organization_id = ?`).get(id, session.organizationId) as unknown as Row | undefined;
    if (!r || !canSeeBusiness(session, r)) throw new DuplicateError("پرونده پیدا نشد");
  }
  await db.prepare("INSERT OR IGNORE INTO crm_not_duplicates (organization_id, low_id, high_id, decided_by, decided_at) VALUES (?, ?, ?, ?, ?)").run(
    session.organizationId,
    low,
    high,
    session.user.id,
    new Date().toISOString(),
  );
}

/** Rows that point at a customer by `customer_id`, moved to the survivor. The accounting ledger is
 *  deliberately absent: its lines are append-only (a database trigger refuses updates), so the record
 *  that owns journal lines can only be the survivor, never the one folded away. */
const BY_CUSTOMER_ID = ["orders", "payments", "quality_complaints", "contacts", "activities"] as const;
/** Rows that point at a customer by (entity_type = 'customer', entity_id). History tables (events,
 *  notifications, rule runs) are left where they are on purpose: they record what was true then. */
const BY_ENTITY = ["activity_log", "reminders", "visit_plans", "tasks", "task_recurrences", "alerts", "photos"] as const;

/** Fold `dropId` into `keepId`: every order, payment, cheque, contact, note, task, reminder and photo
 *  moves to the survivor, blank fields on the survivor are filled from the other record, and the other
 *  record is marked merged (it disappears from lists; nothing is deleted). All or nothing.
 *
 *  Refused when it would silently lose something: both records are representatives, or both have a
 *  cheque with the same number. */
export async function mergeBusinesses(session: Session, keepId: number, dropId: number): Promise<void> {
  if (keepId === dropId) throw new DuplicateError("یک پرونده را نمی‌توان با خودش ادغام کرد");
  const db = getDb();
  const get = async (id: number) => await db.prepare(`${CARD_SQL} WHERE c.id = ? AND c.organization_id = ? AND c.merged_into_id IS NULL`).get(id, session.organizationId) as unknown as Row | undefined;
  const keep = await get(keepId);
  const drop = await get(dropId);
  if (!keep || !drop || !canSeeBusiness(session, keep) || !canSeeBusiness(session, drop)) throw new DuplicateError("پرونده پیدا نشد");

  await db.tx(async () => {
    const rep = await db.prepare("SELECT COUNT(*) AS n FROM representative_profiles WHERE customer_id IN (?, ?)").get(keepId, dropId) as { n: number };
    if (rep.n > 1) throw new DuplicateError("هر دو پرونده نماینده هستند و ادغام نمی‌شوند");
    if (await ledgerLines(dropId) > 0) throw new DuplicateError("دفتر حسابداری این پرونده سند دارد؛ پروندهٔ دیگر را نگه دارید");
    const clash = await db
      .prepare(
        `SELECT 1 FROM cheques a JOIN cheques b ON b.cheque_no = a.cheque_no AND b.organization_id = a.organization_id
          WHERE a.customer_id = ? AND b.customer_id = ? LIMIT 1`
      )
      .get(keepId, dropId);
    if (clash) throw new DuplicateError("هر دو پرونده چکی با شمارهٔ یکسان دارند؛ ابتدا یکی را اصلاح کنید");

    for (const t of BY_CUSTOMER_ID) await db.prepare(`UPDATE ${t} SET customer_id = ? WHERE customer_id = ?`).run(keepId, dropId);
    await db.prepare("UPDATE cheques SET customer_id = ? WHERE customer_id = ?").run(keepId, dropId);
    await db.prepare("UPDATE representative_profiles SET customer_id = ? WHERE customer_id = ?").run(keepId, dropId);
    // Tags are a set: keep one of each, drop the rest of the other record's.
    await db.prepare("UPDATE OR IGNORE customer_tags SET customer_id = ? WHERE customer_id = ?").run(keepId, dropId);
    await db.prepare("DELETE FROM customer_tags WHERE customer_id = ?").run(dropId);
    // A churn score is recomputed from the merged history.
    await db.prepare("DELETE FROM churn_scores WHERE customer_id = ?").run(dropId);
    for (const t of BY_ENTITY) await db.prepare(`UPDATE ${t} SET entity_id = ? WHERE entity_type = 'customer' AND entity_id = ?`).run(keepId, dropId);

    await db.prepare(
      `UPDATE customers SET
         phone = COALESCE(phone, (SELECT phone FROM customers WHERE id = ?)),
         phone_norm = COALESCE(phone_norm, (SELECT phone_norm FROM customers WHERE id = ?)),
         instagram = COALESCE(NULLIF(instagram, ''), (SELECT instagram FROM customers WHERE id = ?)),
         address = COALESCE(address, (SELECT address FROM customers WHERE id = ?)),
         lat = COALESCE(lat, (SELECT lat FROM customers WHERE id = ?)),
         lng = COALESCE(lng, (SELECT lng FROM customers WHERE id = ?))
       WHERE id = ?`
    ).run(dropId, dropId, dropId, dropId, dropId, dropId, keepId);
    await db.prepare("UPDATE customers SET merged_into_id = ? WHERE id = ?").run(keepId, dropId);
    await logActivity(db, {
      entity_type: "customer",
      entity_id: keepId,
      event_type: "note",
      old_value: null,
      new_value: null,
      note: `ادغام با «${drop.business_name}»`,
      changed_by: session.user.display_name,
      changed_by_user_id: session.user.id,
    });
  });
}
