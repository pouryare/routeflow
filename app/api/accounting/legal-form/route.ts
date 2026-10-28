import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { setLegalFormIn } from "@/lib/repo/routeAdapters";

/** Registered (reserve and approval before a split) or unregistered (split straight from the agreement). */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { legal_form?: unknown } | null;
  try {
    await setLegalFormIn(guard.session.organizationId, body?.legal_form as "registered" | "unregistered");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
