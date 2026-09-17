import { getDb } from "@/lib/db";
import { canSeeBusiness, type Session } from "@/lib/session";
import { namesAlike, normPhone } from "@/lib/crm/phone";
import { normInstagram } from "@/lib/crm/social";
import { distanceKm } from "@/lib/geo";

export interface DupMatch {
  kind: "phone" | "instagram" | "name";
  reachable: boolean;
  /** null when the caller cannot see the business -- they learn only that it exists. */
  id: number | null;
  name: string | null;
  area: string | null;
  owner_name: string | null;
  distance_km: number | null;
}

interface Candidate {
  id: number; business_name: string; area_label: string | null; owner_user_id: number | null;
  group_id: number | null; organization_id: number; owner_name: string | null; lat: number | null; lng: number | null;
}
const COLS = `c.id, c.business_name, c.area_label, c.owner_user_id, c.group_id, c.organization_id, c.lat, c.lng, u.display_name AS owner_name`;

/** Searches the whole organisation (so reps cannot duplicate each other) and redacts what
 *  the caller may not see. Phone matches block creation; name matches within 300 m warn. */
export function findDuplicates(session: Session, q: { phone?: string | null; instagram?: string | null; name?: string | null; lat?: number | null; lng?: number | null }): DupMatch[] {
  const db = getDb();
  const out: DupMatch[] = [];
  const seen = new Set<number>();
  const push = (kind: DupMatch["kind"], c: Candidate, distance: number | null) => {
    if (seen.has(c.id)) return;
    seen.add(c.id);
    const reachable = canSeeBusiness(session, c);
    out.push({ kind, reachable, id: reachable ? c.id : null, name: reachable ? c.business_name : null, area: c.area_label, owner_name: c.owner_name, distance_km: distance });
  };

  const phone = normPhone(q.phone);
  if (phone) {
    const rows = db
      .prepare(`SELECT ${COLS} FROM customers c LEFT JOIN users u ON u.id = c.owner_user_id
                 WHERE c.organization_id = ? AND c.merged_into_id IS NULL
                   AND (c.phone_norm = ? OR c.id IN (SELECT customer_id FROM contacts WHERE organization_id = ? AND phone_norm = ?))`)
      .all(session.organizationId, phone, session.organizationId, phone) as unknown as Candidate[];
    for (const r of rows) push("phone", r, null);
  }

  const ig = normInstagram(q.instagram);
  if (ig) {
    const rows = db
      .prepare(`SELECT ${COLS} FROM customers c LEFT JOIN users u ON u.id = c.owner_user_id
                 WHERE c.organization_id = ? AND c.merged_into_id IS NULL AND c.instagram = ?`)
      .all(session.organizationId, ig) as unknown as Candidate[];
    for (const r of rows) push("instagram", r, null);
  }

  if (q.name && typeof q.lat === "number" && typeof q.lng === "number") {
    const rows = db
      .prepare(`SELECT ${COLS} FROM customers c LEFT JOIN users u ON u.id = c.owner_user_id
                 WHERE c.organization_id = ? AND c.merged_into_id IS NULL
                   AND c.lat BETWEEN ? AND ? AND c.lng BETWEEN ? AND ?`)
      .all(session.organizationId, q.lat - 0.004, q.lat + 0.004, q.lng - 0.005, q.lng + 0.005) as unknown as Candidate[];
    for (const r of rows) {
      if (r.lat === null || r.lng === null || !namesAlike(q.name, r.business_name)) continue;
      const d = distanceKm({ lat: q.lat, lng: q.lng }, { lat: r.lat, lng: r.lng });
      if (d <= 0.3) push("name", r, Math.round(d * 100) / 100);
    }
  }
  return out;
}
