import { tehranTodayIso } from "@/lib/jalali";
import { NextRequest, NextResponse } from "next/server";
import type { EntityType } from "@/lib/db";
import { addReminder, listReminders } from "@/lib/repo/remindersAdmin";
import { canReachEntity, entityGroupFilter, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// reminders is option 2: a reminder is *about* a customer or district, so it belongs to
// whichever group owns that row. Joined, not denormalised -- see entityGroupFilter.
// Reading is scoped by entityGroupFilter below; writes stay with managers.
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  const f = await entityGroupFilter(guard.session, "r");

  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due"); // "today" | "week" | "all"

  let dueBy: string | null = null;
  if (due === "today") {
    dueBy = tehranTodayIso();
  } else if (due === "week") {
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    dueBy = `${weekLater.getFullYear()}-${String(weekLater.getMonth() + 1).padStart(2, "0")}-${String(weekLater.getDate()).padStart(2, "0")}`;
  }

  return NextResponse.json({ ok: true, reminders: await listReminders(f, dueBy) });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
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

  // 404, not 403: a reminder posted against another group's customer must not confirm
  // that the customer exists.
  if (!await canReachEntity(guard.session, entity_type, entity_id)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const id = await addReminder(entity_type, entity_id, due_date, message.trim());

  return NextResponse.json({ ok: true, id });
}
