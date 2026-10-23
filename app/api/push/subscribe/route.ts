import { NextRequest, NextResponse } from "next/server";
import { removeSubscription, saveSubscription } from "@/lib/repo/pushSubscriptions";
import { requireRole } from "@/lib/session";
import { isAllowedPushEndpoint, isPushKey } from "@/lib/pushEndpoint";

interface SubscriptionBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

// Every signed-in role: a subscription is a device endpoint, not business data, and
// Phase 2 routes loud notifications to whichever user owns it. Same list, same order, as
// GET /api/notifications.
const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales", "field_rep", "delivery_driver"] as const;

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as SubscriptionBody | null;
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!isAllowedPushEndpoint(endpoint) || !isPushKey(p256dh, 200) || !isPushKey(auth, 100)) {
    return NextResponse.json({ ok: false, error: "اشتراک نامعتبر است" }, { status: 400 });
  }

  // user_id is what makes a subscription addressable: `effectiveRouting` and the flush
  // both look up a user's devices through it. Re-stamped on conflict so a shared or
  // recycled endpoint follows whoever registered it last.
  await saveSubscription(endpoint!, p256dh!, auth!, guard.session.user.id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ ok: false, error: "اشتراک نامعتبر است" }, { status: 400 });
  }
  // Scoped to the caller now that user_id exists, so a guessed endpoint cannot unsubscribe
  // someone else's device. `user_id IS NULL` keeps pre-Phase-2 rows (registered before the
  // column existed) deletable by whoever is holding that endpoint in their browser.
  await removeSubscription(body.endpoint, guard.session.user.id);
  return NextResponse.json({ ok: true });
}
