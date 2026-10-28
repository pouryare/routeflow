import { getDb, plain } from "@/lib/db";
import { orderFilter, groupFilter } from "@/lib/session";
import type { Session } from "@/lib/session";
import { tombstonesSinceXid, type Tombstone } from "./tombstones";
import { isVanRole } from "../roles";
import { TERMINAL_ORDER_STATUSES, sqlStatusList } from "../orderStateMachine";

export interface PullRow {
  table: string;
  row: Record<string, unknown>;
}
export interface PullResult {
  watermark: string;
  rows: PullRow[];
  tombstones: Tombstone[];
}

/** Rows this session may see that changed since `since` (null = a full snapshot), plus
 *  tombstones, plus the new watermark.
 *
 *  The watermark is a transaction id, `x:` plus pg_snapshot_xmin, taken before any read: every
 *  transaction below it has committed or rolled back, so no row can later appear with an older
 *  stamp. A row's stamp is the transaction that last wrote it (sync_xid, set by trigger;
 *  db/migrations/1761400000000_sync-xid.sql). One at or above the watermark may come again next
 *  time, which is harmless because the device upserts by id and a tombstone deletes by id. A
 *  watermark in any other shape (none yet) asks for everything again.
 *
 *  A driver gets their own runs and everything a stop needs; a salesperson / manager /
 *  owner gets their group's recent orders and customers. The catalogue
 *  (products / prices / packagings) goes to everyone in full -- it is small and a driver
 *  at a door needs a price. */
