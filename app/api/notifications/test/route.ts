import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getChannelState, flushNotifications } from "@/lib/repo/notifications";
import { insertTestNotification } from "@/lib/repo/notification-test";

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

  insertTestNotification(organizationId, user.id);
  const asOf = new Date(Date.now() + PAST_DEBOUNCE_MS).toISOString();
  const result = await flushNotifications(organizationId, asOf);
  return NextResponse.json({ ok: true, ...result });
}
