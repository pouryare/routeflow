import { NextRequest, NextResponse } from "next/server";
import { getDb, Reminder, EntityType } from "@/lib/db";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function enrich(db: ReturnType<typeof getDb>, rows: Reminder[]) {
  const customerIds = rows.filter((r) => r.entity_type === "customer").map((r) => r.entity_id);
  const districtIds = rows.filter((r) => r.entity_type === "district").map((r) => r.entity_id);

  const customerMap = new Map<number, string>();
  if (customerIds.length) {
    const placeholders = customerIds.map(() => "?").join(",");
    (db.prepare(`SELECT id, business_name FROM customers WHERE id IN (${placeholders})`).all(...customerIds) as { id: number; business_name: string }[]).forEach(
      (r) => customerMap.set(r.id, r.business_name)
    );
  }
  const districtMap = new Map<number, string>();
  if (districtIds.length) {
    const placeholders = districtIds.map(() => "?").join(",");
    (db.prepare(`SELECT id, name FROM districts WHERE id IN (${placeholders})`).all(...districtIds) as { id: number; name: string }[]).forEach(
      (r) => districtMap.set(r.id, r.name)
    );
  }

  return rows.map((r) => ({
    ...r,
    label: r.entity_type === "customer" ? customerMap.get(r.entity_id) ?? "مشتری حذف‌شده" : districtMap.get(r.entity_id) ?? "منطقه حذف‌شده",
  }));
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due"); // "today" | "week" | "all"

  let rows: Reminder[];
  if (due === "today") {
    rows = db
      .prepare("SELECT * FROM reminders WHERE resolved = 0 AND due_date <= ? ORDER BY due_date")
      .all(todayStr()) as unknown as Reminder[];
  } else if (due === "week") {
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    const weekStr = `${weekLater.getFullYear()}-${String(weekLater.getMonth() + 1).padStart(2, "0")}-${String(weekLater.getDate()).padStart(2, "0")}`;
    rows = db
      .prepare("SELECT * FROM reminders WHERE resolved = 0 AND due_date <= ? ORDER BY due_date")
      .all(weekStr) as unknown as Reminder[];
  } else {
    rows = db.prepare("SELECT * FROM reminders ORDER BY resolved, due_date").all() as unknown as Reminder[];
  }

  return NextResponse.json({ ok: true, reminders: enrich(db, rows) });
}

export async function POST(req: NextRequest) {
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
  const result = db
    .prepare(
      `INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(entity_type, entity_id, due_date, message.trim(), new Date().toISOString());

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