export async function pullSince(session: Session, since: string | null): Promise<PullResult> {
  const db = getDb();
  const xmin = ((await db.prepare("SELECT CAST(pg_snapshot_xmin(pg_current_snapshot()) AS text) AS x").get()) as { x: string }).x;
  const org = session.organizationId;
  const mark = xidOf(since);
  /* "Changed since the watermark": the transaction that last wrote the row is not below it. */
  const changed = (alias: string) => `COALESCE(${alias}sync_xid, '0') >= CAST(? AS xid8)`;
  const rows: PullRow[] = [];
  const add = (table: string, list: Record<string, unknown>[]) => {
    for (const r of list) {
      delete r.sync_xid; // bookkeeping for the watermark, not part of the row
      rows.push({ table, row: r });
    }
  };

  // --- catalogue: everyone, in full ------------------------------------------------
  add(
    "products",
    plain(
      await db
        .prepare(
          `SELECT * FROM products WHERE (organization_id = ? OR organization_id IS NULL) AND ${changed("")}`
        )
        .all(org, mark) as Record<string, unknown>[]
    )
  );
  add(
    "packagings",
    plain(
      await db
        .prepare(
          `SELECT pk.* FROM packagings pk JOIN products p ON p.id = pk.product_id
            WHERE (p.organization_id = ? OR p.organization_id IS NULL) AND ${changed("pk.")}`
        )
        .all(org, mark) as Record<string, unknown>[]
    )
  );
  add(
    "product_prices",
    plain(
      await db
        .prepare(
          `SELECT pp.* FROM product_prices pp JOIN products p ON p.id = pp.product_id
            WHERE (p.organization_id = ? OR p.organization_id IS NULL) AND ${changed("pp.")}`
        )
        .all(org, mark) as Record<string, unknown>[]
    )
  );

  const isDriver = isVanRole(session.role);

  if (isDriver) {
    /* shortcut: a driver's phone gets open runs and the last DRIVER_WINDOW_DAYS of finished ones, not
       every run they ever drove (a year of history was 2 MB, 95% of it finished orders nobody opens
       in a van). Older runs already on the phone stay; upgrade to an on-demand fetch if a driver
       needs to look a delivery up from further back while offline. */
    const since = new Date(Date.now() - DRIVER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const runIds = (
      await db
        .prepare(
          "SELECT id FROM delivery_runs WHERE driver_user_id = ? AND organization_id = ? AND (status <> 'done' OR run_date >= ?)"
        )
        .all(session.user.id, org, since) as { id: number }[]
    ).map((r) => r.id);
    const runList = runIds.length ? runIds.join(",") : "NULL";

    add(
      "delivery_runs",
      plain(
        await db
          .prepare(`SELECT * FROM delivery_runs WHERE id IN (${runList}) AND ${changed("")}`)
          .all(mark) as Record<string, unknown>[]
      )
    );
    const stops = plain(
      await db
        .prepare(`SELECT * FROM delivery_stops WHERE run_id IN (${runList}) AND ${changed("")}`)
        .all(mark) as Record<string, unknown>[]
    );
    add("delivery_stops", stops);

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
      await db
        .prepare(`SELECT * FROM lead_run_stops WHERE run_id IN (${runList}) AND ${changed("")}`)
        .all(mark) as Record<string, unknown>[]
    );
    add("lead_run_stops", visitStops);

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
      await db
        .prepare(`SELECT * FROM run_facility_stops WHERE run_id IN (${runList}) AND ${changed("")}`)
        .all(mark) as Record<string, unknown>[]
    );
    add("run_facility_stops", runFacilityStops);

    if (runFacilityStops.length > 0) {
      const facilityIds = new Set<number>();
      for (const s of runFacilityStops) {
        facilityIds.add(Number((s as { facility_id: number }).facility_id));
      }
      const list = [...facilityIds].join(",");
      const facilities = plain(
        await db
          .prepare(
            `SELECT * FROM facilities WHERE id IN (${list})
               AND (organization_id = ? OR organization_id IS NULL)`
          )
          .all(org) as Record<string, unknown>[]
      );
      add("facilities", facilities);

      // ...and the unload lines, which are how the day is closed.
      const unloadLines = plain(
        await db
          .prepare(`SELECT * FROM run_unload_lines WHERE run_id IN (${runList}) AND ${changed("")}`)
          .all(mark) as Record<string, unknown>[]
      );
      add("run_unload_lines", unloadLines);
    }

    /* The pins themselves must travel WITH the visits. A `lead_run_stops` row pointing at a
     * saved_locations id the device has never seen renders as a blank card — the row arrives,
     * the name does not, and the driver sees an unnamed stop with a coordinate and no idea. */
    const locationIds = new Set<number>();
    for (const s of visitStops) locationIds.add(Number((s as { location_id: number }).location_id));
    for (const s of await db
      .prepare(`SELECT location_id FROM lead_run_stops WHERE run_id IN (${runList})`)
      .all() as { location_id: number }[]) {
      locationIds.add(s.location_id);
    }
    const locList = locationIds.size ? [...locationIds].join(",") : "NULL";
    add(
      "saved_locations",
      plain(
        await db
          .prepare(`SELECT * FROM saved_locations WHERE id IN (${locList}) AND ${changed("")}`)
          .all(mark) as Record<string, unknown>[]
      )
    );

    const orderIds = new Set<number>();
    for (const s of stops) orderIds.add(Number((s as { order_id: number }).order_id));
    // also orders on stops not changed since `from` but whose order did change
    for (const r of await db
      .prepare(`SELECT order_id FROM delivery_stops WHERE run_id IN (${runList})`)
      .all() as { order_id: number }[])
      orderIds.add(r.order_id);
    const orderList = orderIds.size ? [...orderIds].join(",") : "NULL";

    const orders = plain(
      await db
        .prepare(`SELECT * FROM orders WHERE id IN (${orderList}) AND ${changed("")}`)
        .all(mark) as Record<string, unknown>[]
    );
    add("orders", orders);
    add(
      "order_lines",
      plain(
        await db
          .prepare(`SELECT * FROM order_lines WHERE order_id IN (${orderList}) AND ${changed("")}`)
          .all(mark) as Record<string, unknown>[]
      )
    );
    add(
      "customers",
      plain(
        await db
          .prepare(
            `SELECT * FROM customers WHERE id IN (
               SELECT DISTINCT customer_id FROM orders WHERE id IN (${orderList})
             ) AND ${changed("")}`
          )
          .all(mark) as Record<string, unknown>[]
      )
    );
    add(
      "deliveries",
      plain(
        await db
          .prepare(`SELECT * FROM deliveries WHERE order_id IN (${orderList}) AND ${changed("")}`)
          .all(mark) as Record<string, unknown>[]
      )
    );
  } else {
    // salesperson / group_manager / owner -- their group's recent business
    const of = orderFilter(session);
    const gf = await groupFilter(session, "c.group_id");

    /* shortcut: a finished, fully paid order older than ORDER_WINDOW_DAYS is not sent (an owner's
       phone held 600 KB of them). Open, unpaid and recent orders always are; the order page still
       loads any old order online. Upgrade to an on-demand fetch if offline lookups of old paid
       orders are needed. */
    const orderSince = new Date(Date.now() - ORDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    add(
      "orders",
      plain(
        await db
          .prepare(
            `SELECT o.* FROM orders o WHERE ${changed("o.")}${of.sql}
               AND (o.order_date >= ? OR o.payment_status <> 'paid' OR o.status NOT IN (${sqlStatusList([...TERMINAL_ORDER_STATUSES])}))`
          )
          .all(mark, ...of.params, orderSince) as Record<string, unknown>[]
      )
    );
    add(
      "customers",
      plain(
        await db
          .prepare(`SELECT c.* FROM customers c WHERE ${changed("c.")}${gf.sql}`)
          .all(mark, ...gf.params) as Record<string, unknown>[]
      )
    );
  }

  const tombstones = await tombstonesSinceXid(org, mark);

  return { watermark: `${XID_PREFIX}${xmin}`, rows, tombstones };
}

/** How far back a driver's finished runs travel to the phone. */
const DRIVER_WINDOW_DAYS = 14;

/** How far back a salesperson's, manager's or owner's finished, paid orders travel to the phone. */
const ORDER_WINDOW_DAYS = 60;

/** A watermark is `x:` and a transaction id; anything else starts from the beginning. */
const XID_PREFIX = "x:";
function xidOf(since: string | null): string {
  return since?.startsWith(XID_PREFIX) && /^\d+$/.test(since.slice(XID_PREFIX.length)) ? since.slice(XID_PREFIX.length) : "0";
}

