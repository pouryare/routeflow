import { NextRequest, NextResponse } from "next/server";
import { requireRole, canReachGroup, orgScopeId } from "@/lib/session";
import { findCustomerInOrg } from "@/lib/repo/orgRefs";
import { DoorSaleError, giveSamples } from "@/lib/repo/doorSale";
import { parseDoorRequest } from "@/lib/doorSaleRequest";

/** A free sample handed over from the van (F52). Safe to resend with the same `client_uuid`. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const parsed = parseDoorRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const customer = await findCustomerInOrg(parsed.value.customer_id, orgScopeId(session));
  if (!customer || !(await canReachGroup(session, customer.group_id))) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  try {
    const result = await giveSamples(session.organizationId, { id: session.user.id }, {
      customer_id: customer.id, lines: parsed.value.lines, client_uuid: parsed.value.client_uuid, note: parsed.value.note,
    });
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof DoorSaleError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
