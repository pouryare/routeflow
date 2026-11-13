import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { isId } from "@/lib/inputChecks";
import { canSeeRecord } from "@/lib/live/visibility";
import { CHAT_ROLES, cleanBody, isChatRecord } from "@/lib/chat";
import { markRead, postMessage, threadOf, unreadIn } from "@/lib/repo/chat";

const bad = () => NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
const notFound = () => NextResponse.json({ ok: false, error: "پیدا نشد" }, { status: 404 });

/** FB9: the thread on an order or a customer. `?unread=1` gives only the unread count; `?after=<id>` the newer messages. Reading marks the thread read. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/chat/[type]/[id]">) {
  const guard = await requireRole(req, CHAT_ROLES);
  if (!guard.ok) return guard.response;
  const { type, id } = await ctx.params;
  if (!isChatRecord(type) || !isId(id)) return bad();
  if (!(await canSeeRecord(guard.session, type, Number(id)))) return notFound();
  if (req.nextUrl.searchParams.get("unread")) return NextResponse.json({ ok: true, unread: await unreadIn(guard.session, type, Number(id)) });
  const after = req.nextUrl.searchParams.get("after");
  if (after !== null && !isId(after)) return bad();
  const messages = await threadOf(guard.session.organizationId, type, Number(id), after === null ? null : Number(after));
  if (messages.length > 0) await markRead(guard.session, type, Number(id), messages[messages.length - 1].id);
  return NextResponse.json({ ok: true, messages, me: guard.session.user.id });
}

/** FB9: write in the thread { body, clientKey? }. Anyone who may see the record may write. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/chat/[type]/[id]">) {
  const guard = await requireRole(req, CHAT_ROLES);
  if (!guard.ok) return guard.response;
  const { type, id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { body?: unknown; clientKey?: unknown } | null;
  const body = cleanBody(b?.body);
  const key = typeof b?.clientKey === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(b.clientKey) ? b.clientKey : null;
  if (!isChatRecord(type) || !isId(id) || !body) return bad();
  if (!(await canSeeRecord(guard.session, type, Number(id)))) return notFound();
  return NextResponse.json({ ok: true, id: await postMessage(guard.session, type, Number(id), body, key) });
}
