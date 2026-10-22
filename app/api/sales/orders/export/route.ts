import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/orderStateMachine";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireRole, orderFilter } from "@/lib/session";
import { ordersForExport } from "@/lib/repo/salesWrites";
import { faJalaliDate } from "@/lib/jalali";
import { MANAGE_ROLES } from "@/lib/roles";

/* ORDER_STATUS_LABEL, not a local map: a local one keyed `draft`/`delivered` never
   matched the real, uppercase statuses and printed «DELIVERED» to Persian readers. */
const STATUS_LABEL = ORDER_STATUS_LABEL as Record<string, string>;

const PAYMENT_LABEL = PAYMENT_STATUS_LABEL as Record<string, string>;

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
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const orders = ordersForExport(orderFilter(guard.session));

  const book = new ExcelJS.Workbook();
  book.creator = "routeflow";
  book.created = new Date();
  const sheet = book.addWorksheet("سفارش‌ها", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "شماره سفارش", key: "order_no", width: 16 },
    { header: "تاریخ", key: "order_date", width: 14 },
    { header: "مشتری", key: "customer", width: 32 },
    { header: "فروشنده", key: "phone_sales", width: 16 },
    { header: "وضعیت", key: "status", width: 14 },
    { header: "پرداخت", key: "payment", width: 14 },
    { header: "تعداد اقلام", key: "lines", width: 12 },
    { header: "وزن (کیلوگرم)", key: "kg", width: 14 },
    { header: "مبلغ (تومان)", key: "total", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const order of orders) {
    sheet.addRow({
      order_no: order.order_no,
      order_date: faJalaliDate(order.order_date),
      customer: order.customer_name,
      salesperson: order.salesperson_name ?? "",
      status: STATUS_LABEL[order.status] ?? "نامشخص",
      payment: PAYMENT_LABEL[order.payment_status] ?? "نامشخص",
      lines: order.line_count,
      kg: order.kg,
      total: order.total_toman,
    });
  }

  sheet.getColumn("total").numFmt = "#,##0";
  sheet.getColumn("kg").numFmt = "#,##0.##";

  const buffer = await book.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-${stamp}.xlsx"`,
      // An export is a snapshot of a moving table; a cached one is a wrong one.
      "Cache-Control": "no-store",
    },
  });
}
