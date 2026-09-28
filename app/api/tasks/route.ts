import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listTasks, createTask, TaskError } from "@/lib/repo/tasks";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  return NextResponse.json({
    ok: true,
    tasks: listTasks(guard.session.organizationId, {
      assignee: sp.get("mine") === "1" ? guard.session.user.id : undefined,
      role: sp.get("role") ?? undefined,
      status: sp.get("status") ?? undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.title || !b?.kind) return NextResponse.json({ ok: false, error: "عنوان و نوع لازم است" }, { status: 400 });
  const kind = String(b.kind);
  // A reminder / note the member adds for themselves lands in their own Pocket.
  const selfKinds = kind === "reminder" || kind === "note";
  try {
    const id = createTask(guard.session.organizationId, {
      title: String(b.title),
      kind,
      assignee_user_id:
        (b.assignee_user_id as number | null) ?? (selfKinds ? guard.session.user.id : null),
      role_hint: (b.role_hint as string | null) ?? null,
      group_id: (b.group_id as number | null) ?? guard.session.groupId ?? null,
      entity_type: (b.entity_type as string | null) ?? null,
      entity_id: (b.entity_id as number | null) ?? null,
      due_at: (b.due_at as string | null) ?? null,
      stage: (b.stage as string | null) ?? undefined,
      priority: (b.priority as never) ?? "NORMAL",
      created_by: guard.session.user.id,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof TaskError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
