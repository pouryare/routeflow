import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { completeTask, dismissTask, tasksRepo, TaskError } from "@/lib/repo/tasks";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson", "driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!tasksRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  }
  const b = (await req.json().catch(() => null)) as {
    status?: string;
    outcome_code?: string | null;
    outcome_note?: string | null;
  } | null;
  try {
    if (b?.status === "dismissed") {
      dismissTask(guard.session.organizationId, Number(id));
    } else {
      completeTask(guard.session.organizationId, Number(id), {
        outcome_code: b?.outcome_code ?? null,
        outcome_note: b?.outcome_note ?? null,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
