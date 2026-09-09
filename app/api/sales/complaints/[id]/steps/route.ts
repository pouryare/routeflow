import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { complaintsRepo } from "@/lib/repo/complaints";
import { listStepTemplates, getComplaintSteps, linkStep, WorkflowError } from "@/lib/repo/workflow";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/complaints/[id]/steps">) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const complaintId = Number(id);
  if (!Number.isInteger(complaintId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const complaint = complaintsRepo.get(guard.session.organizationId, complaintId);
  if (!complaint) return NextResponse.json({ ok: false, error: "شکایت پیدا نشد" }, { status: 404 });

  const { tasks, edges } = getComplaintSteps(guard.session.organizationId, complaintId);
  return NextResponse.json({ ok: true, templates: listStepTemplates(), tasks, edges });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/complaints/[id]/steps">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const complaintId = Number(id);
  if (!Number.isInteger(complaintId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  const complaint = complaintsRepo.get(guard.session.organizationId, complaintId);
  if (!complaint) return NextResponse.json({ ok: false, error: "شکایت پیدا نشد" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { template_key?: string; from_task_id?: number } | null;
  if (!body?.template_key) {
    return NextResponse.json({ ok: false, error: "مرحله لازم است" }, { status: 400 });
  }

  try {
    const { taskId, edge } = linkStep(
      guard.session.organizationId,
      complaintId,
      body.template_key,
      body.from_task_id ?? null,
      guard.session.user.id,
    );
    return NextResponse.json({ ok: true, task_id: taskId, edge }, { status: 201 });
  } catch (e) {
    if (e instanceof WorkflowError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
