import { getDb, plain } from "@/lib/db";
import { orderFilter, groupFilter } from "@/lib/session";
import type { Session } from "@/lib/session";
import { tombstonesSince, type Tombstone } from "./tombstones";
import { isVanRole } from "../roles";

export interface PullRow {
  table: string;
  row: Record<string, unknown>;
}
export interface PullResult {
  watermark: string;
  rows: PullRow[];
  tombstones: Tombstone[];
}

const EPOCH = "1970-01-01T00:00:00.000Z";

/** Rows this session may see that changed since `since` (null = a full snapshot), plus
 *  tombstones, plus the new watermark.
 *
 *  The watermark is the newest change seen (rows AND tombstones), but never later than the
 *  millisecond BEFORE this pull started. The filters are strict (`> since`) and timestamps
 *  are millisecond ISO strings, so a watermark equal to "now" would hide anything written
 *  later in that same millisecond -- a delete stamped at T right after a pull that saw a
 *  row at T was simply never sent, and the device kept the deleted row for good. Capping
 *  the watermark at start-1ms means the current millisecond is always asked for again: a
 *  row stamped in it may arrive twice, which is harmless because the device upserts by id
 *  and a tombstone deletes by id. A pull whose changes are all older than its own
 *  millisecond still advances to the newest of them, so an idle re-pull returns nothing.
 *
 *  This holds because every timestamp here comes from the same server clock and each
 *  write is stamped and committed in one synchronous step; a writer in another process
 *  with a long transaction could still commit an older stamp after a pull read past it.
 *
 *  A driver gets their own runs and everything a stop needs; a salesperson / manager /
 *  owner gets their group's recent orders and customers. The catalogue
 *  (products / prices / packagings) goes to everyone in full -- it is small and a driver
 *  at a door needs a price. */
