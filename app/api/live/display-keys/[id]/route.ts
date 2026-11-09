import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { revokeDisplayKey } from "@/lib/repo/liveDisplay";
import { displayOwner } from "../route";

/** Revokes a display link: its open screens close at once and it is refused from then on. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/live/display-keys/[id]">) {
  const g = await displayOwner(req);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  if (!(await revokeDisplayKey(g.org, Number(id)))) return NextResponse.json({ ok: false, error: "پیوند پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
