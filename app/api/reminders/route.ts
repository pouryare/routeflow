import { tehranTodayIso } from "@/lib/jalali";
import { NextRequest, NextResponse } from "next/server";
import { getDb, Reminder, EntityType } from "@/lib/db";
import { withEntityLabels } from "@/lib/repo/entityLabels";
import { canReachEntity, entityGroupFilter, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// reminders is option 2: a reminder is *about* a customer or district, so it belongs to
// whichever group owns that row. Joined, not denormalised -- see entityGroupFilter.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const f = entityGroupFilter(guard.session, "r");

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due"); // "today" | "week" | "all"

  let rows: Reminder[];
  if (due === "today") {
    rows = db
      .prepare(
        `SELECT r.* FROM reminders r${f.joins} WHERE r.resolved = 0 AND r.due_date <= ?${f.sql} ORDER BY r.due_date`
      )
      .all(tehranTodayIso(), ...f.params) as unknown as Reminder[];
  } else if (due === "week") {
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    const weekStr = `${weekLater.getFullYear()}-${String(weekLater.getMonth() + 1).padStart(2, "0")}-${String(weekLater.getDate()).padStart(2, "0")}`;
    rows = db
      .prepare(
        `SELECT r.* FROM reminders r${f.joins} WHERE r.resolved = 0 AND r.due_date <= ?${f.sql} ORDER BY r.due_date`
      )
      .all(weekStr, ...f.params) as unknown as Reminder[];
  } else {
    rows = db
      .prepare(`SELECT r.* FROM reminders r${f.joins} WHERE 1 = 1${f.sql} ORDER BY r.resolved, r.due_date`)
      .all(...f.params) as unknown as Reminder[];
  }

  return NextResponse.json({ ok: true, reminders: withEntityLabels(db, rows) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const { entity_type, entity_id, due_date, message } = (body ?? {}) as {
    entity_type?: EntityType;
    entity_id?: number;
    due_date?: string;
    message?: string;
  };

  if (entity_type !== "district" && entity_type !== "customer") {
    return NextResponse.json({ ok: false, error: "نوع موجودیت نامعتبر است" }, { status: 400 });
  }
  if (typeof entity_id !== "number" || !Number.isInteger(entity_id)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  if (!due_date || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
    return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
  }
  if (!message || !message.trim()) {
    return NextResponse.json({ ok: false, error: "متن یادآوری لازم است" }, { status: 400 });
  }

  const db = getDb();
  // 404, not 403: a reminder posted against another group's customer must not confirm
  // that the customer exists.
  if (!canReachEntity(guard.session, db, entity_type, entity_id)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const result = db
    .prepare(
      `INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(entity_type, entity_id, due_date, message.trim(), new Date().toISOString());

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
