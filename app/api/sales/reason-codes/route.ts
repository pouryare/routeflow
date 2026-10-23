import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listReasonCodes, createReasonCode, ReasonCodeError, type ReasonDomain } from "@/lib/repo/reasonCodes";
import { MANAGE_ROLES } from "@/lib/roles";

const DOMAINS: ReasonDomain[] = ["delivery_fail", "delivery_delay", "order_cancel", "order_return"];

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const d = req.nextUrl.searchParams.get("domain");
  const domain = DOMAINS.includes(d as ReasonDomain) ? (d as ReasonDomain) : undefined;
  return NextResponse.json({
    ok: true,
    reason_codes: await listReasonCodes(guard.session.organizationId, domain),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as {
    domain?: string;
    code?: string;
    label_fa?: string;
  } | null;
  if (!body?.domain || !DOMAINS.includes(body.domain as ReasonDomain) || !body.code || !body.label_fa) {
    return NextResponse.json({ ok: false, error: "دسته، کد و برچسب لازم است" }, { status: 400 });
  }
  try {
    const id = await createReasonCode(guard.session.organizationId, {
      domain: body.domain as ReasonDomain,
      code: body.code,
      label_fa: body.label_fa,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof ReasonCodeError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
