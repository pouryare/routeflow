import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { addProblemReport, ReportError } from "@/lib/repo/problemReports";
import pkg from "@/package.json";

/** S24: any signed-in person sends «گزارش مشکل»: { message, page, connection, screenshot? }. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (!rateLimit(`problem:${session.user.id}`, 10, 60 * 60_000).allowed) {
    return NextResponse.json({ ok: false, error: "گزارش‌های زیادی فرستادید؛ کمی بعد دوباره امتحان کنید" }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { message?: unknown; page?: unknown; connection?: unknown; screenshot?: unknown } | null;
  try {
    await addProblemReport(session, { ...body, message: body?.message, userAgent: req.headers.get("user-agent"), appVersion: pkg.version });
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
