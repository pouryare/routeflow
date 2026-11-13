import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES, isVanRole } from "@/lib/roles";
import { deleteView, saveView, ViewError } from "@/lib/repo/savedViews";

/** Everyone who reads the orders list (every role but the van roles and a shareholder). */
const LIST_ROLES = ROLES.filter((r) => !isVanRole(r) && r !== "shareholder");

/** FB6: POST { name, query } saves a view; { id, query } changes the filter of your own view. DELETE ?id= removes yours. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, LIST_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { id?: unknown; name?: unknown; query?: unknown } | null;
  if (typeof b?.query !== "string") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  try {
    const id = await saveView(guard.session.organizationId, guard.session.user.id, { id: typeof b.id === "number" ? b.id : undefined, name: typeof b.name === "string" ? b.name : undefined, query: b.query });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof ViewError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(req, LIST_ROLES);
  if (!guard.ok) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  await deleteView(guard.session.organizationId, guard.session.user.id, id);
  return NextResponse.json({ ok: true });
}
