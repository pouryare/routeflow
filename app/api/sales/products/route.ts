import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { readCatalogue, createProduct } from "@/lib/catalogue";

/** The catalogue is company-wide, so there is no group filter here -- but the role
 *  split is real and worth stating: everyone who sells needs to read a price, and only
 *  the owner sets one. A فروشنده quoting a price is doing their job; a فروشنده changing
 *  one is a different act entirely. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const products = readCatalogue(getDb(), guard.session.organizationId, {
    includeInactive: url.searchParams.get("all") === "1",
    onDate: url.searchParams.get("on") ?? undefined,
  });

  return NextResponse.json({ ok: true, products });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    kg_per_base_unit?: unknown;
    base_unit?: unknown;
    sku?: unknown;
    notes?: unknown;
  } | null;

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ ok: false, error: "نام کالا لازم است" }, { status: 400 });
  }

  const kg = Number(body?.kg_per_base_unit);
  // Zero is allowed -- a product whose weight is not known yet is better recorded than
  // refused. Negative is not: it would pay negative commission on every sale.
  if (!Number.isFinite(kg) || kg < 0) {
    return NextResponse.json(
      { ok: false, error: "وزن هر واحد باید عددی مثبت باشد" },
      { status: 400 }
    );
  }

  try {
    const id = createProduct(getDb(), {
      name,
      kg_per_base_unit: kg,
      organization_id: guard.session.organizationId,
      base_unit: typeof body?.base_unit === "string" ? body.base_unit : undefined,
      sku: typeof body?.sku === "string" ? body.sku : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error && /UNIQUE/.test(e.message) ? "کد کالا تکراری است" : "ثبت کالا ممکن نشد";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
