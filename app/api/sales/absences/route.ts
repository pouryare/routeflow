import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { clearAway, isAbsenceKind, markAway } from "@/lib/repo/absences";

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

/** F25: { user_id, day, kind, note? } marks a driver away on a day; DELETE { user_id, day } takes the mark off. Managers only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { user_id?: unknown; day?: unknown; kind?: unknown; note?: unknown } | null;
  if (typeof b?.user_id !== "number" || typeof b.day !== "string" || !isAbsenceKind(b.kind)) return bad("درخواست نامعتبر است");
  const refused = await markAway(guard.session.organizationId, b.user_id, b.day, b.kind, typeof b.note === "string" ? b.note : null, guard.session.user.id);
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { user_id?: unknown; day?: unknown } | null;
  if (typeof b?.user_id !== "number" || typeof b.day !== "string") return bad("درخواست نامعتبر است");
  await clearAway(guard.session.organizationId, b.user_id, b.day);
  return NextResponse.json({ ok: true });
}
