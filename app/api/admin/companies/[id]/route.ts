import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { withDbScope } from "@/lib/database/scope";
import { updateCompany } from "@/lib/repo/companies";
import { parseLogo } from "@/lib/companyInput";

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

/** Edit a company: its name, logo (null removes it) or whether it is active. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/companies/[id]">) {
  const guard = await requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard.response;
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) return bad("شرکت نامعتبر است");
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return bad("درخواست نامعتبر است");

  const f: Parameters<typeof updateCompany>[1] = {};
  if (b.name !== undefined) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 80) return bad("نام شرکت الزامی است و حداکثر ۸۰ نویسه");
    f.name = name;
  }
  if (b.active !== undefined) {
    if (typeof b.active !== "boolean") return bad("درخواست نامعتبر است");
    // The company the founder signs in under cannot be switched off from here, or nobody could undo it.
    if (!b.active && id === guard.session.user.organization_id) return bad("شرکتی که خودتان در آن هستید را نمی‌توان غیرفعال کرد", 409);
    f.active = b.active;
  }
  if (b.logo !== undefined) {
    if (b.logo === null) f.logo = "remove";
    else {
      const logo = parseLogo(b.logo);
      if (logo && "error" in logo) return bad(logo.error);
      if (logo) f.logo = logo;
    }
  }
  const found = await withDbScope("all", () => updateCompany(id, f));
  return found ? NextResponse.json({ ok: true }) : bad("شرکت پیدا نشد", 404);
}
