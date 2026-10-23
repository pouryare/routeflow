import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  listRecurrences,
  createRecurrence,
  RecurrenceError,
  type RecurrenceInput,
} from "@/lib/repo/taskRecurrences";

const MANAGER = ["owner", "group_manager", "rep_manager", "platform_owner"] as const;

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGER]);
  if (!guard.ok) return guard.response;
  const activeParam = req.nextUrl.searchParams.get("active");
  return NextResponse.json({
    ok: true,
    recurrences: await listRecurrences(guard.session.organizationId, {
      active: activeParam === null ? undefined : activeParam === "1",
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGER]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Partial<RecurrenceInput> | null;
  if (!b?.title || !b?.kind || !b?.rrule) {
    return NextResponse.json({ ok: false, error: "عنوان، نوع و الگوی تکرار لازم است" }, { status: 400 });
  }
  try {
    const row = await createRecurrence(
      guard.session.organizationId,
      {
        title: String(b.title),
        kind: String(b.kind),
        rrule: String(b.rrule),
        priority: (b.priority as never) ?? "NORMAL",
        assignee_user_id: b.assignee_user_id ?? null,
        role_hint: b.role_hint ?? null,
        group_id: b.group_id ?? null,
        entity_type: b.entity_type ?? null,
        entity_id: b.entity_id ?? null,
      },
      guard.session.user.id
    );
    return NextResponse.json({ ok: true, recurrence: row }, { status: 201 });
  } catch (e) {
    if (e instanceof RecurrenceError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}
