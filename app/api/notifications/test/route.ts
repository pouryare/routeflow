import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getChannelState, flushNotifications } from "@/lib/repo/notifications";
import { insertTestNotification, testNotificationOutcome } from "@/lib/repo/notification-test";

const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

/** Past lib/repo/notifications.ts's 120s DEBOUNCE_MS (module-private there, so this is a
 *  deliberate duplicate) so the row we just wrote is not held back as a still-arriving
 *  burst and goes out on this call. The same value shifts the quiet-hours clock forward
 *  by three minutes, which is immaterial next to a window measured in hours. */
const PAST_DEBOUNCE_MS = 180_000;

/** One test per user per 10s. In-module, so it resets on redeploy -- it exists to stop a
 *  double-click or a stuck button, not as a security control. */
const RATE_MS = 10_000;
const lastTestAt = new Map<number, number>();

/** Send the caller a test notification on one channel. Pre-checks the channel so a
 *  misconfigured server or an unconnected device is an explicit Persian error rather than
 *  a silent no-op, and hands back the flush's own tuple so the UI can distinguish a real
 *  send from a quiet-hours hold. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;

  const body = (await req.json().catch(() => null)) as { channel?: unknown } | null;
  const channel = body?.channel;
  if (channel !== "push" && channel !== "telegram") {
    return NextResponse.json({ ok: false, error: "کانال نامعتبر است" }, { status: 400 });
  }

  const last = lastTestAt.get(user.id);
  if (last !== undefined && Date.now() - last < RATE_MS) {
    return NextResponse.json({ ok: false, error: "کمی صبر کنید و دوباره تلاش کنید" }, { status: 429 });
  }

  // Checked before the slot is burned: a "not configured yet" answer must not lock the
  // user out of retrying the moment they finish connecting.
  const state = getChannelState(user.id, channel);
  if (!state.configured) {
    return NextResponse.json({ ok: false, error: "کانال پیکربندی نشده است" }, { status: 400 });
  }
  if (!state.connected) {
    return NextResponse.json({ ok: false, error: "کانال متصل نیست" }, { status: 400 });
  }
  lastTestAt.set(user.id, Date.now());

  const notificationId = insertTestNotification(organizationId, user.id);
  const asOf = new Date(Date.now() + PAST_DEBOUNCE_MS).toISOString();

  // Two side effects of the asOf shift, both deliberate and both org-wide:
  //
  //  1. `flushNotifications` is not user-scoped, and pushing asOf three minutes into the
  //     future makes its debounce guard (`newest.m > asOfMs - DEBOUNCE_MS`) unsatisfiable
  //     for *every* user in the org, since every real timestamp is more than 60s below
  //     now + 180s. So pressing "test" force-flushes the whole org's backlog on both
  //     channels, bypassing the 120s settle the normal sweep respects. A coworker can get
  //     a premature partial digest here and a second one on the next sweep.
  //  2. The returned counters are therefore org-wide totals, not the caller's. They are
  //     reported under `org` for diagnostics only.
  //
  // Narrowing this needs a user-scoped flush in lib/repo/notifications.ts, which this task
  // may not touch. `result` below is read back off the caller's own row instead, so the UI
  // never mistakes a coworker's delivery for the caller's test.
  const org = await flushNotifications(organizationId, asOf);
  const result = testNotificationOutcome(notificationId, channel, asOf);
  return NextResponse.json({ ok: true, result, org });
}
