import { NextRequest, NextResponse } from "next/server";
import { importCustomersFromWorkbook } from "@/lib/importExcel";
import { getDb } from "@/lib/db";
import { recomputeCustomerGroups } from "@/lib/groups";
import { requireRole } from "@/lib/session";

// Owner only: an import rewrites customer rows across the whole province, so it is not
// something a single group's manager can set off.
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "فایلی انتخاب نشده است" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ ok: false, error: "فقط فایل .xlsx پذیرفته می‌شود" }, { status: 400 });
  }

  const dryRun = formData?.get("dryRun") === "1";
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importCustomersFromWorkbook(buffer, file.name, { dryRun });

  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  // A freshly imported customer has group_id NULL until territory is applied, which makes
  // it invisible to every group manager. Recompute before anyone can notice.
  if (!dryRun) recomputeCustomerGroups(getDb());
  return NextResponse.json(result);
}
