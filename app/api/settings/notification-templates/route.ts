import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { setTemplate } from "@/lib/repo/notificationTemplates";

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

/** F136: { type_code, title, body } saves the company's own wording; title null restores the shipped text. Owner only. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { type_code?: unknown; title?: unknown; body?: unknown } | null;
  if (typeof b?.type_code !== "string" || (b.title !== null && typeof b.title !== "string") || (b.body != null && typeof b.body !== "string")) return bad("درخواست نامعتبر است");
  const refused = await setTemplate(guard.session.organizationId, b.type_code, b.title as string | null, (b.body as string | null | undefined) ?? null, guard.session.user.id);
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}
