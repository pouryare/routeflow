import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import {
  LeadRunError,
  readLeadRun,
  updateLeadRun,
  type LeadRunStatus,
} from "@/lib/repo/leadRuns";
import { isVanRole } from "@/lib/roles";

/** One run: read it, or change who it belongs to / when / what is on it.
 *
 *  A driver may reorder their own stops and nothing else. They cannot hand the route to
 *  somebody else, move it to another day, or mark it done on the manager's behalf -- a route
 *  is the manager's plan, and the driver works it. The reorder is the one thing they are
 *  allowed, because the order they actually drive is theirs to fix. */

const STATUSES: LeadRunStatus[] = ["planned", "in_progress", "done"];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/lead-runs/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });

  const db = getDb();
  const run = readLeadRun(db, id, guard.session.organizationId);
  // A driver may read only their own run. 404, not 403: a 403 would confirm it exists.
  if (!run) return NextResponse.json({ ok: false, error: "مسیر پیدا نشد" }, { status: 404 });
  if (isVanRole(guard.session.role) && run.driver_user_id !== guard.session.user.id) {
    return NextResponse.json({ ok: false, error: "مسیر پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, run });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/lead-runs/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });

  const db = getDb();
  const session = guard.session;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });

  const existing = readLeadRun(db, id, session.organizationId);
  if (!existing) return NextResponse.json({ ok: false, error: "مسیر پیدا نشد" }, { status: 404 });
  if (isVanRole(session.role) && existing.driver_user_id !== session.user.id) {
    return NextResponse.json({ ok: false, error: "مسیر پیدا نشد" }, { status: 404 });
  }

  // A driver gets the reorder and nothing else. Checked by inspecting the patch rather than
  // by a separate route, so there is one code path and one place the rule is written.
  if (isVanRole(session.role)) {
    const keys = Object.keys(body);
    const onlyStops = keys.every((k) => k === "location_ids");
    if (!onlyStops) {
      return NextResponse.json({ ok: false, error: "تغییر این فیلدها در اختیار دفتر است" }, { status: 403 });
    }
  }

  if (body.status !== undefined && !STATUSES.includes(body.status as LeadRunStatus)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }
  if (body.location_ids !== undefined && !Array.isArray(body.location_ids)) {
    return NextResponse.json({ ok: false, error: "مسیر خالی است" }, { status: 400 });
  }

  try {
    const run = updateLeadRun(db, session, id, {
      driver_user_id: body.driver_user_id === undefined ? undefined : Number(body.driver_user_id),
      run_date: body.run_date,
      status: body.status as LeadRunStatus | undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      location_ids: Array.isArray(body.location_ids) ? (body.location_ids as unknown[]).map(Number) : undefined,
    });
    return NextResponse.json({ ok: true, run });
  } catch (e) {
    if (e instanceof LeadRunError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
