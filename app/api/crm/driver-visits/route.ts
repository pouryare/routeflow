import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { driverVisitsFor } from "@/lib/repo/crm/driverVisits";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, visits: driverVisitsFor(guard.session) });
}
