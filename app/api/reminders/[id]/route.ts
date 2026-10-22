import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { canReachEntity, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/reminders/[id]">) {
  /* Resolving a reminder is also what the «انجام شد» button on a push notification does, and the
     recipient of a due customer reminder is that customer's salesperson, so sellers may resolve
     (only that: DELETE stays with managers). canReachEntity below still limits it to customers
     they can reach. */
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep"]);
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
  const db = getDb();
  const owning = db.prepare("SELECT entity_type, entity_id FROM reminders WHERE id = ?").get(reminderId) as
    | { entity_type: string; entity_id: number }
    | undefined;
  if (!owning || !canReachEntity(guard.session, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  const result = db.prepare("UPDATE reminders SET resolved = ? WHERE id = ?").run(resolved ? 1 : 0, reminderId);
  if (result.changes === 0) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/reminders/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const reminderId = Number(id);
  if (!Number.isInteger(reminderId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const db = getDb();
  const owning = db.prepare("SELECT entity_type, entity_id FROM reminders WHERE id = ?").get(reminderId) as
    | { entity_type: string; entity_id: number }
    | undefined;
  if (!owning || !canReachEntity(guard.session, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  db.prepare("DELETE FROM reminders WHERE id = ?").run(reminderId);
  return NextResponse.json({ ok: true });
}
