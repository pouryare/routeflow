import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { isToman } from "@/lib/money";
import { customerDebtsForOrg } from "@/lib/repo/payments";
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
      `SELECT ds.id, ds.status, ds.collected_toman, ds.order_id, dr.status AS run_status, o.customer_id
         FROM delivery_stops ds
         JOIN delivery_runs dr ON dr.id = ds.run_id
         JOIN orders o ON o.id = ds.order_id
        WHERE ds.id = ? AND dr.driver_user_id = ?`
    )
    .get(stopId, guard.session.user.id) as
    | { id: number; status: string; collected_toman: number | null; order_id: number; run_status: string; customer_id: number }
    | undefined;
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

  /* A stop that already has an outcome is finished. The phone's queue re-sends a request it could
     not confirm, so an IDENTICAL resubmission is answered as success and changes nothing; a
     DIFFERENT one used to re-debit the van and rewrite the cash collected (and on a closed run it
     reopened settled work), so it is refused. */
  if (owned.status === "delivered" || owned.status === "refused" || owned.run_status === "done") {
    const stored = db
      .prepare("SELECT id, COALESCE(packs_delivered, -1) AS d FROM order_lines WHERE order_id = ?")
      .all(owned.order_id) as { id: number; d: number }[];
    const same =
      (owned.collected_toman ?? 0) === collected &&
      lines.every((l) => stored.some((r) => r.id === l.line_id && r.d === l.packs_delivered));
    if (same) return NextResponse.json({ ok: true, duplicate: true });
    return NextResponse.json(
      { ok: false, error: "این توقف قبلاً ثبت شده است؛ برای اصلاح با مدیر تماس بگیرید" },
      { status: 409 }
    );
  }
  if (!isToman(collected) || collected < 0) {
    return NextResponse.json({ ok: false, error: "مبلغ دریافتی معتبر نیست" }, { status: 400 });
  }
  // Cash taken at the door can be this invoice plus what the shop already owed, and no more.
  // Anything above that is a typo or a lie, and it goes straight into the receipts.
  const invoice = (
    db
      .prepare("SELECT COALESCE(SUM(packs_ordered * unit_price_toman), 0) AS t FROM order_lines WHERE order_id = ?")
      .get(owned.order_id) as { t: number }
  ).t;
  const owedBefore = customerDebtsForOrg(guard.session.organizationId).get(owned.customer_id)?.total ?? 0;
  if (collected > invoice + owedBefore) {
    return NextResponse.json({ ok: false, error: "مبلغ دریافتی از بدهی مشتری و مبلغ این سفارش بیشتر است" }, { status: 400 });
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
