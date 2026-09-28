import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { recordDelivery, DeliveryError } from "@/lib/delivery";

/** Records what happened at one door.
 *
 *  Safe to retry. Every write in recordDelivery is an assignment rather than an
 *  increment, so a queued request that the phone could not confirm can simply be sent
 *  again -- which is what makes the offline queue possible without a dedupe table.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;

  const stopId = Number((await ctx.params).id);
  const db = getDb();

  // The stop must be on a run belonging to this driver. Checked here rather than
  // trusting the id in the URL, and answered as 404 so another driver's stop is
  // indistinguishable from one that does not exist.
  const owned = db
    .prepare(
      `SELECT ds.id FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
        WHERE ds.id = ? AND dr.driver_user_id = ?`
    )
    .get(stopId, guard.session.user.id);
  if (!owned) {
    return NextResponse.json({ ok: false, error: "توقف پیدا نشد" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    lines?: unknown;
    collected_toman?: unknown;
    notes?: unknown;
  } | null;

  const lines = Array.isArray(body?.lines)
    ? (body.lines as { line_id: number; packs_delivered: number }[]).map((l) => ({
        line_id: Number(l.line_id),
        packs_delivered: Number(l.packs_delivered),
      }))
    : [];

  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: "قلمی مشخص نشده" }, { status: 400 });
  }

  const collected = Number(body?.collected_toman ?? 0);
  if (!Number.isInteger(collected) || collected < 0) {
    return NextResponse.json({ ok: false, error: "مبلغ دریافتی معتبر نیست" }, { status: 400 });
  }

  try {
    recordDelivery(db, stopId, {
      lines,
      collected_toman: collected,
      by: guard.session.user.id,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DeliveryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}
