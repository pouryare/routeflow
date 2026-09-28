import { NextRequest, NextResponse } from "next/server";
import { getDb, setLeadListItems } from "@/lib/db";
import { sanitiseIds } from "../route";
import { canReachGroup, groupFilter, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

interface PatchInput {
  name?: string;
  /** The whole ordered membership. Present means "replace with exactly this". */
  location_ids?: number[];
}

const MAX_NAME = 60;

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/lead-lists/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as PatchInput | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const owning = db.prepare("SELECT group_id FROM lead_lists WHERE id = ?").get(idNum) as
    | { group_id: number | null }
    | undefined;
  if (!owning || !canReachGroup(guard.session, owning.group_id)) {
    return NextResponse.json({ ok: false, error: "فهرست پیدا نشد" }, { status: 404 });
  }
  const exists = db.prepare("SELECT 1 FROM lead_lists WHERE id = ?").get(idNum);
  if (!exists) {
    return NextResponse.json({ ok: false, error: "فهرست پیدا نشد" }, { status: 404 });
  }

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ ok: false, error: "نام فهرست نمی‌تواند خالی باشد" }, { status: 400 });
    }
    if (name.length > MAX_NAME) {
      return NextResponse.json({ ok: false, error: "نام فهرست بیش از حد بلند است" }, { status: 400 });
    }
    db.prepare("UPDATE lead_lists SET name = ?, updated_at = ? WHERE id = ?").run(
      name,
      new Date().toISOString(),
      idNum
    );
  }

  if (body.location_ids !== undefined) {
    const ids = sanitiseIds(body.location_ids);
    if (ids === null) {
      return NextResponse.json({ ok: false, error: "فهرست مکان‌ها نامعتبر است" }, { status: 400 });
    }
    // A membership referring to a location that has since been deleted would violate the
    // foreign key and roll the whole write back, losing the rest of the reorder with it.
    // Filtered here instead, so the list simply comes back without the dead entry.
    const known = new Set(
      // Scoped: without this a manager could add another group's saved pins to their own
      // list and read the pins back through it.
      (
        db
          .prepare(`SELECT id FROM saved_locations WHERE 1 = 1${groupFilter(guard.session).sql}`)
          .all(...groupFilter(guard.session).params) as unknown as { id: number }[]
      ).map((r) => r.id)
    );
    setLeadListItems(db, idNum, ids.filter((locId) => known.has(locId)));
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/lead-lists/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const owning = db.prepare("SELECT group_id FROM lead_lists WHERE id = ?").get(idNum) as
    | { group_id: number | null }
    | undefined;
  if (!owning || !canReachGroup(guard.session, owning.group_id)) {
    return NextResponse.json({ ok: false, error: "فهرست پیدا نشد" }, { status: 404 });
  }
  const row = db.prepare("SELECT id, name FROM lead_lists WHERE id = ?").get(idNum) as
    | { id: number; name: string }
    | undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "فهرست پیدا نشد" }, { status: 404 });
  }

  const items = db
    .prepare("SELECT location_id FROM lead_list_items WHERE list_id = ? ORDER BY sort_order, id")
    .all(idNum) as unknown as { location_id: number }[];

  db.prepare("DELETE FROM lead_lists WHERE id = ?").run(idNum);

  // Handed back so the delete can be undone from the toast, membership and all. Only the
  // list is deleted -- the locations themselves are untouched.
  return NextResponse.json({
    ok: true,
    deleted: { name: row.name, location_ids: items.map((i) => i.location_id) },
  });
}
