import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import {
  upsertHoliday,
  listStoredHolidays,
  hasArabicScript,
  isRealIsoDate,
} from "@/lib/repo/holidays";

/** Owner-only, like every other administrative write here.
 *
 *  A holiday is not per-tenant — the table has no organization_id, see `lib/db.ts` — but
 *  RECORDING one is an owner act. The lunar dates are lunar, so somebody has to confirm the
 *  sighting each year, and that somebody should not be whoever is driving. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, holidays: listStoredHolidays() });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const iso = typeof body?.iso === "string" ? body.iso.trim() : "";
  const title = typeof body?.title_fa === "string" ? body.title_fa.trim() : "";
  const kind = body?.kind === "commemorative" ? "commemorative" : "official";

  // Shape AND validity: "2026-13-01" and "2026-02-30" match the pattern and are not dates.
  if (!isRealIsoDate(iso)) {
    return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "عنوان الزامی است" }, { status: 400 });
  }
  // This title is rendered on a calendar grid. An Arabic yeh or a presentation-form yeh is
  // invisible in the UI and unsearchable, and the app's own audit-copy bans both — so the
  // door refuses rather than the audit filing it a month later.
  if (hasArabicScript(title)) {
    return NextResponse.json(
      { ok: false, error: "عنوان باید با حروف فارسی نوشته شود" },
      { status: 400 },
    );
  }

  upsertHoliday({ iso, title_fa: title, kind, lunar: true });
  return NextResponse.json({ ok: true });
}