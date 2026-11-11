import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { findDomain, removeDomain } from "@/lib/repo/companies";

/** Removes an address; that company's people can no longer sign in on it. */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/companies/[id]/domains/[domainId]">) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const { id, domainId } = await ctx.params;
  return await withDbScope("all", async () => {
    const d = await findDomain(Number(domainId));
    if (!d || d.organization_id !== Number(id)) return NextResponse.json({ ok: false, error: "نشانی پیدا نشد" }, { status: 404 });
    await removeDomain(d.id);
    return NextResponse.json({ ok: true });
  });
}
