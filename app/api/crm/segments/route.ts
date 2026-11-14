import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { CRM_ROLES } from "@/lib/repo/crm/http";
import { deleteSegment, listSegments, saveSegment } from "@/lib/repo/customerSegments";

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, segments: await listSegments(guard.session.organizationId) });
}

/** FB36: { name, spec } saves a customer filter for the company; { id } in DELETE removes one. Managers only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { name?: unknown; spec?: unknown } | null;
  if (typeof b?.name !== "string") return bad("درخواست نامعتبر است");
  const refused = await saveSegment(guard.session.organizationId, guard.session.user.id, b.name, b.spec);
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof b?.id !== "number") return bad("درخواست نامعتبر است");
  await deleteSegment(guard.session.organizationId, b.id);
  return NextResponse.json({ ok: true });
}
