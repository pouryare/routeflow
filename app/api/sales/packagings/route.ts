import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { addPackaging, productInOrg } from "@/lib/repo/catalogueAdmin";
import { OWNER_ROLES } from "@/lib/roles";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    product_id?: unknown;
    name?: unknown;
    qty_per_pack?: unknown;
    barcode?: unknown;
  } | null;

  const productId = Number(body?.product_id);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const qty = Number(body?.qty_per_pack);

  if (!name) {
    return NextResponse.json({ ok: false, error: "نام بسته‌بندی لازم است" }, { status: 400 });
  }
  // Zero would make every order line weigh nothing and total nothing -- a silent way to
  // record a sale that pays no commission and moves no stock.
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json(
      { ok: false, error: "تعداد در هر بسته باید بزرگ‌تر از صفر باشد" },
      { status: 400 }
    );
  }

  // The product must be this company's: an id alone reaches every tenant's catalogue.
  if (!productInOrg(productId, orgScopeId(guard.session))) {
    return NextResponse.json({ ok: false, error: "کالا پیدا نشد" }, { status: 404 });
  }

  try {
    const id = addPackaging({
      product_id: productId,
      name,
      qty_per_pack: qty,
      barcode: typeof body?.barcode === "string" ? body.barcode : null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    const message =
      e instanceof TypeError
        ? e.message
        : e instanceof Error && /UNIQUE/.test(e.message)
          ? "این بسته‌بندی برای همین کالا قبلاً ثبت شده"
          : "ثبت بسته‌بندی ممکن نشد";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
