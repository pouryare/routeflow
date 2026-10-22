import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { reconcileUnload, DISPOSITIONS, type Disposition } from "@/lib/repo/unload";
import { runOwnedByDriver, unloadOf } from "@/lib/repo/routeAdapters";
import { StockError } from "@/lib/repo/stock";
import { vanFacilityFor } from "@/lib/repo/vanStock";

/** Records what came back on a run, and where each part of it went.
 *
 *  Safe to retry, for the same reason the door endpoint is: reconcileUnload validates every
 *  line against the ledger BEFORE writing, so a second attempt after a successful one finds a
 *  van that is already empty and refuses with "nothing should come back" rather than
 *  double-counting. Refusing is the correct answer there, not a 500.
 *
 *  The error message goes to the driver verbatim. It names the gap by number, because the
 *  whole point of refusing a shortfall is that the driver has to go and account for it. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;

  const runId = Number((await ctx.params).id);
  if (!Number.isInteger(runId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const orgId = guard.session.organizationId;

  // The run must belong to this driver. Checked here rather than trusting the id in the
  // URL, and answered as 404 so another driver's run is indistinguishable from one that
  // does not exist.
  const owned = runOwnedByDriver(runId, guard.session.user.id, orgId);
  if (!owned) {
    return NextResponse.json({ ok: false, error: "مسیر پیدا نشد" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    facilityId?: number;
    lines?: { productId?: number; disposition?: string; qty?: number }[];
  } | null;
  if (!body || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ ok: false, error: "قلمی برای تخلیه ارسال نشده است" }, { status: 400 });
  }

  // Which van? Resolved from the driver's own vehicle rather than accepted from the body --
  // a client that named a different van would be debiting the wrong stock balance.
  const vanFacilityId = vanFacilityFor(orgId, owned.driver_user_id);
  if (vanFacilityId === null) {
    return NextResponse.json(
      { ok: false, error: "برای این راننده وانتی ثبت نشده است" },
      { status: 409 }
    );
  }

  const unload = unloadOf(runId);
  if (!unload) {
    return NextResponse.json(
      { ok: false, error: "تخلیه‌ای برای این مسیر ثبت نشده است" },
      { status: 409 }
    );
  }

  const lines = body.lines.map((l) => ({
    productId: Number(l.productId),
    disposition: String(l.disposition) as Disposition,
    qty: Number(l.qty),
  }));
  for (const l of lines) {
    if (!Number.isInteger(l.productId)) {
      return NextResponse.json({ ok: false, error: "کالا نامعتبر است" }, { status: 400 });
    }
    if (!DISPOSITIONS.includes(l.disposition)) {
      return NextResponse.json({ ok: false, error: "نوع تخلیه نامعتبر است" }, { status: 400 });
    }
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      return NextResponse.json({ ok: false, error: "مقدار نامعتبر است" }, { status: 400 });
    }
  }

  try {
    reconcileUnload({
      runId,
      organizationId: orgId,
      vanFacilityId,
      // The unload card on the run decides where the extras go -- not the client. A body that
      // named another facility would move stock somewhere the run never went.
      facilityId: unload.facility_id,
      lines,
      actorId: guard.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof StockError) {
      // 409, and the message verbatim. This is a refusal to record an incomplete day, not a
      // malformed request -- the driver's own numbers come back to him.
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}