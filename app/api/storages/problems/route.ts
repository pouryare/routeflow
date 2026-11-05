import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { allStorageProblems } from "@/lib/repo/storages";

/** Every company's storage problems on one list, for the platform owner (decision 19). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const problems = await withDbScope("all", allStorageProblems);
  return NextResponse.json({ ok: true, problems });
}
