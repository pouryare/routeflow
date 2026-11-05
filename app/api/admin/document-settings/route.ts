import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { parseDocumentSettings } from "@/lib/documentSettings";
import { setDocumentSettings } from "@/lib/repo/documentSettings";

/** A13: the owner sets the receipt and delivery note footers and the order number prefix. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const parsed = parseDocumentSettings(await req.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ ok: false, error: parsed }, { status: 400 });
  await setDocumentSettings(guard.session.organizationId, parsed);
  return NextResponse.json({ ok: true });
}
