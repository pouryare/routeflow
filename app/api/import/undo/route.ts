import { NextRequest, NextResponse } from "next/server";
import { undoLastImport } from "@/lib/importExcel";
import { getDb } from "@/lib/db";
import { recomputeCustomerGroups } from "@/lib/groups";
import { requireRole } from "@/lib/session";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const result = await undoLastImport();
  if (!result.ok) {
    return NextResponse.json(result, { status: 422 });
  }
  // Rolling an import back restores the previous customer rows, so territory has to be
  // reapplied to them for the same reason it is applied after an import.
  recomputeCustomerGroups(getDb());
  return NextResponse.json(result);
}
