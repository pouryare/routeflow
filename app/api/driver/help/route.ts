import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { isHelpKind } from "@/lib/driverHelp";
import { raiseDriverHelp } from "@/lib/repo/driverHelp";

/** «نیاز به کمک»: a driver reports a flat tyre, an accident, a breakdown or something else. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
  if (!isHelpKind(body?.kind)) return NextResponse.json({ ok: false, error: "نوع مشکل نامعتبر است" }, { status: 400 });
  const told = await raiseDriverHelp(guard.session, body.kind);
  if (told === 0) return NextResponse.json({ ok: false, error: "مسیر بازی برای شما ثبت نشده یا مدیری برای اطلاع‌رسانی پیدا نشد؛ با دفتر تماس بگیرید" }, { status: 409 });
  return NextResponse.json({ ok: true, told });
}
