import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";

export type AbsenceKind = "leave" | "sick" | "off";
export const ABSENCE_LABEL: Record<AbsenceKind, string> = { leave: "مرخصی", sick: "بیماری", off: "روز استراحت" };
export const isAbsenceKind = (v: unknown): v is AbsenceKind => v === "leave" || v === "sick" || v === "off";
export interface Absence { user_id: number; day: string; kind: AbsenceKind; note: string | null }

export async function absencesBetween(orgId: number, from: string, to: string): Promise<Absence[]> {
  const rows = (await getDb().prepare("SELECT user_id, day, kind, note FROM staff_absences WHERE organization_id = ? AND day BETWEEN ? AND ? ORDER BY day").all(orgId, from, to)) as unknown as Absence[];
  return rows.map((r) => ({ ...r, user_id: Number(r.user_id) }));
}

/** The company's active drivers, for the availability list. */
export async function activeDrivers(orgId: number): Promise<{ id: number; name: string }[]> {
  const rows = (await getDb().prepare("SELECT id, display_name AS name FROM users WHERE organization_id = ? AND role = 'delivery_driver' AND active = 1 ORDER BY display_name").all(orgId)) as unknown as { id: number; name: string }[];
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
}

/** Marks a driver away on a day (replacing an earlier mark for that day). Returns the problem in words, or null once saved. */
export async function markAway(orgId: number, userId: number, day: string, kind: AbsenceKind, note: string | null, by: number): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < tehranTodayIso()) return "روز باید امروز یا بعد از آن باشد";
  const db = getDb();
  const driver = await db.prepare("SELECT 1 FROM users WHERE id = ? AND organization_id = ? AND role = 'delivery_driver' AND active = 1").get(userId, orgId);
  if (!driver) return "راننده پیدا نشد";
  await db
    .prepare(
      `INSERT INTO staff_absences (organization_id, user_id, day, kind, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, user_id, day) DO UPDATE SET kind = EXCLUDED.kind, note = EXCLUDED.note, created_by = EXCLUDED.created_by`
    )
    .run(orgId, userId, day, kind, note?.trim().slice(0, 100) || null, by, new Date().toISOString());
  return null;
}

export async function clearAway(orgId: number, userId: number, day: string): Promise<void> {
  await getDb().prepare("DELETE FROM staff_absences WHERE organization_id = ? AND user_id = ? AND day = ?").run(orgId, userId, day);
}
