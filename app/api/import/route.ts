import { NextRequest, NextResponse } from "next/server";
import { importCustomersFromWorkbook } from "@/lib/importExcel";

export async function POST(req: NextRequest) {
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
  return NextResponse.json(result);
}
