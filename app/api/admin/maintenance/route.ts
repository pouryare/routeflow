import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { checkMaintenance } from "@/lib/maintenance";
import { setMaintenance } from "@/lib/repo/maintenance";

/** T17: the owner sets (or clears) the maintenance window everyone sees as a banner. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown; note?: unknown; clear?: unknown } | null;
  if (body?.clear === true) {
    await setMaintenance(guard.session.organizationId, null);
    return NextResponse.json({ ok: true });
  }
  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to : "";
  const refusal = checkMaintenance(from, to);
  if (refusal) return NextResponse.json({ ok: false, error: refusal }, { status: 400 });
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  await setMaintenance(guard.session.organizationId, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), note });
  return NextResponse.json({ ok: true });
}
