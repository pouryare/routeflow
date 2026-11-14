import { NextRequest } from "next/server";
import { requireRole, orderFilter } from "@/lib/session";
import { ordersToWorkbook, EXPORT_BACKGROUND_ROWS } from "@/lib/ordersExport";
import { createExportJob } from "@/lib/repo/exportJobs";
import { ordersForExport } from "@/lib/repo/salesWrites";
import { MANAGE_ROLES } from "@/lib/roles";

/** The orders, as a spreadsheet.
 *
 *  Worth having from the first slice rather than as a later nicety: people are coming
 *  off a workbook, and a system they cannot get their own numbers back out of is a
 *  system they will keep a parallel copy of. exceljs is already a dependency.
 *
 *  Scoped by the same orderFilter as everything else -- an export is the easiest place
 *  in an app to leak a whole table, because it looks like a file rather than a query.
 *
 *  Dates are written as Jalali text rather than as Excel dates. Excel has no Persian
 *  calendar, so a real date cell would display Gregorian to whoever opens it and quietly
 *  contradict every screen it was exported from.
 */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const scope = orderFilter(guard.session);
  const orders = await ordersForExport(scope);

  /* E7: past about 1,000 rows the file is built on the worker; the person is told when it is ready. */
  if (orders.length > EXPORT_BACKGROUND_ROWS) {
    const id = await createExportJob({ organizationId: guard.session.organizationId, userId: guard.session.user.id, scope, total: orders.length });
    return Response.json({ ok: true, queued: true, job_id: id, total: orders.length }, { status: 202 });
  }

  const buffer = await ordersToWorkbook(orders);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-${stamp}.xlsx"`,
      // An export is a snapshot of a moving table; a cached one is a wrong one.
      "Cache-Control": "no-store",
    },
  });
}
