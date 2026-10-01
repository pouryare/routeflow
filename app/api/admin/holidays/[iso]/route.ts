import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { deleteHoliday, isRealIsoDate } from "@/lib/repo/holidays";

/** Removing an override.
 *
 *  Deletes mean "stop overriding", not "erase the holiday": a deleted override falls back to
 *  the generated row in lib/holidays.ts. Only a date nothing generates — every lunar one —
 *  actually disappears. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ iso: string }> }) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { iso } = await ctx.params;
  // Validated before it reaches the DELETE, so a traversal-shaped param cannot become a
  // query. `isRealIsoDate` also rejects 2026-02-30.
  if (!isRealIsoDate(iso)) {
    return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
  }
  deleteHoliday(iso);
  return NextResponse.json({ ok: true });
}