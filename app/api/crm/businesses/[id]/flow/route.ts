import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { applyFlow } from "@/lib/repo/crm/write";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/flow">) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { answers?: unknown; entry?: string; task_id?: number; client_uuid?: string } | null;
  const entry = b?.entry === "talked_now" ? "talked_now" : "call";
  try {
    const r = applyFlow(guard.session, {
      customerId: id, answers: (b?.answers ?? []) as never, entry, channel: entry === "talked_now" ? "visit" : "call",
      taskId: typeof b?.task_id === "number" ? b.task_id : null, clientUuid: b?.client_uuid ?? null,
    });
    return NextResponse.json({ ok: true, activity_id: r.activityId, next_task_id: r.nextTaskId });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
