import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ACCOUNTING_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { reconcileView, saveReconcile } from "@/lib/repo/reconcile";

const CODE = /^11\d\d$/;

/** A3: the open lines of one account: ?account=1101. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, ACCOUNTING_ROLES);
  if (!guard.ok) return guard.response;
  const code = req.nextUrl.searchParams.get("account") ?? "";
  if (!CODE.test(code)) return NextResponse.json({ ok: false, error: "حساب نامعتبر است" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, view: await reconcileView(guard.session.organizationId, code) });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}

/** A3: { account, counted, ids } locks the ticked lines when the counted balance matches them. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ACCOUNTING_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { account?: unknown; counted?: unknown; ids?: unknown } | null;
  if (typeof b?.account !== "string" || !CODE.test(b.account) || typeof b.counted !== "number" || !Number.isSafeInteger(b.counted) || !Array.isArray(b.ids) || !b.ids.every((i) => Number.isSafeInteger(i) && i > 0) || b.ids.length > 500) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  try {
    await saveReconcile(guard.session.organizationId, b.account, b.counted, b.ids as number[], guard.session.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
