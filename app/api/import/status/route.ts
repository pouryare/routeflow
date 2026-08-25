import { NextRequest, NextResponse } from "next/server";
import { getUndoStatus, getLastImportStatus } from "@/lib/importExcel";
import { requireRole } from "@/lib/session";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  return NextResponse.json({
    ok: true,
    lastImport: getLastImportStatus(),
    undo: getUndoStatus(),
  });
}
