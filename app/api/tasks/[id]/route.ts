import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { canActOnTask, completeTask, dismissTask, snoozeTask, tasksRepo, taskCustomerType, TaskError } from "@/lib/repo/tasks";
import { isSnoozeChoice } from "@/lib/taskSnooze";
import { objectionCardFor } from "@/lib/repo/academy";
import { MANAGE_ROLES } from "@/lib/roles";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const org = guard.session.organizationId;
  const row = await tasksRepo.get(org, Number(id));
  // Another person's task answers as if it did not exist, like every other cross-scope row.
  if (!row || !canActOnTask({ role: guard.session.role, userId: guard.session.user.id, groupId: guard.session.groupId }, row)) {
    return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  }
  const b = (await req.json().catch(() => null)) as {
    status?: string;
    outcome_code?: string | null;
    outcome_note?: string | null;
    snooze?: unknown;
  } | null;
  if ((b?.outcome_note ?? "").length > 2000 || (b?.outcome_code ?? "").length > 60) {
    return NextResponse.json({ ok: false, error: "یادداشت یا کد نتیجه بیش از حد بلند است" }, { status: 400 });
  }
  try {
    // F142: «later» moves the due time; refused (400) for urgent work or after three snoozes.
    if (b?.snooze !== undefined) {
      if (!isSnoozeChoice(b.snooze)) return NextResponse.json({ ok: false, error: "زمان عقب‌انداختن نامعتبر است" }, { status: 400 });
      try {
        return NextResponse.json({ ok: true, due_at: await snoozeTask(org, Number(id), b.snooze) });
      } catch (e) {
        if (e instanceof TaskError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
        throw e;
      }
    }
    if (b?.status === "dismissed") {
      await dismissTask(org, Number(id));
      return NextResponse.json({ ok: true });
    }
    await completeTask(org, Number(id), {
      outcome_code: b?.outcome_code ?? null,
      outcome_note: b?.outcome_note ?? null,
    });
    // Phase 8: an outcome carries its objection card back, so training happens in the
    // call rather than in a tab.
    const objection_card = b?.outcome_code
      ? await objectionCardFor(org, b.outcome_code, await taskCustomerType(org, Number(id))) ?? null
      : null;
    return NextResponse.json({ ok: true, objection_card });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
}
