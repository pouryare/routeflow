import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { applyMutations, type IncomingMutation } from "@/lib/repo/syncMutations";

/** Drain the client outbox. Idempotent on client_uuid, so a retry after a dropped
 *  response is a no-op. `server_time` lets the client re-measure its clock skew. */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (session.role === "platform_owner") {
    return NextResponse.json({ ok: false, error: "این حساب همگام‌سازی ندارد" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    device_id?: string;
    mutations?: IncomingMutation[];
  } | null;
  const muts = Array.isArray(body?.mutations) ? body!.mutations : [];
  if (muts.length === 0) {
    return NextResponse.json({ ok: true, results: {}, server_time: new Date().toISOString() });
  }
  if (muts.length > 200) {
    return NextResponse.json({ ok: false, error: "دستهٔ همگام‌سازی خیلی بزرگ است" }, { status: 413 });
  }

  const stamped = muts.map((m) => ({ ...m, device_id: m.device_id ?? body?.device_id ?? null }));
  /* The impersonator rides along: this is an OFFLINE client, so a write queued in the
     * founder's browser under a driver's name must still record that the founder was there. */
  const results = applyMutations(session.organizationId, session.user.id, stamped, session.actorId);
  return NextResponse.json({ ok: true, results, server_time: new Date().toISOString() });
}
