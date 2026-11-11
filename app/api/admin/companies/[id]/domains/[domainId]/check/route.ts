import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { findDomain, setDomainStatus } from "@/lib/repo/companies";
import { checkDomain } from "@/lib/domainCheck";
import { arvanConfigured, arvanState } from "@/lib/arvan";

/** Looks at the address from outside (DNS, then the app's own health answer) and records how far it has got. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/companies/[id]/domains/[domainId]/check">) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const { id, domainId } = await ctx.params;
  const d = await withDbScope("all", () => findDomain(Number(domainId)));
  if (!d || d.organization_id !== Number(id)) return NextResponse.json({ ok: false, error: "نشانی پیدا نشد" }, { status: 404 });
  const arvan = arvanConfigured() ? await arvanState(d.hostname).catch(() => null) : null;
  const result = await checkDomain(d.hostname, d.arvan_cname, arvan);
  await withDbScope("all", () => setDomainStatus(d.id, result.status, result.error));
  return NextResponse.json({ ok: true, ...result });
}
