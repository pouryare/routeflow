import { getDb } from "@/lib/db";
import type { Maintenance } from "@/lib/maintenance";

/** T17: the company's maintenance window, or null when none is set. */
export async function maintenanceFor(organizationId: number): Promise<Maintenance | null> {
  const r = (await getDb()
    .prepare("SELECT maintenance_from, maintenance_to, maintenance_note FROM organizations WHERE id = ?")
    .get(organizationId)) as { maintenance_from: string | null; maintenance_to: string | null; maintenance_note: string | null } | undefined;
  return r?.maintenance_from && r.maintenance_to ? { from: r.maintenance_from, to: r.maintenance_to, note: r.maintenance_note } : null;
}

/** Set the window, or clear it with null. */
export async function setMaintenance(organizationId: number, m: Maintenance | null): Promise<void> {
  await getDb()
    .prepare("UPDATE organizations SET maintenance_from = ?, maintenance_to = ?, maintenance_note = ? WHERE id = ?")
    .run(m?.from ?? null, m?.to ?? null, m?.note ?? null, organizationId);
}
