import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { isToman } from "@/lib/money";
import { customerDebtsForOrg } from "@/lib/repo/payments";
import { DeliveryError } from "@/lib/delivery";
import { deferOwnedStop, findOwnedStop, invoiceTotal, recordStopDelivery, storedDeliveries } from "@/lib/repo/driverStops";

/** Records what happened at one door.
 *
 *  Safe to retry. Every write in recordDelivery is an assignment rather than an
 *  increment, so a queued request that the phone could not confirm can simply be sent
 *  again -- which is what makes the offline queue possible without a dedupe table.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;

  const stopId = Number((await ctx.params).id);

  // The stop must be on a run belonging to this driver (and company). Checked here rather than
  // trusting the id in the URL, and answered as 404 so another driver's stop is
  // indistinguishable from one that does not exist.
  const owned = await findOwnedStop(stopId, guard.session.user.id, guard.session.organizationId);
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
    const stored = await storedDeliveries(owned.order_id);
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
  const invoice = await invoiceTotal(owned.order_id);
  const owedBefore = (await customerDebtsForOrg(guard.session.organizationId)).get(owned.customer_id)?.total ?? 0;
  if (collected > invoice + owedBefore) {
    return NextResponse.json({ ok: false, error: "مبلغ دریافتی از بدهی مشتری و مبلغ این سفارش بیشتر است" }, { status: 400 });
  }

  try {
    await recordStopDelivery(stopId, {
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


/** «Later»: send a pending stop to the end of the driver's own run. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const stopId = Number((await ctx.params).id);
  // Same ownership rule as recording: another driver's stop answers 404.
  const owned = await findOwnedStop(stopId, guard.session.user.id, guard.session.organizationId);
  if (!owned) return NextResponse.json({ ok: false, error: "توقف پیدا نشد" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "defer") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...await deferOwnedStop(stopId) });
  } catch (e) {
    if (e instanceof DeliveryError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
