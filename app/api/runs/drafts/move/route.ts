import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import {
  addOrderToDraft,
  readRunDrafts,
  removeOrderFromDraft,
} from "@/lib/repo/runDrafts";

/** Moves one order into a lane, or out of every lane.
 *
 *  `draftId: null` means "put it back in the pool". That is a real operation and not a
 *  delete: the order still exists, it simply belongs to nobody's plan yet.
 *
 *  Ownership is resolved SERVER-SIDE, from the session, on every call. A draft is private
 *  to one person, and the id in the body is never trusted for that — the same instinct as
 *  the door endpoint refusing another driver's stop. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    orderId?: number;
    draftId?: number | null;
  } | null;
  if (!body || !Number.isInteger(body.orderId)) {
    return NextResponse.json({ ok: false, error: "سفارش نامعتبر است" }, { status: 400 });
  }

  const orgId = guard.session.organizationId;
  const userId = guard.session.user.id;

  try {
    if (body.draftId == null) {
      // Out of every lane THIS user owns. Scoped by user, because another manager's lane is
      // not this manager's to rearrange.
      for (const d of readRunDrafts(getDb(), orgId, userId)) {
        if (d.order_ids.includes(body.orderId!)) {
          removeOrderFromDraft({ organizationId: orgId, userId, draftId: d.id, orderId: body.orderId! });
        }
      }
    } else {
      addOrderToDraft({
        organizationId: orgId,
        userId,
        draftId: body.draftId,
        orderId: body.orderId!,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "خطا در جابه‌جایی سفارش" },
      { status: 400 }
    );
  }
}