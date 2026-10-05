import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { readRunDrafts, commitDraft } from "@/lib/repo/runDrafts";
import { commitState } from "@/components/sales/DayLaneBoard";

/** Turns one draft into a real run. ONE lane, never all of them.
 *
 *  There is deliberately no bulk version. A "commit everything" control means there is
 *  something to forget, and a draft arranged for twenty minutes and never committed is a
 *  draft you did not do.
 *
 *  The draft is DELETED as part of this, in the same transaction that creates the run — so a
 *  failure halfway cannot leave the orders in the draft AND on a run, which would show them
 *  in two lanes at once and let whichever committed first silently lose the other. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as { draftId?: number } | null;
  if (!body || !Number.isInteger(body.draftId)) {
    return NextResponse.json({ ok: false, error: "پیش‌نویس نامعتبر است" }, { status: 400 });
  }

  const orgId = guard.session.organizationId;
  const userId = guard.session.user.id;
  const db = getDb();

  // Resolved through the reader, which scopes by user. The id in the body is a lookup key,
  // not a permission.
  const draft = readRunDrafts(db, orgId, userId).find((d) => d.id === body.draftId);
  if (!draft) {
    return NextResponse.json({ ok: false, error: "پیش‌نویس پیدا نشد" }, { status: 404 });
  }

  // The same rule the button uses, re-checked here: a client can post whatever it likes.
  const state = commitState(draft);
  if (!state.enabled) {
    return NextResponse.json(
      { ok: false, error: "برای قطعی کردن، اول راننده و تاریخ را انتخاب کنید" },
      { status: 409 }
    );
  }
  if (draft.order_ids.length === 0) {
    // A lane cannot be created empty, so this should be unreachable — but if it is, an empty
    // run is worse than a refusal, and the run would be sent out for nothing.
    return NextResponse.json(
      { ok: false, error: "این پیش‌نویس سفارشی ندارد" },
      { status: 409 }
    );
  }

  try {
    // The run and the draft's removal share one transaction, inside lib/repo/. See commitDraft.
    const runId = commitDraft(db, {
      draftId: draft.id,
      organizationId: orgId,
      userId,
      driverUserId: draft.driver_user_id,
      runDate: draft.run_date,
      orderIds: draft.order_ids,
    });
    return NextResponse.json({ ok: true, runId });
  } catch (e) {
    // commitDraft owns the transaction and has already rolled back; a second ROLLBACK here
    // would throw OUTSIDE the transaction and mask the real error with a SQLite one.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "خطا در ساخت سفر" },
      { status: 400 }
    );
  }
}