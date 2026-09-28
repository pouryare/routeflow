import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { canReachGroup, requireRole, type Session } from "@/lib/session";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import { applyLeadVisit } from "@/lib/repo/crm/write";
import { isOnDriversRun } from "@/lib/repo/leadRuns";
import { readLeadLocation } from "@/lib/repo/leads";
import { CrmError } from "@/lib/repo/crm/write";
import { startFlow, viewStep, type FlowState } from "@/lib/crm/flows/machine";
import type { FlowContext } from "@/lib/crm/flows/types";
import { isVanRole } from "@/lib/roles";

/** GET: the location + a flow context for a driver standing in front of it. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/leads/locations/[id]/visit">) {
  const guard = requireRole(req, ["owner", "group_manager", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });

  const db = getDb();
  const loc = readLeadLocation(db, id);
  if (!loc || !canReachGroup(guard.session, loc.group_id)) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  const flowCtx: FlowContext = {
    entry: "driver_visit",
    firstContact: true,
    attemptNo: 1,
    maxMisses: 5,
    isManager: !isVanRole(guard.session.role),
    vars: { name: loc.name, address: loc.address ?? "" },
    knownContacts: [],
    products: [],
    reps: [],
    recentCustomers: [],
  };
  return NextResponse.json({ ok: true, location: loc, ctx: flowCtx, step: viewStep(leadVisitFlow, flowCtx, startFlow(leadVisitFlow, flowCtx)) });
}

/** POST: save the driver's visit answers. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/leads/locations/[id]/visit">) {
  const guard = requireRole(req, ["owner", "group_manager", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });

  const db = getDb();
  const loc = readLeadLocation(db, id);
  if (!loc || !canReachGroup(guard.session, loc.group_id)) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  const b = (await req.json().catch(() => null)) as { answers?: unknown; client_uuid?: string } | null;
  if (!b?.answers) return NextResponse.json({ ok: false, error: "بدنه درخواست نامعتبر است" }, { status: 400 });

  // A driver may only record against a stop on their own run. A manager is not bound by one.
  // The query is in lib/repo/leadRuns.ts: raw SQL does not live in a route.
  if (isVanRole(guard.session.role) && !isOnDriversRun(db, guard.session.user.id, guard.session.organizationId, id)) {
    return NextResponse.json({ ok: false, error: "این توقف در مسیر شما نیست" }, { status: 403 });
  }

  try {
    const r = applyLeadVisit(guard.session, {
      locationId: id,
      answers: b.answers as never[],
      clientUuid: b.client_uuid ?? null,
    });
    return NextResponse.json({ ok: true, location_id: id, activity_id: r.activityId, next_task_id: r.nextTaskId });
  } catch (e) {
    if (e instanceof CrmError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}