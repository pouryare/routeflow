import type { DatabaseSync } from "node:sqlite";
import { getDb, type SavedLocationRow } from "@/lib/db";
import { districtIdForPoint } from "@/lib/groups";
import { findDuplicates, type DupMatch } from "./dedupe";
import { recomputeState } from "./state";

export class LeadPromotionError extends Error {
  /* An explicit field, not a TypeScript parameter property (`constructor(readonly status:
     number, …)`). A parameter property is not ERASABLE syntax — it needs real code
     generation — so `node --experimental-strip-types` rejects it with
     ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, and `lib/repo/orders.ts` imports this module, which
     takes `createOrder` down with it. Same semantics, one line more. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Promotion {
  customerId: number;
  /** False when the customer already existed -- a dedup hit, or a retry of the same call. */
  created: boolean;
  /** Existing customers this pin matched, when it matched any. Empty on a clean create. */
  linked: DupMatch[];
}

/** The customer code a given pin promotes under. Deterministic on purpose: a van that loses
 *  signal half way through a first order and retries must land on the same customer row
 *  rather than a second one, and LEAD-<id> is stable across processes in a way a uuid or a
 *  timestamp is not. UNIQUE(organization_id, customer_code) is what makes that a guarantee. */
export const leadCustomerCode = (locationId: number): string => `LEAD-${locationId}`;

/** Turn a pin into a customer. Shared by the office's manual convert and by a lead's first
 *  purchase, so "what a promotion means" is written down once.
 *
 *  Four properties this has to have, each of which was a way to get it wrong:
 *
 *  1. **It never deletes the pin.** The old route did, and because lead_list_items cascades
 *     on that foreign key it silently removed the stop from every route referencing it --
 *     including the run the driver was standing on. The pin stays; the customer points at it.
 *  2. **It is idempotent.** A second call returns the same customer. Two guards, because they
 *     fail differently: lead_location_id catches the dedup and retry paths, and the
 *     deterministic code catches a promotion that raced on the code.
 *  3. **It does not duplicate a business that already exists.** findDuplicates is asked
 *     first. A match the caller can see means this shop is already a customer, so the pin is
 *     linked to that customer rather than becoming a second one.
 *  4. **It refuses a match the caller cannot see.** findDuplicates redacts by session, so a
 *     match with a null id means "this exists and it is not yours". Creating a customer here
 *     would duplicate a business this person is not allowed to know about; linking to it
 *     would hand them a record they may not open. Neither is right, so it stops and says so.
 *
 *  It writes no lifecycle. The row is born a lead and the activity log moves it when the
 *  order lands, exactly as for any other new customer -- recomputeState is the only thing
 *  that writes that column.
 *
 *  group_id is copied from the pin rather than left null. That is not tidiness: canReachGroup
 *  admits a null-group row to an owner and to nobody else, so a customer promoted without it
 *  would be invisible to the very group_manager whose group the lead belonged to -- and to the
 *  driver who made the sale, who then gets a 404 on the order they just closed.
 */
