import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  customerHealthFor,
  customersHealthOverview,
  salespersonScoreFor,
  driverScoreFor,
} from "@/lib/repo/health";
import { currentPeriod } from "@/lib/analysis/period";
import { MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

type Scope = "customer" | "phone_sales" | "driver";

/** Health scores. `?scope=customer` (default) returns the group-scoped overview;
 *  `?scope=customer&id=88` returns one; salesperson / driver scope need an id. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "rep_manager"]);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const scope = (sp.get("scope") ?? "customer") as Scope;
  const idParam = sp.get("id");
  const id = idParam ? Number(idParam) : null;
  const org = guard.session.organizationId;
  const period = sp.get("period") ?? currentPeriod();

  if (scope === "customer") {
    if (id) return NextResponse.json({ ok: true, scope, id, health: await customerHealthFor(org, id) });
    return NextResponse.json({ ok: true, scope, rows: await customersHealthOverview(guard.session) });
  }
  if (!id) {
    return NextResponse.json({ ok: false, error: "محدوده مشخص نشده است" }, { status: 400 });
  }
  if (scope === "phone_sales") {
    return NextResponse.json({ ok: true, scope, id, health: await salespersonScoreFor(org, id, period) });
  }
  if (scope === "driver") {
    return NextResponse.json({ ok: true, scope, id, health: await driverScoreFor(org, id, period) });
  }
  return NextResponse.json({ ok: false, error: "محدودهٔ نامعتبر" }, { status: 400 });
}
