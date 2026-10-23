import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { objectionCardFor, listObjectionCards, upsertObjectionCard } from "@/lib/repo/academy";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const code = sp.get("outcome_code");
  const type = sp.get("customer_type") ?? undefined;
  if (code) {
    return NextResponse.json({
      ok: true,
      card: await objectionCardFor(guard.session.organizationId, code, type) ?? null,
    });
  }
  return NextResponse.json({ ok: true, cards: await listObjectionCards(guard.session.organizationId) });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.outcome_code || !b?.title_fa || !b?.script_fa) {
    return NextResponse.json({ ok: false, error: "کد، عنوان و متن لازم است" }, { status: 400 });
  }
  await upsertObjectionCard(guard.session.organizationId, {
    outcome_code: String(b.outcome_code),
    customer_type: (b.customer_type as string | null) ?? null,
    title_fa: String(b.title_fa),
    script_fa: String(b.script_fa),
    module_slug: (b.module_slug as string | null) ?? null,
    active: b.active !== false,
  });
  return NextResponse.json({ ok: true });
}
