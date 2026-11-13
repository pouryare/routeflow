import { NextRequest, NextResponse } from "next/server";
import { orderFilter, orgScopeId, requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { exportWorkbook } from "@/lib/repo/dataIO";
import { ordersForExport } from "@/lib/repo/salesWrites";
import { emitEvent } from "@/lib/repo/events";
import { guardStepUp } from "@/lib/repo/stepUp";

/** F34: the whole company as one Excel file (customers, products, prices, orders, payments). Owner only: a file
 *  is the easiest way out for a whole table, so every download leaves an event for the history. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const stepUp = await guardStepUp(req, guard.session, "export_customers");
  if (stepUp) return stepUp;
  const org = orgScopeId(guard.session);
  if (org === null) return NextResponse.json({ ok: false, error: "ابتدا یک شرکت را انتخاب کنید" }, { status: 400 });

  const book = await exportWorkbook(org, await ordersForExport(orderFilter(guard.session)));
  await emitEvent(org, { kind: "data.exported", entity_type: "organization", entity_id: org, actor_user_id: guard.session.user.id });
  const buffer = await book.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="routeflow-data-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