export function pullSince(
  session: Session,
  since: string | null,
  now: Date = new Date()
): PullResult {
  const db = getDb();
  // Taken before any read: everything stamped before this millisecond is already visible.
  const settled = new Date(now.getTime() - 1).toISOString();
  const org = session.organizationId;
  const from = since ?? EPOCH;
  const rows: PullRow[] = [];
  let maxChange = from;
  const seen = (t: string) => {
    if (t > maxChange) maxChange = t;
  };
  const add = (table: string, list: Record<string, unknown>[], changeKey: string) => {
    for (const r of list) {
      rows.push({ table, row: r });
      const v = r[changeKey];
      if (typeof v === "string") seen(v);
    }
  };

  // --- catalogue: everyone, in full ------------------------------------------------
  add(
    "products",
    plain(
      db
        .prepare(
          "SELECT * FROM products WHERE (organization_id = ? OR organization_id IS NULL) AND updated_at > ?"
        )
        .all(org, from) as Record<string, unknown>[]
    ),
    "updated_at"
  );
  add(
    "packagings",
    plain(
      db
        .prepare(
          `SELECT pk.* FROM packagings pk JOIN products p ON p.id = pk.product_id
            WHERE (p.organization_id = ? OR p.organization_id IS NULL) AND pk.created_at > ?`
        )
        .all(org, from) as Record<string, unknown>[]
    ),
    "created_at"
  );
  add(
    "product_prices",
    plain(
      db
        .prepare(
          `SELECT pp.* FROM product_prices pp JOIN products p ON p.id = pp.product_id
            WHERE (p.organization_id = ? OR p.organization_id IS NULL) AND pp.created_at > ?`
        )
        .all(org, from) as Record<string, unknown>[]
    ),
    "created_at"
  );

  const isDriver = isVanRole(session.role);

  if (isDriver) {
    const runIds = (
      db
        .prepare("SELECT id FROM delivery_runs WHERE driver_user_id = ? AND organization_id = ?")
        .all(session.user.id, org) as { id: number }[]
    ).map((r) => r.id);
    const runList = runIds.length ? runIds.join(",") : "NULL";

    add(
      "delivery_runs",
      plain(
        db
          .prepare(`SELECT * FROM delivery_runs WHERE id IN (${runList}) AND updated_at > ?`)
          .all(from) as Record<string, unknown>[]
      ),
      "updated_at"
    );
    const stops = plain(
      db
        .prepare(`SELECT * FROM delivery_stops WHERE run_id IN (${runList}) AND created_at > ?`)
        .all(from) as Record<string, unknown>[]
    );
    add("delivery_stops", stops, "created_at");

    /* The driver's VISITS, which used not to be here at all.
     *
     *  Before Phase 2 a visit lived on its own `lead_run` with its own run row, and this function
     *  read only `delivery_runs` / `delivery_stops`. So a driver offline in the field saw their
     *  deliveries and no visits at all — half the manifest, absent with no error, because a
     *  missing row looks exactly like a day with nothing to visit.
     *
     *  Phase 2 folded lead_runs into delivery_runs, so `runIds` above now covers visits too and
     *  this is the same shape as the delivery stops. `lead_run_stops` has no `status` column: a
     *  visit is driven or it is not, tracked by the visit's own outcome. */
    const visitStops = plain(
      db
        .prepare(`SELECT * FROM lead_run_stops WHERE run_id IN (${runList}) AND created_at > ?`)
        .all(from) as Record<string, unknown>[]
    );
    add("lead_run_stops", visitStops, "created_at");

    /* The places themselves must travel WITH the run.
     *
     * This is the same mistake the visits above were, one level up. `saved_locations` is a
     * DIFFERENT table from `facilities` -- geocoding scratch rows for leads, not the
     * businesses' own buildings -- and nothing kept the two in step. So an offline driver got
     * a run card reading «بارگیری · انبار بکه» with no address and no pin.
     *
     * That is not a rendering nicety. The whole premise of a facility stop is that the driver
     * MUST KNOW WHERE HE IS GOING, and this feature runs in a van with no signal. A missing
     * row looks exactly like a place that has no location yet, which is how a real address
     * becomes indistinguishable from an invented one. */
    const runFacilityStops = plain(
      db
        .prepare(`SELECT * FROM run_facility_stops WHERE run_id IN (${runList}) AND created_at > ?`)
        .all(from) as Record<string, unknown>[]
    );
    add("run_facility_stops", runFacilityStops, "created_at");

    if (runFacilityStops.length > 0) {
      const facilityIds = new Set<number>();
      for (const s of runFacilityStops) {
        facilityIds.add(Number((s as { facility_id: number }).facility_id));
      }
      const list = [...facilityIds].join(",");
      const facilities = plain(
        db
          .prepare(
            `SELECT * FROM facilities WHERE id IN (${list})
               AND (organization_id = ? OR organization_id IS NULL)`
          )
          .all(org) as Record<string, unknown>[]
      );
      add("facilities", facilities, "updated_at");

      // ...and the unload lines, which are how the day is closed.
      const unloadLines = plain(
        db
          .prepare(`SELECT * FROM run_unload_lines WHERE run_id IN (${runList}) AND created_at > ?`)
          .all(from) as Record<string, unknown>[]
      );
      add("run_unload_lines", unloadLines, "created_at");
    }

    /* The pins themselves must travel WITH the visits. A `lead_run_stops` row pointing at a
     * saved_locations id the device has never seen renders as a blank card — the row arrives,
     * the name does not, and the driver sees an unnamed stop with a coordinate and no idea. */
    const locationIds = new Set<number>();
    for (const s of visitStops) locationIds.add(Number((s as { location_id: number }).location_id));
    for (const s of db
      .prepare(`SELECT location_id FROM lead_run_stops WHERE run_id IN (${runList})`)
      .all() as { location_id: number }[]) {
      locationIds.add(s.location_id);
    }
    const locList = locationIds.size ? [...locationIds].join(",") : "NULL";
    add(
      "saved_locations",
      plain(
        db
          .prepare(`SELECT * FROM saved_locations WHERE id IN (${locList}) AND created_at > ?`)
          .all(from) as Record<string, unknown>[]
      ),
      "created_at"
    );

    const orderIds = new Set<number>();
    for (const s of stops) orderIds.add(Number((s as { order_id: number }).order_id));
    // also orders on stops not changed since `from` but whose order did change
    for (const r of db
      .prepare(`SELECT order_id FROM delivery_stops WHERE run_id IN (${runList})`)
      .all() as { order_id: number }[])
      orderIds.add(r.order_id);
    const orderList = orderIds.size ? [...orderIds].join(",") : "NULL";

    const orders = plain(
      db
        .prepare(`SELECT * FROM orders WHERE id IN (${orderList}) AND updated_at > ?`)
        .all(from) as Record<string, unknown>[]
    );
    add("orders", orders, "updated_at");
    add(
      "order_lines",
      plain(
        db
          .prepare(`SELECT * FROM order_lines WHERE order_id IN (${orderList}) AND created_at > ?`)
          .all(from) as Record<string, unknown>[]
      ),
      "created_at"
    );
    add(
      "customers",
      plain(
        db
          .prepare(
            `SELECT * FROM customers WHERE id IN (
               SELECT DISTINCT customer_id FROM orders WHERE id IN (${orderList})
             ) AND synced_at > ?`
          )
          .all(from) as Record<string, unknown>[]
      ),
      "synced_at"
    );
    add(
      "deliveries",
      plain(
        db
          .prepare(`SELECT * FROM deliveries WHERE order_id IN (${orderList}) AND created_at > ?`)
          .all(from) as Record<string, unknown>[]
      ),
      "created_at"
    );
  } else {
    // salesperson / group_manager / owner -- their group's recent business
    const of = orderFilter(session);
    const gf = groupFilter(session, "c.group_id");

    add(
      "orders",
      plain(
        db
          .prepare(`SELECT o.* FROM orders o WHERE o.updated_at > ?${of.sql}`)
          .all(from, ...of.params) as Record<string, unknown>[]
      ),
      "updated_at"
    );
    add(
      "customers",
      plain(
        db
          .prepare(`SELECT c.* FROM customers c WHERE c.synced_at > ?${gf.sql}`)
          .all(from, ...gf.params) as Record<string, unknown>[]
      ),
      "synced_at"
    );
  }

  const tombstones = tombstonesSince(org, since);
  for (const t of tombstones) seen(t.deleted_at);

  return {
    watermark: maxChange > settled ? settled : maxChange,
    rows,
    tombstones,
  };
}
