import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { addPrice, packagingOfProduct, productInOrg } from "@/lib/repo/catalogueAdmin";
import { isToman } from "@/lib/money";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp } from "@/lib/repo/stepUp";

/** Setting a price is an INSERT, never an update. There is no PATCH or DELETE on this
 *  route, and that absence is the feature: a price row that could be edited would take
 *  every order priced from it with it. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const stepUp = await guardStepUp(req, guard.session, "price_change");
  if (stepUp) return stepUp;

  const body = (await req.json().catch(() => null)) as {
    product_id?: unknown;
    packaging_id?: unknown;
    price_toman?: unknown;
    valid_from?: unknown;
  } | null;

  const productId = Number(body?.product_id);
  const price = Number(body?.price_toman);
  const validFrom = typeof body?.valid_from === "string" ? body.valid_from : "";

  if (!isToman(price) || price < 0) {
    return NextResponse.json(
      { ok: false, error: "قیمت باید عدد صحیح تومان باشد" },
      { status: 400 }
    );
  }

  // The UI sends an ISO date it converted from the Jalali picker. Rejecting anything
  // else here is what stops «۱۴۰۵/۰۶/۰۴» reaching a column every date comparison in the
  // app assumes is ISO -- where it would not error, it would just never match.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(Date.parse(validFrom))) {
    return NextResponse.json(
      { ok: false, error: "تاریخ شروع قیمت معتبر نیست" },
      { status: 400 }
    );
  }

  // The product must be this company's: an id alone reaches every tenant's catalogue.
  if (!await productInOrg(productId, orgScopeId(guard.session))) {
    return NextResponse.json({ ok: false, error: "کالا پیدا نشد" }, { status: 404 });
  }

  const packagingId = body?.packaging_id === undefined || body?.packaging_id === null
    ? null
    : Number(body.packaging_id);
  if (packagingId !== null) {
    if (!await packagingOfProduct(packagingId, productId)) {
      return NextResponse.json({ ok: false, error: "بسته‌بندی پیدا نشد" }, { status: 404 });
    }
  }

  const id = await addPrice({
    product_id: productId,
    packaging_id: packagingId,
    price_toman: price,
    valid_from: validFrom,
    created_by: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}
