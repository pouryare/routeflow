import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { isId } from "@/lib/inputChecks";
import { markCollected } from "@/lib/repo/pickups";

/** F118: the driver ticks that the goods at a pickup stop of their own run were collected. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const refused = await markCollected(guard.session.organizationId, guard.session.user.id, Number(id));
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 404 }) : NextResponse.json({ ok: true });
}
