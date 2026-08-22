import { NextResponse } from "next/server";
import { getUndoStatus, getLastImportStatus } from "@/lib/importExcel";

export async function GET() {
  return NextResponse.json({
    ok: true,
    lastImport: getLastImportStatus(),
    undo: getUndoStatus(),
  });
}
