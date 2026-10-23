import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { canActOnTask, moveTask, tasksRepo } from "@/lib/repo/tasks";
import type { BoardView } from "@/lib/tasks/lenses";

/** The one lane-move endpoint. The lane→field mapping lives in lib/tasks/lenses
 *  (`movePatch`); this route just authenticates, resolves the org, and delegates. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, [
    "owner",
    "group_manager",
    "rep_manager",
    "phone_sales",
    "field_rep",
    "delivery_driver",
    "platform_owner",
  ]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as
    | { view?: BoardView; to_lane?: string; outcome_code?: string }
    | null;
  if (!body?.view || !body?.to_lane) {
    return NextResponse.json({ ok: false, error: "نما و ستون مقصد لازم است" }, { status: 400 });
  }
  const row = await tasksRepo.get(guard.session.organizationId, Number(id));
  if (!row || !canActOnTask({ role: guard.session.role, userId: guard.session.user.id, groupId: guard.session.groupId }, row)) {
    return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  }
  const card = await moveTask(guard.session.organizationId, Number(id), {
    view: body.view,
    toLane: body.to_lane,
    actor: guard.session.user.id,
    nowIso: new Date().toISOString(),
    outcome_code: body.outcome_code ?? null,
  });
  if (!card) return NextResponse.json({ ok: false, error: "کار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, card });
}
