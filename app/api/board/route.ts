import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { boardFor } from "@/lib/repo/board";
import type { BoardView } from "@/lib/tasks/lenses";

const VIEWS: BoardView[] = ["status", "time", "workflow"];

/** The manager task Board. owner / group_manager / rep_manager (+ platform_owner);
 *  proxy.ts also gates the path. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "rep_manager", "platform_owner"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const viewParam = sp.get("view") as BoardView | null;
  const view: BoardView = viewParam && VIEWS.includes(viewParam) ? viewParam : "status";
  const kind = sp.get("kind") ?? undefined;
  const gid = sp.get("group_id");
  return NextResponse.json({
    ok: true,
    board: boardFor(guard.session, {
      view,
      kind: view === "workflow" ? kind : undefined,
      groupId: gid ? Number(gid) : undefined,
    }),
  });
}
