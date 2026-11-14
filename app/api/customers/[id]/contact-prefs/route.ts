import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { SELL_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { isContactChannel } from "@/lib/contactPrefs";
import { customerGroupOf } from "@/lib/repo/payments";
import { setContactPref } from "@/lib/repo/contactPrefs";

/** S15: turn a channel off or on for a customer: { channel, off, reason }. A reason is needed to turn one off. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/contact-prefs">) {
  const guard = await requireRole(req, SELL_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { channel?: unknown; off?: unknown; reason?: unknown } | null;
  if (!isContactChannel(body?.channel) || typeof body?.off !== "boolean") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (body.off && (reason.length === 0 || reason.length > 300)) return NextResponse.json({ ok: false, error: "دلیل را بنویسید" }, { status: 400 });
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  await setContactPref(guard.session.organizationId, Number(id), body.channel, body.off, reason, guard.session.user.id);
  return NextResponse.json({ ok: true });
}
