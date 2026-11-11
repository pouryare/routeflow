import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { isUniqueViolation } from "@/lib/database/errors";
import { normalizeHostname } from "@/lib/companyHost";
import { addDomain, findDomain, organizationExists } from "@/lib/repo/companies";
import { arvanConfigured } from "@/lib/arvan";
import { setupAddress } from "@/lib/domainSetup";

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** Adds an address to a company. With an Arvan key the Arvan steps run at once; the check moves it on. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/admin/companies/[id]/domains">) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return bad("شرکت نامعتبر است");
  const b = (await req.json().catch(() => null)) as { hostname?: unknown } | null;
  const hostname = normalizeHostname(b?.hostname);
  if (!hostname) return bad("نشانی نامعتبر است؛ مثلاً app.example.ir");
  return await withDbScope("all", async () => {
    if (!(await organizationExists(id))) return bad("شرکت پیدا نشد", 404);
    try {
      const domainId = await addDomain(id, hostname);
      if (arvanConfigured()) {
        const d = await findDomain(domainId);
        if (d) await setupAddress(d); // a failure is stored on the address; the page shows it and offers a retry
      }
      return NextResponse.json({ ok: true, id: domainId }, { status: 201 });
    } catch (e) {
      if (isUniqueViolation(e)) return bad("این نشانی قبلاً ثبت شده است", 409);
      throw e;
    }
  });
}
