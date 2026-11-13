import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { setInvoiceSettings } from "@/lib/repo/invoice";

/** D7: the owner sets the company's tax code and default VAT rate { taxId, vatDefaultPct }. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const refused = await setInvoiceSettings(guard.session.organizationId, ((await req.json().catch(() => null)) ?? {}) as object);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
