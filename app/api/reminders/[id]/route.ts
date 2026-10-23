import { NextRequest, NextResponse } from "next/server";
import { deleteReminder, reminderEntity, setReminderResolved } from "@/lib/repo/remindersAdmin";
import { canReachEntity, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/reminders/[id]">) {
  /* Resolving a reminder is also what the «انجام شد» button on a push notification does, and the
     recipient of a due customer reminder is that customer's salesperson, so sellers may resolve
     (only that: DELETE stays with managers). canReachEntity below still limits it to customers
     they can reach. */
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const reminderId = Number(id);
  if (!Number.isInteger(reminderId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const { resolved } = (body ?? {}) as { resolved?: boolean };
  if (typeof resolved !== "boolean") {
    return NextResponse.json({ ok: false, error: "پارامتر نامعتبر" }, { status: 400 });
  }
  const owning = await reminderEntity(reminderId);
  if (!owning || !await canReachEntity(guard.session, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  if (!await setReminderResolved(reminderId, resolved)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/reminders/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const reminderId = Number(id);
  if (!Number.isInteger(reminderId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const owning = await reminderEntity(reminderId);
  if (!owning || !await canReachEntity(guard.session, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  await deleteReminder(reminderId);
  return NextResponse.json({ ok: true });
}
