import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { canActOnTask, completeTask, dismissTask, tasksRepo, taskCustomerType, TaskError } from "@/lib/repo/tasks";
import { objectionCardFor } from "@/lib/repo/academy";
import { MANAGE_ROLES } from "@/lib/roles";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const org = guard.session.organizationId;
  const row = tasksRepo.get(org, Number(id));
  // Another person's task answers as if it did not exist, like every other cross-scope row.
  if (!row || !canActOnTask({ role: guard.session.role, userId: guard.session.user.id, groupId: guard.session.groupId }, row)) {
    return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  }
  const b = (await req.json().catch(() => null)) as {
    status?: string;
    outcome_code?: string | null;
    outcome_note?: string | null;
  } | null;
  if ((b?.outcome_note ?? "").length > 2000 || (b?.outcome_code ?? "").length > 60) {
    return NextResponse.json({ ok: false, error: "یادداشت یا کد نتیجه بیش از حد بلند است" }, { status: 400 });
  }
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
