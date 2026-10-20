import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listTasks, createTask, assigneeInOrg, taskEntityValid, TaskError } from "@/lib/repo/tasks";
import { TASK_KINDS } from "@/lib/tasks/labels";
import { boundedText, isTimestampWithin } from "@/lib/inputChecks";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const session = guard.session;
  // Everyone below a manager sees their own tasks only: this used to return the whole
  // organisation's open tasks to a driver. Managers are held to their group's (and the
  // company-wide ones); owners keep the whole organisation.
  const ownOnly = !MANAGE_ROLES.includes(session.role) && session.role !== "rep_manager";
  // The rep manager runs the team board across groups, like an owner; only a group manager is
  // held to one group.
  const groupIds = session.role === "group_manager"
    ? (session.groupId === null ? [] : [session.groupId])
    : undefined;
  return NextResponse.json({
    ok: true,
    tasks: listTasks(session.organizationId, {
      assignee: ownOnly || sp.get("mine") === "1" ? session.user.id : undefined,
      groupIds: ownOnly ? undefined : groupIds,
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
  if (!(TASK_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ ok: false, error: "نوع کار نامعتبر است" }, { status: 400 });
  }
  const title = boundedText(b.title, 200);
  if (!title) return NextResponse.json({ ok: false, error: "عنوان باید ۱ تا ۲۰۰ نویسه باشد" }, { status: 400 });
  if (b.due_at != null && !isTimestampWithin(b.due_at, 366, 5 * 366)) {
    return NextResponse.json({ ok: false, error: "تاریخ سررسید معتبر نیست" }, { status: 400 });
  }
  if (!taskEntityValid(guard.session.organizationId, b.entity_type ?? null, b.entity_id ?? null)) {
    return NextResponse.json({ ok: false, error: "پیوند کار به مشتری یا سفارش معتبر نیست" }, { status: 400 });
  }
  // The assignee must be an active person of THIS organisation; a user id from another tenant was accepted.
  if (b.assignee_user_id != null && !assigneeInOrg(guard.session.organizationId, Number(b.assignee_user_id))) {
    return NextResponse.json({ ok: false, error: "مسئول انتخاب‌شده معتبر نیست" }, { status: 400 });
  }
  // A reminder / note the member adds for themselves lands in their own Pocket.
  const selfKinds = kind === "reminder" || kind === "note";
  try {
    const id = createTask(guard.session.organizationId, {
      title,
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
