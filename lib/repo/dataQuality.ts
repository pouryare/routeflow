import { getDb } from "@/lib/db";
import { crmFilter, type Session } from "@/lib/session";

/** F54: customers whose record is missing what the field needs: a location to drive to, a phone
 *  to call, a district to plan by. Only served customers (active or dormant) are checked; a lead
 *  is expected to be incomplete. Merged and closed records are left out.
 *
 *  Scope is crmFilter, the same as the customer list a manager fixes them from: the owner over
 *  the company, a group manager over their group. */

export type Gap = "location" | "phone" | "district";

export interface GapRow {
  id: number;
  business_name: string;
  customer_code: string;
  group_name: string | null;
  gaps: Gap[];
}

export interface GroupQuality {
  group_name: string | null;
  customers: number;
  location: number;
  phone: number;
  district: number;
  /** Share of this group's customers with none of the three gaps, 0..1. */
  complete: number;
}

const MISSING = {
  location: "(c.lat IS NULL OR c.lng IS NULL)",
  phone: "(COALESCE(NULLIF(TRIM(c.phone_norm), ''), NULLIF(TRIM(c.phone), '')) IS NULL)",
  district: "(c.district_id IS NULL)",
} as const;

export async function dataQuality(session: Session, limit = 200): Promise<{ groups: GroupQuality[]; rows: GapRow[]; total: number }> {
  const f = crmFilter(session, "c");
  const raw = await getDb()
    .prepare(
      `SELECT c.id, c.business_name, c.customer_code, g.name AS group_name,
              ${MISSING.location} AS no_location, ${MISSING.phone} AS no_phone, ${MISSING.district} AS no_district
         FROM customers c
         LEFT JOIN groups g ON g.id = c.group_id
        WHERE c.merged_into_id IS NULL AND c.closed_at IS NULL AND c.lifecycle IN ('active', 'dormant')${f.sql}
        ORDER BY c.business_name, c.id`
    )
    .all(...f.params) as unknown as {
    id: number; business_name: string; customer_code: string; group_name: string | null;
    no_location: number; no_phone: number; no_district: number;
  }[];

  const byGroup = new Map<string, GroupQuality>();
  const rows: GapRow[] = [];
  for (const r of raw) {
    const gaps: Gap[] = [];
    if (r.no_location) gaps.push("location");
    if (r.no_phone) gaps.push("phone");
    if (r.no_district) gaps.push("district");
    const key = r.group_name ?? "";
    const g = byGroup.get(key) ?? { group_name: r.group_name, customers: 0, location: 0, phone: 0, district: 0, complete: 0 };
    g.customers += 1;
    for (const gap of gaps) g[gap] += 1;
    if (gaps.length === 0) g.complete += 1;
    byGroup.set(key, g);
    if (gaps.length > 0) rows.push({ id: r.id, business_name: r.business_name, customer_code: r.customer_code, group_name: r.group_name, gaps });
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, complete: g.customers ? g.complete / g.customers : 1 }))
    .sort((a, b) => a.complete - b.complete);
  // Most gaps first: a shop with no location and no phone cannot be reached at all.
  rows.sort((a, b) => b.gaps.length - a.gaps.length);
  return { groups, rows: rows.slice(0, limit), total: rows.length };
}
