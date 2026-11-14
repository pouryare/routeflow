import { getDb } from "@/lib/db";
import { dayKm } from "@/lib/mileage";

export interface MileageDay { day: string; visits: number; km: number }
export interface MileagePerson { user_id: number; name: string; visits: number; km: number }

type Visit = { user_id: number; name: string; at: string; lat: number; lng: number };

/** Visits with a known shop location, oldest first, between two Tehran days (inclusive). */
async function visitsBetween(orgId: number, from: string, to: string, userId?: number, groupId?: number | null): Promise<Visit[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT a.user_id, u.display_name AS name, a.occurred_at AS at, c.lat, c.lng
         FROM activities a JOIN customers c ON c.id = a.customer_id JOIN users u ON u.id = a.user_id
        WHERE a.organization_id = ? AND a.type = 'visit' AND c.lat IS NOT NULL AND c.lng IS NOT NULL
          AND substr(a.occurred_at, 1, 10) BETWEEN ? AND ? AND (?::bigint IS NULL OR a.user_id = ?) AND (?::bigint IS NULL OR u.group_id = ?)
        ORDER BY a.user_id, a.occurred_at, a.id`,
    )
    .all(orgId, from, to, userId ?? null, userId ?? null, groupId ?? null, groupId ?? null)) as unknown as Visit[];
  return rows.map((r) => ({ ...r, user_id: Number(r.user_id), lat: Number(r.lat), lng: Number(r.lng) }));
}

const dayOf = (at: string) => at.slice(0, 10);

/** One person's days in a range: how many visits and the estimated km between them. */
export async function myMileage(orgId: number, userId: number, from: string, to: string): Promise<MileageDay[]> {
  const byDay = new Map<string, Visit[]>();
  for (const v of await visitsBetween(orgId, from, to, userId)) (byDay.get(dayOf(v.at)) ?? byDay.set(dayOf(v.at), []).get(dayOf(v.at))!).push(v);
  return [...byDay.entries()].map(([day, vs]) => ({ day, visits: vs.length, km: dayKm(vs) })).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** Everyone's total in a range (a manager's view); a group manager passes their group. */
export async function teamMileage(orgId: number, from: string, to: string, groupId?: number | null): Promise<MileagePerson[]> {
  const by = new Map<string, Visit[]>();
  for (const v of await visitsBetween(orgId, from, to, undefined, groupId)) {
    const k = `${v.user_id}|${dayOf(v.at)}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(v);
  }
  const people = new Map<number, MileagePerson>();
  for (const vs of by.values()) {
    const p = people.get(vs[0].user_id) ?? people.set(vs[0].user_id, { user_id: vs[0].user_id, name: vs[0].name, visits: 0, km: 0 }).get(vs[0].user_id)!;
    p.visits += vs.length;
    p.km = Math.round((p.km + dayKm(vs)) * 10) / 10;
  }
  return [...people.values()].sort((a, b) => b.km - a.km);
}
