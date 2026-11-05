import { NextRequest, NextResponse } from "next/server";
import { storageOwner } from "@/lib/storage/routeGuard";
import { listTrash } from "@/lib/repo/storages";

/** Files deleted in the last 30 days (decision 12). A deleted photo can be put back; a replaced
 *  receipt or avatar can only be looked at. */
export async function GET(req: NextRequest) {
  const g = await storageOwner(req);
  if (!g.ok) return g.response;
  const rows = await listTrash(g.org);
  return NextResponse.json({
    ok: true,
    files: rows.map(({ trash_ref, ...r }) => ({ ...r, restorable: !!trash_ref && JSON.parse(trash_ref).table === "photos" })),
  });
}
