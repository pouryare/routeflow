import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, canReachGroup } from "@/lib/session";
import { addStop, DeliveryError } from "@/lib/delivery";
import { MANAGE_ROLES } from "@/lib/roles";

/* A function, not a module-level response: a Response body can be read once, so the second request
   to reach this answer got an empty body. */
const notFound = () => NextResponse.json({ ok: false, error: "پیدا نشد" }, { status: 404 });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const runId = Number((await ctx.params).id);
  const db = getDb();

  const run = db.prepare("SELECT id, group_id FROM delivery_runs WHERE id = ?").get(runId) as
    | { group_id: number | null }
    | undefined;
  if (!run || !canReachGroup(guard.session, run.group_id)) return notFound();

  const body = (await req.json().catch(() => null)) as { order_id?: unknown } | null;
  const order = db
    .prepare("SELECT id, group_id, status FROM orders WHERE id = ?")
    .get(Number(body?.order_id)) as
    | { id: number; group_id: number | null; status: string }
    | undefined;

  /* ONE check, and it is the one that means something: can the CALLER reach this order?
   *
   *  There used to be a second — `order.group_id !== run.group_id` — described as keeping
   *  goods inside the territory the scoping model draws. It was comparing two unrelated
   *  axes. `orders.group_id` is a SALES attribution: whose account, whose commission.
   *  `delivery_runs.group_id` is copied straight off the DRIVER's user row, and drivers are
   *  filed under an administrative bucket — in the demo seed literally «رانندگان». So the
   *  test asked whether a north-region sale equalled a driver's admin group, which is false
   *  for nearly every order: 20 of 29 confirmed orders could not go on ANY van, and the
   *  refusal came back as 404 «پیدا نشد» for rows that plainly exist.
   *
   *  The driver app already disagreed with it — readDriverRuns filters by driver_user_id and
   *  never mentions group, so a van carries whatever the manager hands it. The boundary that
   *  genuinely matters is reachability, and the check above is it: a group_manager still
   *  cannot assign another team's orders. */
  if (!order || !canReachGroup(guard.session, order.group_id)) return notFound();

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
