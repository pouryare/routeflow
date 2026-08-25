import { NextRequest, NextResponse } from "next/server";
import { importCustomersFromWorkbook } from "@/lib/importExcel";
import { fetchOneDriveFile } from "@/lib/oneDriveFetch";
import { getDb } from "@/lib/db";
import { recomputeCustomerGroups } from "@/lib/groups";
import { requireRole } from "@/lib/session";

// Deliberately reads the share link from server config rather than accepting one in
// the request body -- this endpoint runs a real data import, so letting a client
// supply an arbitrary fetch target would turn it into an SSRF + data-injection vector.
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const shareUrl = process.env.ONEDRIVE_SALES_FILE_URL;
  if (!shareUrl) {
    return NextResponse.json(
      { ok: false, error: "لینک OneDrive در تنظیمات سرور ثبت نشده است." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = (body as { dryRun?: boolean } | null)?.dryRun === true;

  let buffer: Buffer;
  try {
    buffer = await fetchOneDriveFile(shareUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "خطا در دریافت فایل از OneDrive";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const result = await importCustomersFromWorkbook(buffer, "OneDrive: سیستم فروش و انبار.xlsx", { dryRun });
  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  if (!dryRun) recomputeCustomerGroups(getDb());
  return NextResponse.json(result);
}
