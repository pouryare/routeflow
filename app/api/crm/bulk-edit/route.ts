import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { bulkPlanProblem, type BulkActor, type BulkPlan } from "@/lib/bulkEdit";
import { BulkEditError, previewBulkEdit } from "@/lib/repo/bulkEdit";
import { startBulkEdit } from "@/lib/repo/bulkJobs";

/** T4: change the salesperson or group of the picked customers. `preview: true` only counts. */
async function post(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { ids?: unknown; field?: unknown; value?: unknown; preview?: unknown } | null;
  const value = b?.value === undefined ? null : b.value;
  const problem = bulkPlanProblem({ ids: b?.ids, field: b?.field, value });
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  const plan = { ids: b!.ids, field: b!.field, value } as BulkPlan;
  const s = guard.session;
  const actor: BulkActor = { organizationId: s.organizationId, userId: s.user.id, role: s.role, groupId: s.groupId };
  try {
    if (b?.preview === true) return NextResponse.json({ ok: true, ...(await previewBulkEdit(actor, plan)) });
    return NextResponse.json({ ok: true, ...(await startBulkEdit(actor, plan)) }, { status: 200 });
  } catch (e) {
    if (e instanceof BulkEditError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
export const POST = (req: NextRequest) => once(req, () => post(req));
