import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  demandBoard,
  forecastDemand,
  type ForecastEntityType,
  type ForecastMetric,
} from "@/lib/repo/forecast";
import { MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

const ENTITY_TYPES: ForecastEntityType[] = ["org", "group", "product"];
const METRICS: ForecastMetric[] = ["demand_base_units", "demand_toman"];

/** No args → the whole materialised board. With `entity`/`id`/`metric` → a fresh
 *  forecast for that one series. Manager tool. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const entity = sp.get("entity") as ForecastEntityType | null;
  if (!entity) {
    return NextResponse.json({ ok: true, board: demandBoard(guard.session.organizationId) });
  }
  if (!ENTITY_TYPES.includes(entity)) {
    return NextResponse.json({ ok: false, error: "نوع پیش‌بینی نامعتبر است" }, { status: 400 });
  }
  const metric = (sp.get("metric") ?? "demand_toman") as ForecastMetric;
  if (!METRICS.includes(metric)) {
    return NextResponse.json({ ok: false, error: "معیار پیش‌بینی نامعتبر است" }, { status: 400 });
  }
  const id = entity === "org" ? 0 : Number(sp.get("id") ?? 0);
  const horizon = Math.max(1, Math.min(12, Number(sp.get("horizon") ?? 3)));

  return NextResponse.json({
    ok: true,
    entity,
    id,
    metric,
    points: forecastDemand(guard.session.organizationId, { type: entity, id }, metric, horizon),
  });
}
