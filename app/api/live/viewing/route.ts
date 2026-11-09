import { NextRequest, NextResponse } from "next/server";
import { getSession, orgScopeId } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { isId } from "@/lib/inputChecks";
import { canSeeRecord } from "@/lib/live/visibility";
import { publishEphemeral } from "@/lib/repo/live";
import { leaveViewing, touchViewing, viewersOf, type ViewedType } from "@/lib/repo/liveViewing";

const TYPES: readonly ViewedType[] = ["order", "run", "customer"];

/** "I have this record open" (idea L6), sent by the open page every 20 seconds, and with
 *  `leave: true` when it closes. Answers with everyone who has it open, and tells each of them
 *  the same list on the live stream (topic "viewing"), so their chip changes at once.
 *
 *  Only someone who may see the record can say they are looking at it; the list goes only to the
 *  people looking, who could all see it already. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { type?: unknown; id?: unknown; leave?: unknown } | null;
  const type = body?.type as ViewedType;
  if (!TYPES.includes(type) || !isId(String(body?.id ?? ""))) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const id = Number(body!.id);
  const org = orgScopeId(session);
  if (org == null) return NextResponse.json({ ok: true, me: session.user.id, viewers: [] }); // the founder across every company
  if (!rateLimit(`viewing:${session.user.id}`, 30, 60_000).allowed) return NextResponse.json({ ok: true, me: session.user.id, viewers: [] });
  if (!(await canSeeRecord(session, type, id))) return NextResponse.json({ ok: false, error: "پیدا نشد" }, { status: 404 });

  if (body!.leave === true) await leaveViewing(org, session.user.id, type, id);
  else await touchViewing(org, session.user.id, type, id);
  const viewers = await viewersOf(org, type, id);
  const tell = [...new Set([...viewers.map((v) => v.id), session.user.id])];
  await publishEphemeral(org, { topic: "viewing", users: tell, data: { type, id, viewers } });
  return NextResponse.json({ ok: true, me: session.user.id, viewers });
}
