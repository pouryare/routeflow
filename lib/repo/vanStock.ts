import { getDb } from "@/lib/db";
import { pickDepot } from "@/lib/routing/depot";
import { onHand, recordMovementsTxn, type MovementInput } from "@/lib/repo/stock";

/** A van is a facility. Goods move warehouse -> van -> the customer's door, and every step of
 *  that has to be a recorded movement, or the arithmetic stops meaning anything.
 *
 *  Before this module existed there was nowhere a van could hold stock: `stock_movements`
 *  references `facilities`, every facility was a warehouse, and a delivery wrote `DELIVERY_OUT`
 *  against one. So goods loaded onto a van in the morning and delivered at noon decremented the
 *  WAREHOUSE — twice, once for the load and once for the drop — and the warehouse's on-hand
 *  quietly drifted below reality with no error anywhere.
 *
 *  Nothing here invents stock arithmetic. `onHand` and `recordMovementsTxn` already exist and
 *  already take a facility; this module only decides WHICH facility, and refuses moves the
 *  warehouse or the van cannot cover. */

export class VanStockError extends Error {}

/** Creates (or finds) the facility a van keeps its stock in.
 *
 *  Idempotent on the slug, because the natural key here is the plate: reloading the page, or two
 *  people registering the same van, must not produce two stock locations for one vehicle — which
 *  would split its stock in half across two balances and make both wrong. */
export async function createVanFacility(organizationId: number, name: string, plate: string): Promise<number> {
  const db = getDb();
  const slug = `van-${organizationId}-${plate}`.replace(/\s+/g, "-");
  const existing = await db.prepare("SELECT id FROM facilities WHERE slug = ?").get(slug) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  /* lat/lng are NULL, not 0,0.
   *
   * A van has no location of its own. It is either parked somewhere a person chose, or it
   * is somewhere its driver's phone says it is right now -- a live reading, not stored data.
   * The 0,0 that used to be written here was Null Island: every van in the app sat in the
   * Gulf of Guinea, and on a map it was a marker in open water. */
  const now = new Date().toISOString();
  return Number(
    (await db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, owner_username,
                                 organization_id, created_at, updated_at)
         VALUES (?, 'van', ?, NULL, NULL, 0, ?, ?, ?, ?)`
      )
      .run(slug, name, plate, organizationId, now, now)).lastInsertRowid
  );
}

/** Loads goods onto a van: a TRANSFER_OUT from the warehouse and a TRANSFER_IN to the van.
 *
 *  Refuses to load more than the warehouse holds. Without that check a typo puts the warehouse
 *  into negative stock, and every later "what is on hand" answer is quietly wrong — which is
 *  precisely the failure mode this whole phase exists to end.
 *
 *  BOTH legs go in one transaction. A transfer whose outbound leg committed and whose inbound
 *  leg did not is stock that simply vanished, with the ledger showing one honest-looking half. */
export async function loadVan(
  organizationId: number,
  input: { facilityId: number; productId: number; qty: number; actorId: number | null },
): Promise<void> {
  if (input.qty <= 0) throw new VanStockError("مقدار باید بیشتر از صفر باشد");

  const db = getDb();
  const warehouse = await warehouseFor(organizationId);
  const held = await onHand(organizationId, { product_id: input.productId, facility_id: warehouse });
  if (held < input.qty) {
    throw new VanStockError(`موجودی انبار کافی نیست (${held} موجود، ${input.qty} درخواست)`);
  }

  const now = new Date().toISOString();
  const leg = (
    facilityId: number,
    qty: number,
    kind: "TRANSFER_OUT" | "TRANSFER_IN",
  ): MovementInput => ({
    facility_id: facilityId,
    product_id: input.productId,
    batch_id: null,
    base_qty: qty,
    kind,
    ref_type: "van_load",
    occurred_at: now,
    created_by: input.actorId,
  });

  await recordMovementsTxn(db, organizationId, [
    leg(warehouse, -input.qty, "TRANSFER_OUT"),
    leg(input.facilityId, input.qty, "TRANSFER_IN"),
  ]);
}

/** Delivers from the van. Decrements THE VAN, and only the van.
 *
 *  This is the double-count. The warehouse was already decremented when the van was loaded, so
 *  touching it again here is exactly what made on-hand drift below reality. */
export async function deliverFromVan(
  organizationId: number,
  input: { facilityId: number; productId: number; qty: number; actorId: number | null },
): Promise<void> {
  if (input.qty <= 0) throw new VanStockError("مقدار باید بیشتر از صفر باشد");
  const db = getDb();
  const held = await onHand(organizationId, { product_id: input.productId, facility_id: input.facilityId });
  if (held < input.qty) {
    throw new VanStockError(`موجودی وانت کافی نیست (${held} موجود، ${input.qty} درخواست)`);
  }

  const now = new Date().toISOString();
  await recordMovementsTxn(db, organizationId, [
    {
      facility_id: input.facilityId,
      product_id: input.productId,
      batch_id: null,
      base_qty: -input.qty,
      kind: "DELIVERY_OUT",
      ref_type: "van_delivery",
      occurred_at: now,
      created_by: input.actorId,
    },
  ]);
}

/** How much of a product is on a van right now. */
export async function vanOnHand(organizationId: number, facilityId: number, productId: number): Promise<number> {
  return await onHand(organizationId, { product_id: productId, facility_id: facilityId });
}

/** The facility holding this driver's van, or null when they have no van on file.
 *
 *  This had to be invented rather than looked up, because there was nothing to look up:
 *  `delivery_runs` carries no vehicle, so a delivery knows its driver and nothing about which
 *  van it came off. `vehicles.driver_default_id` is the only link, and it is a DEFAULT -- a
 *  driver who swaps vans for a day is, on this data, still credited to the same one.
 *
 *  Deliberately null rather than throwing. A driver with no van registered is an ordinary
 *  state, not an error, and callers need to be able to ask "do I know a van for this?" without
 *  wrapping the question in a try/catch. */
export async function vanFacilityFor(organizationId: number, driverUserId: number): Promise<number | null> {
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT v.id, v.name, v.plate
         FROM vehicles v
        WHERE v.driver_default_id = ? AND v.organization_id = ? AND v.active = 1
        ORDER BY v.id
        LIMIT 1`
    )
    .get(driverUserId, organizationId) as
    | { id: number; name: string; plate: string | null }
    | undefined;
  if (!row) return null;
  // createVanFacility is idempotent on the plate, so this cannot split one van's stock across
  // two facilities however many times it is called.
  return await createVanFacility(
    organizationId,
    row.name,
    row.plate ?? `veh-${row.id}`
  );
}

/** The tenant's depot: the source a van is loaded from.
 *
 *  Moved to lib/routing/depot.ts. This used to be `kind = 'warehouse'` first, then the
 *  flag, then lowest id -- which meant a business whose depot is not typed "warehouse" could
 *  never load a van at all, and a business with two warehouses silently loaded from whichever
 *  came first. pickDepot asks the flag first and falls back to anything placed.
 *
 *  The throw is unchanged and still the right one: loading stock needs a real answer. */
async function warehouseFor(organizationId: number): Promise<number> {
  return (await pickDepot(organizationId)).id;
}