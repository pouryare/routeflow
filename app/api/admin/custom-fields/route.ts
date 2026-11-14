import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { createField } from "@/lib/repo/customFields";

/** F122: the owner adds a customer field { name, kind, choices }. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const refused = await createField(guard.session.organizationId, ((await req.json().catch(() => null)) ?? {}) as object);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
