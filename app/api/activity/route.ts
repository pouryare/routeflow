import { NextRequest, NextResponse } from "next/server";
import { getDb, ActivityEntry, LoggableEntityType, PLAN_ENTITY_TYPES, logActivity } from "@/lib/db";
import { getActorName } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entity_type") as LoggableEntityType | null;
  const date = searchParams.get("date");

  if (!entityType || !PLAN_ENTITY_TYPES.includes(entityType)) {
    return NextResponse.json({ ok: false, error: "پارامترها نامعتبر است" }, { status: 400 });
  }

  const db = getDb();

  // Day mode: every event of this kind on one date, regardless of which entity. Feature
  // 12 reads the day's depot arrivals back this way to work out when the day started
  // and ended -- it does not know which site in advance.
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
    }
    const rows = db
      .prepare(
        `SELECT * FROM activity_log
         WHERE entity_type = ? AND created_at >= ? AND created_at < ?
         ORDER BY created_at`
      )
      .all(entityType, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`) as unknown as ActivityEntry[];
    return NextResponse.json({ ok: true, activity: rows });
  }

  const entityId = Number(searchParams.get("entity_id"));
  if (!Number.isInteger(entityId)) {
    return NextResponse.json({ ok: false, error: "پارامترها نامعتبر است" }, { status: 400 });
  }

  const rows = db
    .prepare(
      "SELECT * FROM activity_log WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 50"
    )
    .all(entityType, entityId) as unknown as ActivityEntry[];

  return NextResponse.json({ ok: true, activity: rows });
}

interface NewActivityInput {
  entity_type?: LoggableEntityType;
  entity_id?: number;
  note?: string;
}

/** Records something that happened, as opposed to something planned. Currently only the
 *  geofence writes here (arrivals at our own depots); status changes and assignments are
 *  logged by the routes that perform them, which is where the old and new values live.
 *
 *  Deliberately narrow: event_type is always "note". A caller that could choose
 *  "status_change" could write a history entry claiming a status change that never
 *  happened. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as NewActivityInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }
  if (!body.entity_type || !PLAN_ENTITY_TYPES.includes(body.entity_type)) {
    return NextResponse.json({ ok: false, error: "نوع موجودیت نامعتبر است" }, { status: 400 });
  }
  if (typeof body.entity_id !== "number" || !Number.isInteger(body.entity_id)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!note) {
    return NextResponse.json({ ok: false, error: "متن رویداد الزامی است" }, { status: 400 });
  }

  logActivity(getDb(), {
    entity_type: body.entity_type,
    entity_id: body.entity_id,
    event_type: "note",
    old_value: null,
    new_value: null,
    note,
    changed_by: getActorName(req),
  });

  return NextResponse.json({ ok: true });
}
