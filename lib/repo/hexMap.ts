import { getDb } from "@/lib/db";
import { groupFilter, type Session } from "@/lib/session";
import { hexBins, type HexCell, type HexPoint } from "@/lib/h3";

export type HexMetric = "revenue" | "customers" | "leads";
const HEX_METRICS: HexMetric[] = ["revenue", "customers", "leads"];
export function isHexMetric(v: unknown): v is HexMetric {
  return typeof v === "string" && (HEX_METRICS as string[]).includes(v);
}

const CUSTOMER_LIFECYCLES = ["active", "dormant"];
const LEAD_LIFECYCLES = ["lead", "qualified", "sampled"];

/** The map's honeycomb numbers: per cell, how many customers (or leads) sit in it, or how much they bought.
 *  Scoped like the rest of the map: an owner sees every group, a manager their own groups only.
 *  `revenue` is delivered order lines over the last `days` days at the customer's place, before any order discount.
 *  shortcut: counted on request from the stored lat/lng; when F6 pings arrive, add an indexed h3_cell column and group in SQL. */
export async function hexCells(session: Session, metric: HexMetric, res: number, days: number): Promise<HexCell[]> {
  const db = getDb();
  const scope = await groupFilter(session, "c.group_id");
  const base = `FROM customers c WHERE c.organization_id = ? AND c.lat IS NOT NULL AND c.lng IS NOT NULL${scope.sql}`;

  if (metric === "revenue") {
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const rows = (await db
      .prepare(
        `SELECT c.lat, c.lng, SUM(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman) AS revenue
           FROM customers c
           JOIN orders o ON o.customer_id = c.id AND o.organization_id = c.organization_id
           JOIN order_lines ol ON ol.order_id = o.id
          WHERE c.organization_id = ? AND c.lat IS NOT NULL AND c.lng IS NOT NULL${scope.sql}
            AND o.order_date >= ? AND o.status IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'CLOSED')
          GROUP BY c.id, c.lat, c.lng`
      )
      .all(session.organizationId, ...scope.params, from)) as unknown as { lat: number; lng: number; revenue: number }[];
    return hexBins(rows.map((r): HexPoint => ({ lat: Number(r.lat), lng: Number(r.lng), weight: Number(r.revenue) })), res);
  }

  const kinds = metric === "leads" ? LEAD_LIFECYCLES : CUSTOMER_LIFECYCLES;
  const rows = (await db
    .prepare(`SELECT c.lat, c.lng ${base} AND c.lifecycle IN (${kinds.map(() => "?").join(", ")})`)
    .all(session.organizationId, ...scope.params, ...kinds)) as unknown as { lat: number; lng: number }[];
  return hexBins(rows.map((r) => ({ lat: Number(r.lat), lng: Number(r.lng) })), res);
}
