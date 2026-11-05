import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { storageOwner, bad } from "@/lib/storage/routeGuard";
import { closeMove } from "@/lib/storage/maintenance";

/** Closes a finished move; `delete_old` removes the copies left in the old storage (decision 9). */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/storages/moves/[id]">) {
  const body = (await req.clone().json().catch(() => null)) as { delete_old?: unknown } | null;
  const g = await storageOwner(req, body?.delete_old === true);
  if (!g.ok) return g.response;
  const { id } = await ctx.params;
  if (!isId(id)) return bad("شناسه نامعتبر است");
  if (!await closeMove(g.org, Number(id), body?.delete_old === true)) return bad("این انتقال هنوز تمام نشده", 409);
  return NextResponse.json({ ok: true });
}
