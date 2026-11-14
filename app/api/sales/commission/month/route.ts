import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { toCsv } from "@/lib/csv";
import { payrollCsvRows, payrollSheet } from "@/lib/repo/payrollSheet";

/** F90: the month's pay sheet as a CSV for the accountant. Owner only: ?y=1405&m=8 (Jalali). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const jy = Number(req.nextUrl.searchParams.get("y")), jm = Number(req.nextUrl.searchParams.get("m"));
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || jm < 1 || jm > 12 || jy < 1380 || jy > 1500) return NextResponse.json({ ok: false, error: "ماه نامعتبر است" }, { status: 400 });
  const csv = toCsv(payrollCsvRows(await payrollSheet(guard.session, jy, jm)));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pay-${jy}-${String(jm).padStart(2, "0")}.csv"` } });
}
