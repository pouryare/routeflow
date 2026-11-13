import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { ChequeError } from "@/lib/repo/cheques";
import { depositCheques } from "@/lib/repo/depositSlips";

/** D2: { ids } deposits the cheques under one numbered slip and answers with the slip id. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { ids?: unknown; bankAccountId?: unknown } | null;
  if (!Array.isArray(b?.ids) || !b.ids.every((i) => Number.isSafeInteger(i) && i > 0)) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const bank = b?.bankAccountId ?? null;
  if (bank !== null && !(Number.isSafeInteger(bank) && (bank as number) > 0)) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  try {
    const slip = await depositCheques(guard.session.organizationId, b.ids as number[], guard.session.user.id, bank as number | null);
    return NextResponse.json({ ok: true, slip });
  } catch (e) {
    if (e instanceof ChequeError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
