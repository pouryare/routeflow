import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { canReachEntity, requireRole } from "@/lib/session";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/reminders/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
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
  if (!owning || !canReachEntity(guard.session, db, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  const result = db.prepare("UPDATE reminders SET resolved = ? WHERE id = ?").run(resolved ? 1 : 0, reminderId);
  if (result.changes === 0) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/reminders/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
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
  if (!owning || !canReachEntity(guard.session, db, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "یادآوری پیدا نشد" }, { status: 404 });
  }
  db.prepare("DELETE FROM reminders WHERE id = ?").run(reminderId);
  return NextResponse.json({ ok: true });
}
