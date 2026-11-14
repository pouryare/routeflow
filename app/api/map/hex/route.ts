import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { HEX_RES_DEFAULT, isHexRes } from "@/lib/h3";
import { hexCells, isHexMetric } from "@/lib/repo/hexMap";

const DAYS = [30, 90, 180];

/** The honeycomb numbers for the map: GET ?metric=revenue|customers|leads&res=7|8&days=30|90|180. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const q = new URL(req.url).searchParams;
  const metric = q.get("metric") ?? "revenue";
  if (!isHexMetric(metric)) return NextResponse.json({ ok: false, error: "معیار نامعتبر است" }, { status: 400 });
  const res = q.get("res") === null ? HEX_RES_DEFAULT : Number(q.get("res"));
  if (!isHexRes(res)) return NextResponse.json({ ok: false, error: "اندازهٔ سلول نامعتبر است" }, { status: 400 });
  const days = q.get("days") === null ? 90 : Number(q.get("days"));
  if (!DAYS.includes(days)) return NextResponse.json({ ok: false, error: "بازه نامعتبر است" }, { status: 400 });
  return NextResponse.json({ ok: true, metric, res, days, cells: await hexCells(guard.session, metric, res, days) });
}
