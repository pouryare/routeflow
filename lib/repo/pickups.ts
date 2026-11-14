import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";

export interface PickupChoices {
  runs: { id: number; run_date: string; driver: string }[];
  places: { id: number; name: string }[];
  orders: { id: number; label: string }[];
}

/** F118: what a manager picks from when sending a driver to collect goods: the coming runs, the places, and the open purchase orders. */
export async function pickupChoices(orgId: number): Promise<PickupChoices> {
  const db = getDb();
  const runs = (await db.prepare("SELECT r.id, r.run_date, u.display_name AS driver FROM delivery_runs r JOIN users u ON u.id = r.driver_user_id WHERE r.organization_id = ? AND r.run_date >= ? AND r.status <> 'done' ORDER BY r.run_date, r.id LIMIT 20").all(orgId, tehranTodayIso())) as unknown as PickupChoices["runs"];
  const places = (await db.prepare("SELECT id, name FROM facilities WHERE organization_id = ? AND kind IN ('factory', 'warehouse', 'cold_storage', 'shop', 'other') ORDER BY name").all(orgId)) as unknown as PickupChoices["places"];
  const orders = (await db.prepare("SELECT po.id, s.name AS label FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.organization_id = ? AND po.status IN ('ordered', 'partly_received') ORDER BY po.id DESC LIMIT 20").all(orgId)) as unknown as PickupChoices["orders"];
  return { runs: runs.map((r) => ({ ...r, id: Number(r.id) })), places: places.map((p) => ({ ...p, id: Number(p.id) })), orders: orders.map((o) => ({ ...o, id: Number(o.id) })) };
}

/** Adds a pickup stop to a run that is not finished. Returns the problem in words, or null once added. */
export async function addPickup(orgId: number, runId: number, facilityId: number, purchaseOrderId: number | null): Promise<string | null> {
  const db = getDb();
  const run = (await db.prepare("SELECT status FROM delivery_runs WHERE id = ? AND organization_id = ?").get(runId, orgId)) as { status: string } | undefined;
  if (!run) return "مسیر پیدا نشد";
  if (run.status === "done") return "این مسیر تمام شده است";
  if (!(await db.prepare("SELECT 1 FROM facilities WHERE id = ? AND organization_id = ?").get(facilityId, orgId))) return "مکان پیدا نشد";
  if (purchaseOrderId !== null && !(await db.prepare("SELECT 1 FROM purchase_orders WHERE id = ? AND organization_id = ?").get(purchaseOrderId, orgId))) return "سفارش خرید پیدا نشد";
  if (await db.prepare("SELECT 1 FROM run_facility_stops WHERE run_id = ? AND role = 'pickup' AND facility_id = ?").get(runId, facilityId)) return "این مکان روی همین مسیر هست";
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO run_facility_stops (run_id, facility_id, role, status, purchase_order_id, created_at, updated_at) VALUES (?, ?, 'pickup', 'pending', ?, ?, ?)").run(runId, facilityId, purchaseOrderId, now, now);
  return null;
}

/** The driver ticks «کالا را گرفتم» on a pickup of their own run. Receiving the goods into stock stays the existing receive step. */
export async function markCollected(orgId: number, driverId: number, stopId: number): Promise<string | null> {
  const db = getDb();
  const now = new Date().toISOString();
  const r = await db.prepare(
    `UPDATE run_facility_stops SET status = 'done', done_at = ?, done_by = ?, updated_at = ?
      WHERE id = ? AND role = 'pickup' AND status = 'pending'
        AND run_id IN (SELECT id FROM delivery_runs WHERE driver_user_id = ? AND organization_id = ?)`
  ).run(now, driverId, now, stopId, driverId, orgId);
  return Number(r.changes ?? 0) > 0 ? null : "توقف پیدا نشد";
}
