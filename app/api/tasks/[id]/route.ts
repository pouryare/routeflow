import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { completeTask, dismissTask, tasksRepo, taskCustomerType, TaskError } from "@/lib/repo/tasks";
import { objectionCardFor } from "@/lib/repo/academy";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson", "driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const org = guard.session.organizationId;
  if (!tasksRepo.get(org, Number(id))) {
    return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  }
  const b = (await req.json().catch(() => null)) as {
    status?: string;
    outcome_code?: string | null;
    outcome_note?: string | null;
  } | null;
  try {
    if (b?.status === "dismissed") {
      dismissTask(org, Number(id));
      return NextResponse.json({ ok: true });
    }
    completeTask(org, Number(id), {
      outcome_code: b?.outcome_code ?? null,
      outcome_note: b?.outcome_note ?? null,
    });
    // Phase 8: an outcome carries its objection card back, so training happens in the
    // call rather than in a tab.
    const objection_card = b?.outcome_code
      ? objectionCardFor(org, b.outcome_code, taskCustomerType(org, Number(id))) ?? null
      : null;
    return NextResponse.json({ ok: true, objection_card });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
