import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { claimBusiness } from "@/lib/repo/crm/write";
import { crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/claim">) {
  const guard = requireRole(req, ["phone_sales"]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  try {
    claimBusiness(guard.session, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return crmErrorResponse(e);
  }
}
