import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { duplicatePairs, markSeparate, mergeBusinesses, DuplicateError } from "@/lib/repo/crm/duplicates";

/* Managers only: merging folds one customer's orders, payments and history into another's. Each side
   is still checked against what the caller may see. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, pairs: duplicatePairs(guard.session) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { action?: string; keep_id?: number; drop_id?: number; a_id?: number; b_id?: number } | null;
  try {
    if (body?.action === "merge" && Number.isInteger(body.keep_id) && Number.isInteger(body.drop_id)) {
      mergeBusinesses(guard.session, body.keep_id as number, body.drop_id as number);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "separate" && Number.isInteger(body.a_id) && Number.isInteger(body.b_id)) {
      markSeparate(guard.session, body.a_id as number, body.b_id as number);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  } catch (e) {
    if (e instanceof DuplicateError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
