import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LedgerError } from "@/lib/repo/ledgerCore";
import { setCostRuleIn } from "@/lib/repo/routeAdapters";

/** How an expense account that names no group is shared: by sales, or kept at company level. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { account_id?: unknown; mode?: unknown } | null;
  if (!Number.isInteger(body?.account_id)) return NextResponse.json({ ok: false, error: "حساب معتبر نیست" }, { status: 400 });
  try {
    await setCostRuleIn({ organizationId: guard.session.organizationId, accountId: body!.account_id as number, mode: body?.mode as "sales_share" | "company" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
