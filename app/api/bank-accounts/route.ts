import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { ChequeError } from "@/lib/repo/cheques";
import { addBankAccount, bankAccountsFor } from "@/lib/repo/bankAccounts";

/** D2: the company's bank accounts (managers read and add). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, accounts: await bankAccountsFor(guard.session.organizationId) });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
  if (typeof b?.name !== "string") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  try {
    const id = await addBankAccount(guard.session.organizationId, b.name, guard.session.user.id);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof ChequeError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
