import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { requestReassign } from "@/lib/repo/crm/write";
import { CRM_ROLES, crmErrorResponse } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { phone?: string } | null;
  try {
    requestReassign(guard.session, b?.phone ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
