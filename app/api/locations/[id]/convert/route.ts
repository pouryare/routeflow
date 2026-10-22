import { NextRequest, NextResponse } from "next/server";
import { findOwnLocation } from "@/lib/repo/locationsAdmin";
import { canReachGroup, orgScopeId, requireRole } from "@/lib/session";
import { LeadPromotionError, promoteLeadToCustomer } from "@/lib/repo/crm/conversion";
import { PIN_POOL_ROLES } from "@/lib/roles";

// Promotes a prospect into the real customers table.
//
// This used to insert the row here and then DELETE the saved_locations row, on the
// reasonable-sounding ground that a promoted venue is not a prospect any more. But
// lead_list_items.location_id is ON DELETE CASCADE, so the delete quietly removed the stop
// from every route that referenced it -- including the run the driver was standing on when
// the office pressed the button. The pin now stays and the customer points back at it via
// customers.lead_location_id, which is also what lets the leads pool ask "is this still a
// lead?" without a second flag that could disagree.
//
// The promotion itself moved into lib/repo/crm/conversion.ts so that this route and a
// lead's first purchase are the same operation, dedup guard and all, rather than two
// implementations that drift.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/locations/[id]/convert">) {
  const guard = requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const idNum = Number(id);
  if (!Number.isInteger(idNum)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const owning = findOwnLocation(idNum, orgScopeId(guard.session));
  if (!owning || !canReachGroup(guard.session, owning.group_id)) {
    return NextResponse.json({ ok: false, error: "مکان پیدا نشد" }, { status: 404 });
  }

  try {
    const promotion = promoteLeadToCustomer(guard.session.organizationId, idNum, guard.session);
    return NextResponse.json({
      ok: true,
      customerId: promotion.customerId,
      // False means this pin was already promoted, or matched a customer that already
      // existed. Either way there is now exactly one customer for this business.
      created: promotion.created,
      linked: promotion.linked,
    });
  } catch (e) {
    if (e instanceof LeadPromotionError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "خطا";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
