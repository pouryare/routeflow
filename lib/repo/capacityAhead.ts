import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { addDaysIso } from "@/lib/flows/dates";
import { dayLoad, type DayDemand, type DayLoad, type VanLimits } from "@/lib/capacityAhead";
import { listVehicles } from "@/lib/repo/routing";
import { absencesBetween } from "@/lib/repo/absences";

/** F81: the next `days` days (today first), each with the confirmed orders that name that day against the vans that can run. Orders with
 *  no day named are not counted: nobody has said which day they will run. */
export async function capacityAhead(orgId: number, days = 3, today = tehranTodayIso()): Promise<DayLoad[]> {
  const list = Array.from({ length: days }, (_, i) => addDaysIso(today, i));
  const rows = (await getDb()
    .prepare(
      `SELECT o.requested_day AS day, COUNT(DISTINCT o.id) AS stops,
              COALESCE(SUM(ol.packs_ordered * ol.kg_per_base_unit * ol.qty_per_pack), 0) AS kg,
              COALESCE(SUM(ol.packs_ordered * ol.qty_per_pack * p.volume_m3_per_base_unit), 0) AS volume
         FROM orders o JOIN order_lines ol ON ol.order_id = o.id LEFT JOIN products p ON p.id = ol.product_id
        WHERE o.organization_id = ? AND o.status IN ('CONFIRMED', 'PLANNED') AND o.requested_day BETWEEN ? AND ?
        GROUP BY o.requested_day`
    )
    .all(orgId, list[0], list[list.length - 1])) as unknown as { day: string; stops: number; kg: number; volume: number }[];
  const demand = new Map<string, DayDemand>(rows.map((r) => [r.day, { stops: Number(r.stops), weightKg: Number(r.kg), volumeM3: Number(r.volume) }]));
  const vans: VanLimits[] = (await listVehicles(orgId, true)).map((v) => ({
    id: v.id,
    driverId: v.driver_default_id === null ? null : Number(v.driver_default_id),
    maxStops: v.max_stops === null ? null : Number(v.max_stops),
    maxWeightKg: v.max_weight_kg === null ? null : Number(v.max_weight_kg),
    maxVolumeM3: v.max_volume_m3 === null ? null : Number(v.max_volume_m3),
  }));
  const away = await absencesBetween(orgId, list[0], list[list.length - 1]);
  return list.map((day) => dayLoad(day, demand.get(day) ?? { stops: 0, weightKg: 0, volumeM3: 0 }, vans, new Set(away.filter((a) => a.day === day).map((a) => a.user_id))));
}
