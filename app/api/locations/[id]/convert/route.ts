import { NextRequest, NextResponse } from "next/server";
import { getDb, SavedLocationRow } from "@/lib/db";
import { canReachGroup, requireRole } from "@/lib/session";

// Promotes a prospect into the real customers table -- a manual insert, distinct from
// the bulk customer-creation paths, so it gets its own
// customer_code namespace ("LEAD-<id>") that can never collide with a spreadsheet code
// and is easy to recognize later. The saved_locations row is deleted on success: once
// promoted it's a customer, not a prospect, so it shouldn't linger in both lists (the
// duplicate check in /api/locations/parse also covers the customers table, so re-pasting
// the same venue's link later is still caught).
export async function POST(req: NextRequest, ctx: RouteContext<"/api/locations/[id]/convert">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const owning = db.prepare("SELECT group_id FROM saved_locations WHERE id = ?").get(idNum) as
    | { group_id: number | null }
    | undefined;
  if (!owning || !canReachGroup(guard.session, owning.group_id)) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  const location = db.prepare("SELECT * FROM saved_locations WHERE id = ?").get(idNum) as
    | SavedLocationRow
    | undefined;
  if (!location) {
    return NextResponse.json({ ok: false, error: "مورد پیدا نشد" }, { status: 404 });
  }
  if (location.lat === null || location.lng === null) {
    return NextResponse.json(
      { ok: false, error: "این مکان مختصات ندارد؛ ابتدا موقعیت آن را روی نقشه تعیین کنید" },
      { status: 422 }
    );
  }

  const customerCode = `LEAD-${location.id}`;
  const now = new Date().toISOString();
  const notes = ["از فهرست مکان‌های پیشنهادی تبدیل شد", location.address, location.notes]
    .filter(Boolean)
    .join(" — ");

  db.exec("BEGIN");
  try {
    const insert = db.prepare(`
      INSERT INTO customers (customer_code, business_name, address, city, province, lat, lng, notes, synced_at, organization_id)
      VALUES (?, ?, ?, 'تهران', 'تهران', ?, ?, ?, ?, ?)
      ON CONFLICT(organization_id, customer_code) DO NOTHING
    `);
    const result = insert.run(
      customerCode,
      location.name,
      location.address,
      location.lat,
      location.lng,
      notes,
      now,
      guard.session.organizationId
    );
    if (result.changes === 0) {
      db.exec("ROLLBACK");
      return NextResponse.json({ ok: false, error: "این مکان قبلاً به مشتری تبدیل شده است" }, { status: 409 });
    }
    db.prepare("DELETE FROM saved_locations WHERE id = ?").run(idNum);
    db.exec("COMMIT");
    return NextResponse.json({ ok: true, customerId: Number(result.lastInsertRowid) });
  } catch (e) {
    db.exec("ROLLBACK");
    const msg = e instanceof Error ? e.message : "خطا";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
