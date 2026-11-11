import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { normalizeHostname } from "@/lib/companyHost";
import { findDomain, removeDomain, setArvanCname } from "@/lib/repo/companies";

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

/** { arvan_cname }: the CNAME value Arvan gave for this address (empty clears it). */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/companies/[id]/domains/[domainId]">) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const { id, domainId } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { arvan_cname?: unknown } | null;
  const raw = typeof b?.arvan_cname === "string" ? b.arvan_cname.trim() : null;
  const value = raw ? normalizeHostname(raw) : null;
  if (raw === null || (raw && !value)) return NextResponse.json({ ok: false, error: "مقدار CNAME نامعتبر است؛ مثلاً abc123.cname.arvancdn.ir" }, { status: 400 });
  return await withDbScope("all", async () => {
    const d = await findDomain(Number(domainId));
    if (!d || d.organization_id !== Number(id)) return NextResponse.json({ ok: false, error: "نشانی پیدا نشد" }, { status: 404 });
    await setArvanCname(d.id, value);
    return NextResponse.json({ ok: true });
  });
}
