import type { Db } from "@/lib/database/client";
import { getDb } from "@/lib/db";
import { makeRepo } from "./base";
import { inOrg } from "./orgRefs";
import { boundedText, isQuantity } from "@/lib/inputChecks";
import { defaultFacilityId } from "./stock";
import { addStop } from "@/lib/delivery";
import { markReady } from "./deliveries";
import { haversineMatrix, durationMatrixFromKm } from "@/lib/routing/matrix";
import { fetchOsrmTable } from "@/lib/routing/osrmMatrix";
import {
  buildVroomJob,
  solveVroom,
  greedyAssign,
  type RoutableDelivery,
  type RoutableVehicle,
  type SolveResult,
} from "@/lib/routing/vroom";
import type { LatLng } from "@/lib/geo";
import { effectiveCapacity } from "@/lib/routing/capacity";
import { runWeatherAdjustment } from "./weather";
import type { WeatherAdjustment } from "@/lib/weather/capacityAdjust";
import { isUniqueViolation } from "@/lib/database/errors";

export class RoutingError extends Error {}

export interface VehicleRow {
  id: number;
  organization_id: number;
  plate: string | null;
  name: string;
  driver_default_id: number | null;
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  max_stops: number | null;
  has_refrigeration: number;
  cost_per_km_toman: number;
  active: number;
  created_at: string;
  updated_at: string;
}
export interface RouteTemplateRow {
  id: number;
  organization_id: number;
  code: string;
  name: string;
  territory_id: number | null;
  default_driver_id: number | null;
  default_vehicle_id: number | null;
  max_stops: number | null;
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  max_duration_min: number | null;
  service_time_min: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export const vehiclesRepo = makeRepo<VehicleRow>("vehicles", { tenant: true });
export const routeTemplatesRepo = makeRepo<RouteTemplateRow>("route_templates", { tenant: true });

export async function listVehicles(organizationId: number, activeOnly = true): Promise<VehicleRow[]> {
  return await vehiclesRepo
    .db()
    .prepare(
      `SELECT * FROM vehicles WHERE organization_id = ?${activeOnly ? " AND active = 1" : ""} ORDER BY name`
    )
    .all(organizationId) as unknown as VehicleRow[];
}

export async function createVehicle(
  organizationId: number,
  input: {
    name: string;
    plate?: string | null;
    driver_default_id?: number | null;
    max_weight_kg?: number | null;
    max_volume_m3?: number | null;
    max_stops?: number | null;
    has_refrigeration?: boolean;
    cost_per_km_toman?: number;
  }
): Promise<number> {
  if (typeof input.name !== "string" || !input.name.trim()) throw new RoutingError("نام خودرو لازم است");
  if (boundedText(input.name, 100) === null) throw new RoutingError("نام خودرو خیلی بلند است");
  if (input.plate != null && boundedText(input.plate, 30) === null) throw new RoutingError("پلاک نامعتبر است");
  for (const n of [input.max_weight_kg, input.max_volume_m3, input.max_stops, input.cost_per_km_toman]) {
    if (n != null && (!isQuantity(n, 1e9) || n < 0)) throw new RoutingError("مقدار عددی خودرو نامعتبر است");
  }
  if (input.driver_default_id != null && !await inOrg("users", input.driver_default_id, organizationId)) {
    throw new RoutingError("راننده پیدا نشد");
  }
  const now = new Date().toISOString();
  try {
    return await vehiclesRepo.insert(organizationId, {
      organization_id: organizationId,
      plate: input.plate ?? null,
      name: input.name.trim(),
      driver_default_id: input.driver_default_id ?? null,
      max_weight_kg: input.max_weight_kg ?? null,
      max_volume_m3: input.max_volume_m3 ?? null,
      max_stops: input.max_stops ?? null,
      has_refrigeration: input.has_refrigeration ? 1 : 0,
      cost_per_km_toman: input.cost_per_km_toman ?? 0,
      active: 1,
      created_at: now,
      updated_at: now,
    } as Omit<VehicleRow, "id">);
  } catch (e) {
    if (isUniqueViolation(e)) throw new RoutingError("پلاک تکراری است");
    throw e;
  }
}

export async function listRouteTemplates(organizationId: number): Promise<RouteTemplateRow[]> {
  return await routeTemplatesRepo
    .db()
    .prepare("SELECT * FROM route_templates WHERE organization_id = ? ORDER BY code")
    .all(organizationId) as unknown as RouteTemplateRow[];
}

export async function createRouteTemplate(
  organizationId: number,
  input: {
    code: string;
    name: string;
    territory_id?: number | null;
    default_driver_id?: number | null;
    default_vehicle_id?: number | null;
    max_stops?: number | null;
    max_weight_kg?: number | null;
    max_volume_m3?: number | null;
    max_duration_min?: number | null;
    service_time_min?: number;
  }
): Promise<number> {
  if (!input.code?.trim() || !input.name?.trim()) throw new RoutingError("کد و نام لازم است");
  const now = new Date().toISOString();
  try {
    return await routeTemplatesRepo.insert(organizationId, {
      organization_id: organizationId,
      code: input.code.trim(),
      name: input.name.trim(),
      territory_id: input.territory_id ?? null,
      default_driver_id: input.default_driver_id ?? null,
      default_vehicle_id: input.default_vehicle_id ?? null,
      max_stops: input.max_stops ?? null,
      max_weight_kg: input.max_weight_kg ?? null,
      max_volume_m3: input.max_volume_m3 ?? null,
      max_duration_min: input.max_duration_min ?? null,
      service_time_min: input.service_time_min ?? 8,
      active: 1,
      created_at: now,
      updated_at: now,
    } as Omit<RouteTemplateRow, "id">);
  } catch (e) {
    if (isUniqueViolation(e)) throw new RoutingError("کد قالب تکراری است");
    throw e;
  }
}

export async function templateScheduleFor(
  organizationId: number,
  templateId: number,
  dayOfWeek: number
): Promise<{ start_time: string | null; end_time: string | null; cutoff_time: string | null } | undefined> {
  return await getDb()
    .prepare(
      `SELECT start_time, end_time, cutoff_time FROM route_schedules
        WHERE organization_id = ? AND route_template_id = ? AND day_of_week = ? AND active = 1`
    )
    .get(organizationId, templateId, dayOfWeek) as
    | { start_time: string | null; end_time: string | null; cutoff_time: string | null }
    | undefined;
}

/** Every PLANNED delivery whose order is on `date` and confirmed-or-planned, with the
 *  customer's location and the order's kg / m³ load. */
export async function routableDeliveriesFor(
  organizationId: number,
  opts: { date: string; group_id?: number | null; service_min?: number }
): Promise<RoutableDelivery[]> {
  const params: unknown[] = [organizationId, opts.date];
  let groupClause = "";
  if (opts.group_id != null) {
    groupClause = " AND o.group_id = ?";
    params.push(opts.group_id);
  }
  const rows = await getDb()
    .prepare(
      `SELECT d.id AS delivery_id, c.lat, c.lng, o.priority,
              COALESCE(SUM(ol.packs_ordered * ol.qty_per_pack * ol.kg_per_base_unit), 0) AS kg,
              COALESCE(SUM(ol.packs_ordered * ol.qty_per_pack * COALESCE(p.volume_m3_per_base_unit, 0)), 0) AS m3
         FROM deliveries d
         JOIN orders o ON o.id = d.order_id
         JOIN customers c ON c.id = o.customer_id
         LEFT JOIN order_lines ol ON ol.order_id = o.id
         LEFT JOIN products p ON p.id = ol.product_id
        WHERE d.organization_id = ? AND d.status = 'PLANNED'
          AND o.order_date = ? AND o.status IN ('CONFIRMED', 'PLANNED')
          AND c.lat IS NOT NULL AND c.lng IS NOT NULL${groupClause}
        GROUP BY d.id, o.id, c.id`
    )
    .all(...(params as never[])) as unknown as {
    delivery_id: number;
    lat: number;
    lng: number;
    priority: string | null;
    kg: number;
    m3: number;
  }[];

  const PRIORITY: Record<string, number> = { URGENT: 100, KEY_ACCOUNT: 60, NORMAL: 10, FLEXIBLE: 1 };
  return rows.map((r) => ({
    delivery_id: r.delivery_id,
    lat: r.lat,
    lng: r.lng,
    weight_kg: r.kg,
    volume_m3: r.m3,
    service_min: opts.service_min ?? 8,
    priority: PRIORITY[r.priority ?? "NORMAL"] ?? 10,
  }));
}

export interface RoutingPlan extends SolveResult {
  source: "vroom" | "greedy";
  date: string;
  weather?: WeatherAdjustment & { effective_max_stops: number; base_stops: number };
}

/** Build a delivery-route proposal for a date. Read-only -- proposes, never writes. Uses
 *  OSRM for the matrix and VROOM for the solve; falls back to a haversine matrix and a
 *  nearest-neighbour + 2-opt greedy assign when either is unreachable. */
export async function buildPlan(
  organizationId: number,
  opts: { date: string; group_id?: number | null; template_id?: number | null }
): Promise<RoutingPlan> {
  const template =
    opts.template_id != null
      ? await routeTemplatesRepo.get(organizationId, opts.template_id)
      : undefined;
  const deliveries = await routableDeliveriesFor(organizationId, {
    date: opts.date,
    group_id: opts.group_id,
    service_min: template?.service_time_min,
  });
  if (deliveries.length === 0) {
    return { assignments: [], unassigned: [], source: "greedy", date: opts.date };
  }

  const facilityId = await defaultFacilityId(organizationId);
  const facility = await getDb()
    .prepare("SELECT lat, lng FROM facilities WHERE id = ?")
    .get(facilityId) as { lat: number; lng: number };
  const depot: LatLng = { lat: facility.lat, lng: facility.lng };

  const allVehicles = template?.default_vehicle_id
    ? [await vehiclesRepo.get(organizationId, template.default_vehicle_id)].filter(Boolean)
    : await listVehicles(organizationId);
  const vehicleRows: VehicleRow[] =
    allVehicles.length > 0
      ? (allVehicles as VehicleRow[])
      : [
          {
            id: -1,
            max_weight_kg: null,
            max_volume_m3: null,
            max_stops: template?.max_stops ?? 40,
            has_refrigeration: 0,
          } as VehicleRow,
        ];

  // Phase 6: weather at the group centroid on the plan date shrinks the effective stop
  // ceiling. The forecast is resolved here and frozen into the run at commit time.
  const cx = deliveries.reduce((s, d) => s + d.lat, 0) / deliveries.length;
  const cy = deliveries.reduce((s, d) => s + d.lng, 0) / deliveries.length;
  const anyRefrigerated = vehicleRows.some((v) => v.has_refrigeration === 1);
  const adj = await runWeatherAdjustment(organizationId, {
    lat: cx,
    lng: cy,
    date: opts.date,
    vehicle_has_refrigeration: anyRefrigerated,
  });
  const baseStops = template?.max_stops ?? 40;
  const effectiveMaxStops = effectiveCapacity({
    base_stops: baseStops,
    base_service_min: template?.service_time_min ?? 8,
    base_duration_min: template?.max_duration_min ?? 480,
    factors: adj.factors,
  }).max_stops;

  const vehicles: RoutableVehicle[] = vehicleRows.map((v) => ({
    vehicle_key: v.id,
    start: depot,
    end: depot,
    capacity: [
      Math.round(v.max_weight_kg ?? template?.max_weight_kg ?? 5000),
      Math.round((v.max_volume_m3 ?? template?.max_volume_m3 ?? 50) * 100),
      Math.min(v.max_stops ?? template?.max_stops ?? 40, effectiveMaxStops),
    ],
    max_duration_s: template?.max_duration_min ? template.max_duration_min * 60 : undefined,
    has_refrigeration: v.has_refrigeration === 1,
  }));

  const weather = { ...adj, effective_max_stops: effectiveMaxStops, base_stops: baseStops };

  const points: LatLng[] = [depot, ...deliveries.map((d) => ({ lat: d.lat, lng: d.lng }))];
  const osrm = await fetchOsrmTable(points).catch(() => null);
  const durations = osrm?.durations_s ?? durationMatrixFromKm(haversineMatrix(points));
  const distances = osrm?.distances_km;

  const vroom = await solveVroom(
    buildVroomJob(deliveries, vehicles, { durations, distances })
  ).catch(() => null);

  if (vroom) return { ...vroom, source: "vroom", date: opts.date, weather };
  return { ...greedyAssign(deliveries, vehicles), source: "greedy", date: opts.date, weather };
}

/** Write a proposal: one delivery_runs row per assigned vehicle+driver, its stops in
 *  order. Idempotent -- a re-commit adds no duplicate stops. */
export async function commitPlan(
  organizationId: number,
  plan: RoutingPlan,
  opts: { planned_by: number }
): Promise<{ run_ids: number[] }> {
  const db = getDb();
  const runIds: number[] = [];
  const now = new Date().toISOString();

  for (const a of plan.assignments) {
    const vehicle = a.vehicle_key > 0 ? await vehiclesRepo.get(organizationId, a.vehicle_key) : undefined;
    const driverId = vehicle?.driver_default_id ?? opts.planned_by;

    let run = await db
      .prepare(
        "SELECT id FROM delivery_runs WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?"
      )
      .get(driverId, plan.date, organizationId) as { id: number } | undefined;
    if (!run) {
      const id = Number(
        (await db
          .prepare(
            `INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, created_at, updated_at, organization_id)
             VALUES (?, ?, 'planned', ?, ?, ?, ?)`
          )
          .run(driverId, plan.date, opts.planned_by, now, now, organizationId)).lastInsertRowid
      );
      run = { id };
    }
    await db.prepare(
      `UPDATE delivery_runs
          SET vehicle_id = ?, planned_distance_km = ?, planned_duration_min = ?,
              capacity_stops = ?, optimisation_json = ?, weather_json = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      vehicle?.id ?? null,
      a.distance_km,
      a.duration_min,
      // the effective ceiling (weather-adjusted) rather than what happened to be assigned
      plan.weather?.effective_max_stops ?? a.stops.length,
      JSON.stringify({ source: plan.source, assignment: a }),
      // Phase 6: the forecast + adjustment, FROZEN at planning time. Never re-fetched.
      plan.weather ? JSON.stringify(plan.weather) : null,
      now,
      run.id
    );

    for (const s of a.stops) {
      const orderId = await db
        .prepare("SELECT order_id FROM deliveries WHERE id = ? AND organization_id = ?")
        .get(s.delivery_id, organizationId) as { order_id: number } | undefined;
      if (!orderId) continue;
      try {
        await addStop(db, run.id, orderId.order_id, s.sort_order);
      } catch (e) {
        // a stop already on this run (idempotent re-commit) or a credit hold -- skip it.
        if (!(isUniqueViolation(e) || (e instanceof Error && /قطعی|اعتبار/.test(e.message)))) throw e;
      }
    }
    runIds.push(run.id);
  }
  return { run_ids: runIds };
}

/** When a day's work is committed, for a run with no template of its own. 17:00 Tehran — late
 *  enough that a working day can be planned, early enough that a driver setting out tomorrow is
 *  not still being added to. */
export const DEFAULT_CUTOFF_TIME = "17:00";

/** Planned runs whose cutoff has passed and that are not yet frozen.
 *
 *  THE JOIN IS A LEFT JOIN, and that is the whole point of this function.
 *
 *  It used to be `JOIN route_schedules rs ON rs.route_template_id = dr.route_template_id`. An
 *  INNER join on a NULL matches nothing — and `createRun` (lib/delivery.ts) and `commitPlan` both
 *  insert runs with NO route_template_id, because they are not built from a template. So every
 *  run the planning board creates was invisible here, always, on every day. "Committed" was a
 *  word with no behaviour behind it: the freeze never fired for the runs the office actually makes.
 *
 *  A run WITH a template still freezes at that template's own cutoff, which is the original
 *  behaviour and must survive. A run WITHOUT one falls back to the organisation default above. */
export async function runsNeedingFreeze(
  organizationId: number,
  asOfIso: string
): Promise<{ id: number; run_date: string; cutoff_time: string }[]> {
  const asOf = new Date(asOfIso);
  const dow = (asOf.getDay() + 1) % 7; // JS Sunday=0 -> our شنبه=0 scheme
  const hhmm = asOf.toISOString().slice(11, 16);
  return await getDb()
    .prepare(
      `SELECT dr.id, dr.run_date,
              COALESCE(rs.cutoff_time, ?) AS cutoff_time
         FROM delivery_runs dr
         LEFT JOIN route_schedules rs
                ON rs.route_template_id = dr.route_template_id
               AND rs.day_of_week = ?
               -- Scoped like every other tenant read in this codebase. The ids are already
               -- globally unique so this changes no result today; it means a schedule row can
               -- never be read across tenants if that assumption is ever broken.
               AND rs.organization_id = dr.organization_id
        WHERE dr.organization_id = ? AND dr.status = 'planned' AND dr.frozen_at IS NULL
          AND COALESCE(rs.cutoff_time, ?) <= ?
          AND dr.run_date = ?`
    )
    // Placeholder order must match the SQL exactly: the SELECT's default, the join's weekday,
    // the org, the WHERE's default again, then the clock and the date.
    .all(DEFAULT_CUTOFF_TIME, dow, organizationId, DEFAULT_CUTOFF_TIME, hhmm, asOf.toISOString().slice(0, 10)) as unknown as {
    id: number;
    run_date: string;
    cutoff_time: string;
  }[];
}

/** Freeze a run: no more stops without an explicit decision, and every order on it moves
 *  to READY. */
export async function freezeRun(
  organizationId: number,
  runId: number,
  actor: { id: number | null; role: "group_manager" | "owner" }
): Promise<void> {
  const db = getDb();
  const run = await db
    .prepare("SELECT id FROM delivery_runs WHERE id = ? AND organization_id = ?")
    .get(runId, organizationId) as { id: number } | undefined;
  if (!run) throw new RoutingError("مسیر پیدا نشد");

  await db.tx(async () => {
    await db.prepare(
      "UPDATE delivery_runs SET frozen_at = ?, status = 'ready', updated_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), new Date().toISOString(), runId);
    const orders = await db
      .prepare("SELECT order_id FROM delivery_stops WHERE run_id = ?")
      .all(runId) as { order_id: number }[];
    for (const o of orders) {
      try {
        await markReady(organizationId, o.order_id, actor, db as Db);
      } catch {
        /* order already past READY -- leave it */
      }
    }
  });
}