export function promoteLeadToCustomer(
  orgId: number,
  locationId: number,
  session: Parameters<typeof findDuplicates>[0],
): Promotion {
  const db = getDb();
  const loc = db.prepare("SELECT * FROM saved_locations WHERE id = ? AND organization_id = ?")
    .get(locationId, orgId) as SavedLocationRow | undefined;
  if (!loc) throw new LeadPromotionError(404, "مکان پیدا نشد");
  if (loc.lat === null || loc.lng === null) {
    throw new LeadPromotionError(422, "این مکان مختصات ندارد؛ ابتدا موقعیت آن را روی نقشه تعیین کنید");
  }

  // Already promoted: the retry path, and the path where two stops share one pin.
  const existing = db.prepare("SELECT id FROM customers WHERE organization_id = ? AND lead_location_id = ?")
    .get(orgId, locationId) as { id: number } | undefined;
  if (existing) return { customerId: existing.id, created: false, linked: [] };

  const matches = findDuplicates(session, { name: loc.name, lat: loc.lat, lng: loc.lng });
  if (matches.length > 0) {
    const hidden = matches.find((m) => !m.reachable);
    if (hidden) {
      // The shop is already a customer and this session may not see it. Say so plainly
      // rather than guessing: a duplicate here is worse than an extra phone call.
      throw new LeadPromotionError(
        409,
        "مکانی مشابه این کسب‌وکار قبلاً مشتری است؛ برای تبدیل با دفتر تماس بگیرید"
      );
    }
    // A type predicate rather than `!`: DupMatch.id is nullable because a redacted match has
    // none, and the `hidden` branch above has already returned for those. Asserting the whole
    // match is reachable does not narrow its id, which is how a null reaches the UPDATE.
    const reachable = matches.find((m): m is DupMatch & { id: number } => m.id !== null);
    if (!reachable) throw new LeadPromotionError(409, "مکان پیدا نشد");
    // COALESCE on district_id, deliberately. The business behind this pin is already a
    // customer, located by its own means, and a pin is an approximate drop that could be
    // across the city -- so its district is not ours to overwrite. Filling a gap is safe;
    // replacing a real classification is not.
    //
    // The value is computed here rather than in the SQL: districtIdForPoint is a JS
    // function over boundary_geojson, and a first attempt at inlining it produced
    // "no such column: db" at runtime.
    const linkedDistrict = districtIdForPoint(db, loc.lat, loc.lng);
    db.prepare(
      `UPDATE customers
          SET lead_location_id = ?,
              district_id = COALESCE(district_id, ?)
        WHERE id = ? AND organization_id = ?`
    )
      .run(locationId, linkedDistrict as number | null, reachable.id, orgId);
    return { customerId: reachable.id, created: false, linked: matches };
  }

  const now = new Date().toISOString();
  const code = leadCustomerCode(locationId);
  const notes = ["از فهرست مکان‌های پیشنهادی تبدیل شد", loc.address, loc.notes]
    .filter(Boolean)
    .join(" — ");
  // The district, from the pin's own coordinates. This is the path every Google Maps pin
  // takes -- a rep drops a pin, the first purchase promotes it -- so without this a promoted
  // customer carried lat/lng but no district, and therefore no code, no territory and no
  // place on the map. Every other field looked right, which is what made it invisible.
  // Same function, and therefore the same precedence rules, as the add-lead path.
  const districtId = districtIdForPoint(db, loc.lat, loc.lng);
  const result = db.prepare(`
      INSERT INTO customers (customer_code, business_name, address, city, province, lat, lng, notes,
                             group_id, lead_location_id, district_id, synced_at, organization_id)
      VALUES (?, ?, ?, 'تهران', 'تهران', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, customer_code) DO NOTHING
    `).run(
      code, loc.name, loc.address, loc.lat, loc.lng, notes,
      // A pin with no group is a real state, and the column stays nullable to match it --
      // node:sqlite's run() overloads just do not admit null here. Same for district_id: a
      // point outside every polygon has no district, and NULL says that honestly.
      loc.group_id as number | null,
      locationId,
      districtId as number | null,
      now, orgId
    );

  if (result.changes === 0) {
    // The code was taken between the check above and here, or by an earlier attempt whose
    // row exists without the link. Either way the customer is already there.
    const row = db.prepare("SELECT id FROM customers WHERE organization_id = ? AND customer_code = ?")
      .get(orgId, code) as { id: number } | undefined;
    if (!row) throw new LeadPromotionError(500, "تبدیل مکان انجام نشد");
    db.prepare("UPDATE customers SET lead_location_id = ? WHERE id = ? AND organization_id = ?")
      .run(locationId, row.id, orgId);
    return { customerId: row.id, created: false, linked: [] };
  }
  return { customerId: Number(result.lastInsertRowid), created: true, linked: [] };
}

/** Undo a promotion whose order then failed, so rule 1 keeps its meaning: no customer
 *  without a purchase behind it.
 *
 *  Refuses to delete a customer that has orders, which makes it safe to call after any
 *  failure rather than only the ones we predicted. A dedup-linked promotion is never
 *  removed -- `created` is false for those, and the business was already a customer, so
 *  there is nothing of ours to take back. */
export function unpromoteLead(orgId: number, promotion: Promotion): void {
  if (!promotion.created) return;
  const db = getDb();
  const orders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND organization_id = ?")
    .get(promotion.customerId, orgId) as { n: number };
  if (orders.n > 0) return;
  db.prepare("DELETE FROM customers WHERE id = ? AND organization_id = ? AND lead_location_id IS NOT NULL")
    .run(promotion.customerId, orgId);
}

/** A delivered sale converts the same business row, inside the order transaction. */
export function convertOnDelivery(conn: DatabaseSync, orgId: number, orderId: number, actorId: number | null): void {
  const o = conn.prepare("SELECT customer_id, COALESCE(order_type, 'SALE') AS order_type FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, orgId) as { customer_id: number; order_type: string } | undefined;
  if (!o || o.order_type !== "SALE") return;
  const n = (conn.prepare(`SELECT COUNT(*) n FROM orders WHERE customer_id = ? AND organization_id = ? AND COALESCE(order_type, 'SALE') = 'SALE'
                            AND status IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'CLOSED')`).get(o.customer_id, orgId) as { n: number }).n;
  const at = new Date().toISOString();
  conn.prepare(`INSERT INTO activities (organization_id, customer_id, user_id, type, note, stage_to, verification_to, occurred_at, created_at)
                VALUES (?, ?, ?, 'order', ?, ?, 'verified', ?, ?)`)
    .run(orgId, o.customer_id, actorId, `سفارش ${orderId} تحویل شد`, n >= 2 ? "repeat_customer" : "first_order", at, at);
  conn.prepare("UPDATE customers SET first_order_at = COALESCE(first_order_at, ?) WHERE id = ? AND organization_id = ?").run(at, o.customer_id, orgId);
  recomputeState(conn, o.customer_id);
}
