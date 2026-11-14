import { NextRequest, NextResponse } from "next/server";
import { requireRole, canReachGroup, orgScopeId } from "@/lib/session";
import { findCustomerInOrg } from "@/lib/repo/orgRefs";
import { DoorSaleError, sellAtDoor } from "@/lib/repo/doorSale";
import { parseDoorRequest } from "@/lib/doorSaleRequest";

/** A sale from the van at the customer's door: order, delivery and payment in one go (VC4).
 *  Safe to resend with the same `client_uuid`: the second call answers with the first sale. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const session = guard.session;

  const parsed = parseDoorRequest(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  // 404, not 403, for a customer outside the person's reach: a 403 would confirm the shop exists.
  const customer = await findCustomerInOrg(parsed.value.customer_id, orgScopeId(session));
  if (!customer || !(await canReachGroup(session, customer.group_id))) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  try {
    const result = await sellAtDoor(
      session.organizationId,
      { id: session.user.id, canDrive: session.hasRole("delivery_driver") },
      { customer_id: customer.id, lines: parsed.value.lines, collected_toman: parsed.value.collected_toman, client_uuid: parsed.value.client_uuid, note: parsed.value.note },
    );
    return NextResponse.json({ ok: true, ...result }, { status: result.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof DoorSaleError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
