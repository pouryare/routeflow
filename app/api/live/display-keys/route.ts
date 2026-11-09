import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { checkDisplayInput, createDisplayKey, listDisplayKeys } from "@/lib/repo/liveDisplay";

/** The company owner, with a company picked: display links belong to one company. */
export async function displayOwner(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard;
  const org = orgScopeId(guard.session);
  if (org == null) return { ok: false as const, response: NextResponse.json({ ok: false, error: "اول یک شرکت را انتخاب کنید" }, { status: 400 }) };
  return { ok: true as const, session: guard.session, org };
}

/** The company's display links (idea L9), never their keys. */
export async function GET(req: NextRequest) {
  const g = await displayOwner(req);
  if (!g.ok) return g.response;
  return NextResponse.json({ ok: true, keys: await listDisplayKeys(g.org) });
}

/** Makes a display link for a screen nobody signs in on, such as a warehouse TV. The key is in this
 *  answer only; it is stored as a hash. */
export async function POST(req: NextRequest) {
  const g = await displayOwner(req);
  if (!g.ok) return g.response;
  const input = checkDisplayInput(await req.json().catch(() => null));
  if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });
  if ((await listDisplayKeys(g.org)).filter((k) => !k.revoked_at).length >= 20) {
    return NextResponse.json({ ok: false, error: "هر شرکت حداکثر ۲۰ پیوند نمایشگر فعال دارد" }, { status: 400 });
  }
  const { id, key } = await createDisplayKey(g.org, input.label, input.topics, g.session.user.id);
  return NextResponse.json({ ok: true, id, key, url: `/api/live?display=${encodeURIComponent(key)}` }, { status: 201 });
}
