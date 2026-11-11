import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { findDomain } from "@/lib/repo/companies";
import { arvanConfigured } from "@/lib/arvan";
import { setupAddress } from "@/lib/domainSetup";

/** Does the Arvan steps for this address (add the domain, A record to our server, HTTPS) and records the result. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/companies/[id]/domains/[domainId]/arvan">) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  if (!arvanConfigured()) return NextResponse.json({ ok: false, error: "کلید آروان روی سرور تنظیم نشده است (ARVAN_API_KEY)" }, { status: 409 });
  const { id, domainId } = await ctx.params;
  return await withDbScope("all", async () => {
    const d = await findDomain(Number(domainId));
    if (!d || d.organization_id !== Number(id)) return NextResponse.json({ ok: false, error: "نشانی پیدا نشد" }, { status: 404 });
    const r = await setupAddress(d);
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, error: r.error }, { status: r.ok ? 200 : 502 });
  });
}
