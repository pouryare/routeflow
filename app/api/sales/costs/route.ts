import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { isToman } from "@/lib/money";
import { OWNER_ROLES } from "@/lib/roles";
import { addCost, costTargetsInOrg } from "@/lib/repo/salesWrites";

/** Recording a cost override. POST only -- there is no PATCH and no DELETE, and that
 *  absence is the feature, exactly as on /api/sales/prices: a cost row that could be
 *  edited would take every order priced from it with it.
 *
 *  Prices are NOT written here. `POST /api/sales/prices` stays the only way a price
 *  enters the system, so there is one path to price history and the owner still submits
 *  through the form they already know. This route exists because a landed cost is new
 *  data with nowhere else to live -- `CatalogueEditor` has no field for it.
 *
 *  TENANCY. `product_costs` carries no `organization_id` of its own (it reaches a tenant
 *  through `products`, like `product_prices` and `packagings` do), so the product lookup
 *  below is the ONLY thing preventing a cross-tenant write. It filters on the session's
 *  own organisation, not merely on "a product with this id exists" -- without that
 *  clause an owner of tenant 1 could set the cost of tenant 2's product by guessing its
 *  id. That test lives in tests/api/product-costs-route.test.ts. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    product_id?: unknown;
    packaging_id?: unknown;
    method?: unknown;
    cost_toman?: unknown;
    valid_from?: unknown;
  } | null;

  const productId = Number(body?.product_id);
  const cost = Number(body?.cost_toman);
  const validFrom = typeof body?.valid_from === "string" ? body.valid_from : "";
  const method = body?.method;

  if (!isToman(cost) || cost < 0) {
    return NextResponse.json(
      { ok: false, error: "بهای تمام‌شده باید عدد صحیح تومان باشد" },
      { status: 400 }
    );
  }

  // 'lifo' and 'fifo' are refused rather than stored. Batches here carry real expiry
  // dates and are consumed FEFO, so a costing method keyed on purchase order would
  // describe a system this one is not -- accepting the value would create a row that
  // reads as meaningful and means nothing.
  if (method !== "weighted_average" && method !== "landed") {
    return NextResponse.json(
      { ok: false, error: "روش بها فقط میانگین متحرک یا تمام‌شده است" },
      { status: 400 }
    );
  }

  // The UI sends an ISO date it converted from the Jalali picker. Rejecting anything else
  // here is what stops «۱۴۰۵/۰۶/۰۴» reaching a column every date comparison in the app
  // assumes is ISO -- where it would not error, it would just never match.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(Date.parse(validFrom))) {
    return NextResponse.json(
      { ok: false, error: "تاریخ شروع بها معتبر نیست" },
      { status: 400 }
    );
  }

  /* The tenancy join lives in lib/repo/productCosts.ts, not here: `product_costs` carries no
   * organization_id of its own, so filtering on the session's organisation is the ONLY thing preventing
   * a cross-tenant write, and one auditable place is better than one scattered across routes. */
  const packagingId =
    body?.packaging_id === undefined || body?.packaging_id === null
      ? null
      : Number(body.packaging_id);
  const target = costTargetsInOrg(productId, packagingId, guard.session.organizationId);
  if (target === "no-product") {
    return NextResponse.json({ ok: false, error: "کالا پیدا نشد" }, { status: 404 });
  }
  if (target === "no-packaging") {
    return NextResponse.json({ ok: false, error: "بسته‌بندی پیدا نشد" }, { status: 404 });
  }

  const id = addCost({
    product_id: productId,
    packaging_id: packagingId,
    method,
    cost_toman: cost,
    valid_from: validFrom,
    created_by: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
