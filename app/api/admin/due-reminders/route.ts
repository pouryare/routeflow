import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { setDueReminderDays } from "@/lib/repo/dueReminders";
import { REMINDER_CHOICES } from "@/lib/dueReminders";

/** A8: { days: number[] } from the offered choices; an empty list switches the reminders off. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { days?: unknown } | null;
  const days = Array.isArray(body?.days) ? body.days.map(Number) : null;
  if (!days || days.some((d) => !(REMINDER_CHOICES as readonly number[]).includes(d))) {
    return NextResponse.json({ ok: false, error: "روزها نامعتبر است" }, { status: 400 });
  }
  await setDueReminderDays(guard.session.organizationId, days);
  return NextResponse.json({ ok: true });
}
