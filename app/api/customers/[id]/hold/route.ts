import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf } from "@/lib/repo/payments";
import { placeHold, releaseHold } from "@/lib/repo/customerHolds";

const SELLERS = [...MANAGE_ROLES, "phone_sales", "field_rep"] as const;
const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

async function reach(req: NextRequest, idParam: string) {
  const guard = await requireRole(req, [...SELLERS]);
  if (!guard.ok) return { response: guard.response };
  if (!isId(idParam)) return { response: bad("درخواست نامعتبر است") };
  const cust = await customerGroupOf(guard.session.organizationId, Number(idParam));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return { response: bad("مشتری پیدا نشد", 404) };
  return { session: guard.session, id: Number(idParam) };
}

/** F71: hold a customer's new orders { reason, expiresOn }. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/hold">) {
  const r = await reach(req, (await ctx.params).id);
  if (!r.session) return r.response;
  const b = (await req.json().catch(() => null)) as { reason?: unknown; expiresOn?: unknown } | null;
  if (typeof b?.reason !== "string" || typeof b.expiresOn !== "string") return bad("درخواست نامعتبر است");
  const refused = await placeHold(r.session.organizationId, r.id, r.session.user.id, { reason: b.reason, expiresOn: b.expiresOn });
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}

/** F71: lift the hold. The person who placed it, or a manager. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/hold">) {
  const r = await reach(req, (await ctx.params).id);
  if (!r.session) return r.response;
  const refused = await releaseHold(r.session.organizationId, r.id, { userId: r.session.user.id, manager: (MANAGE_ROLES as readonly string[]).includes(r.session.role) });
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}
