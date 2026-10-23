import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { findDuplicates } from "@/lib/repo/crm/dedupe";
import { CRM_ROLES } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const num = (k: string) => (sp.get(k) !== null && Number.isFinite(Number(sp.get(k))) ? Number(sp.get(k)) : null);
  return NextResponse.json({ ok: true, matches: await findDuplicates(guard.session, { phone: sp.get("phone"), instagram: sp.get("instagram"), name: sp.get("name"), lat: num("lat"), lng: num("lng") }) });
}
