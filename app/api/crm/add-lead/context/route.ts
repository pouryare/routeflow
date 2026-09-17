import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { addLeadContext } from "@/lib/repo/crm/businesses";
import { CRM_ROLES } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, ctx: addLeadContext(guard.session) });
}
