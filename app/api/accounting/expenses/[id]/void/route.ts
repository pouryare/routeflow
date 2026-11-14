import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ACCOUNTING_ROLES, type Role } from "@/lib/roles";
import { voidExpense, LedgerError } from "@/lib/repo/ledgerPostings";
import { isId } from "@/lib/inputChecks";

const ROLES: Role[] = [...ACCOUNTING_ROLES, "group_manager"];

/** H6: void an expense with a reason: { reason }. The id is the expense's journal id (the «آخرین هزینه‌ها» row). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/accounting/expenses/[id]/void">) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  try {
    await voidExpense(guard.session.organizationId, Number(id), guard.session.user.id, typeof body?.reason === "string" ? body.reason : "");
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
