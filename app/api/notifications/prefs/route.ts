import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPrefsMatrix, setPref, NotifInputError } from "@/lib/repo/notifications";

// Byte-identical to GET /api/notifications: every signed-in role owns its own settings
// screen. `platform_owner` first -- omitting it puts that role in a permanent 403.
const ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

/** The settings screen's whole payload for the caller: the two channel states plus every
 *  catalogue type with its effective push/telegram flags. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { organizationId, user } = guard.session;
  // `getPrefsMatrix` trusts its orgId argument -- it must come from the signed session,
  // never from the request, or one tenant could read another's catalogue overrides.
  return NextResponse.json({ ok: true, ...getPrefsMatrix(user.id, organizationId) });
}

/** Flip one (type, channel) pref for the caller. `setPref` deletes the row again when the
 *  value matches the catalogue default, so "back to default" is the same call. */
export async function PUT(req: NextRequest) {
  const guard = requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { user } = guard.session;

  const body = (await req.json().catch(() => null)) as {
    type_code?: unknown;
    channel?: unknown;
    enabled?: unknown;
  } | null;

  const typeCode = body?.type_code;
  const channel = body?.channel;
  const enabled = body?.enabled;
  if (typeof typeCode !== "string" || !typeCode) {
    return NextResponse.json({ ok: false, error: "نوع اعلان ناشناخته است" }, { status: 400 });
  }
  if (channel !== "push" && channel !== "telegram") {
    return NextResponse.json({ ok: false, error: "کانال نامعتبر است" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "مقدار enabled نامعتبر است" }, { status: 400 });
  }

  try {
    setPref(user.id, typeCode, channel, enabled);
  } catch (e) {
    // NotifInputError carries an already-Persian message (unknown type / bad channel).
    if (e instanceof NotifInputError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
}
