import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { patchRecurrence, removeRecurrence, RecurrenceError } from "@/lib/repo/taskRecurrences";

const MANAGER = ["owner", "group_manager", "rep_manager", "platform_owner"] as const;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, [...MANAGER]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ ok: false, error: "بدنه نامعتبر است" }, { status: 400 });
  try {
    const row = await patchRecurrence(guard.session.organizationId, Number(id), b);
    if (!row) return NextResponse.json({ ok: false, error: "الگو پیدا نشد" }, { status: 404 });
    return NextResponse.json({ ok: true, recurrence: row });
  } catch (e) {
    if (e instanceof RecurrenceError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, [...MANAGER]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  if (!await removeRecurrence(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "الگو پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
