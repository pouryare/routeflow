import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { setPlatformSetting } from "@/lib/repo/companyDomains";

/** { owner_only: boolean }: close the main address to everyone but platform owners (or open it again). */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { owner_only?: unknown } | null;
  if (typeof b?.owner_only !== "boolean") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  await withDbScope("all", () => setPlatformSetting("main_address_owner_only", b.owner_only ? "1" : "0"));
  return NextResponse.json({ ok: true });
}
