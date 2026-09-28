import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, canReachGroup } from "@/lib/session";
import { addStop, DeliveryError } from "@/lib/delivery";
import { MANAGE_ROLES } from "@/lib/roles";

const NOT_FOUND = NextResponse.json({ ok: false, error: "پیدا نشد" }, { status: 404 });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const runId = Number((await ctx.params).id);
  const db = getDb();

  const run = db.prepare("SELECT id, group_id FROM delivery_runs WHERE id = ?").get(runId) as
    | { group_id: number | null }
    | undefined;
  if (!run || !canReachGroup(guard.session, run.group_id)) return NOT_FOUND;

  const body = (await req.json().catch(() => null)) as { order_id?: unknown } | null;
  const order = db
    .prepare("SELECT id, group_id, status FROM orders WHERE id = ?")
    .get(Number(body?.order_id)) as
    | { id: number; group_id: number | null; status: string }
    | undefined;

  // Two checks, both 404. The caller must be able to reach the order, and the order must
  // belong to the same territory as the run -- loading another group's order onto this
  // van would move goods across the boundary the whole scoping model exists to keep.
  if (!order || !canReachGroup(guard.session, order.group_id)) return NOT_FOUND;
  if (order.group_id !== run.group_id) return NOT_FOUND;

  try {
    const id = addStop(db, runId, order.id, Number(body && (body as { sort_order?: number }).sort_order) || 0);
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof DeliveryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    if (e instanceof Error && /UNIQUE/.test(e.message)) {
      return NextResponse.json(
        { ok: false, error: "این سفارش قبلاً روی این مسیر است" },
        { status: 400 }
      );
    }
    throw e;
  }
}
