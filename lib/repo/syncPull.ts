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
 *  tombstones, plus the new watermark (the max change-time seen, so an immediate re-pull
 *  returns nothing).
 *
 *  A driver gets their own runs and everything a stop needs; a salesperson / manager /
 *  owner gets their group's recent orders and customers. The catalogue
 *  (products / prices / packagings) goes to everyone in full -- it is small and a driver
 *  at a door needs a price. */
export function pullSince(session: Session, since: string | null): PullResult {
  const db = getDb();
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

  return {
    watermark: maxChange,
    rows,
    tombstones: tombstonesSince(org, since),
  };
}
