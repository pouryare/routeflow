import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { putChannelState, NotifInputError } from "@/lib/repo/notifications";

const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

/** The keys `putChannelState` patches. Its own `ChannelPatch` type is module-private, so
 *  this structurally-identical literal type is what the route builds. */
type ChannelPatchBody = {
  enabled?: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
  critical_breaks_quiet?: boolean;
};

/** Master switch + quiet-hours window for one of the caller's channels. Only the keys
 *  actually present in the body are patched -- `putChannelState` fills the rest with the
 *  spec defaults on a first write and leaves them alone afterwards. */
export async function PUT(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { user } = guard.session;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const channel = body.channel;
  if (channel !== "push" && channel !== "telegram") {
    return NextResponse.json({ ok: false, error: "کانال نامعتبر است" }, { status: 400 });
  }

  const patch: ChannelPatchBody = {};
  for (const key of ["enabled", "critical_breaks_quiet"] as const) {
    if (key in body) {
      if (typeof body[key] !== "boolean") {
        return NextResponse.json({ ok: false, error: "مقدار نامعتبر است" }, { status: 400 });
      }
      patch[key] = body[key] as boolean;
    }
  }
  for (const key of ["quiet_start", "quiet_end"] as const) {
    if (key in body) {
      const v = body[key];
      // null clears the bound; the HH:MM shape itself is putChannelState's to reject.
      if (v !== null && typeof v !== "string") {
        return NextResponse.json({ ok: false, error: "زمان نامعتبر است" }, { status: 400 });
      }
      patch[key] = v as string | null;
    }
  }

  try {
    putChannelState(user.id, channel, patch);
  } catch (e) {
    if (e instanceof NotifInputError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
