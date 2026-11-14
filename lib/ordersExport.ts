import ExcelJS from "exceljs";
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL } from "@/lib/orderStateMachine";
import { faJalaliDate } from "@/lib/jalali";
import type { OrderSummary } from "@/lib/orders";

/** Above this many rows an export is built on the worker (E7). */
export const EXPORT_BACKGROUND_ROWS = 1000;

/* ORDER_STATUS_LABEL, not a local map: a local one keyed `draft`/`delivered` never
   matched the real, uppercase statuses and printed «DELIVERED» to Persian readers. */
const STATUS_LABEL = ORDER_STATUS_LABEL as Record<string, string>;
const PAYMENT_LABEL = PAYMENT_STATUS_LABEL as Record<string, string>;

/** The orders as a spreadsheet. Dates are Jalali text: Excel has no Persian calendar, so a real
 *  date cell would show Gregorian to whoever opens it and contradict every screen. */
export async function ordersToWorkbook(orders: OrderSummary[], onProgress?: (done: number) => Promise<void>): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "routeflow";
  book.created = new Date();
  const sheet = book.addWorksheet("سفارش‌ها", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "شماره سفارش", key: "order_no", width: 16 },
    { header: "تاریخ", key: "order_date", width: 14 },
    { header: "مشتری", key: "customer", width: 32 },
    { header: "فروشنده", key: "salesperson", width: 16 },
    { header: "وضعیت", key: "status", width: 14 },
    { header: "پرداخت", key: "payment", width: 14 },
    { header: "تعداد اقلام", key: "lines", width: 12 },
    { header: "وزن (کیلوگرم)", key: "kg", width: 14 },
    { header: "مبلغ (تومان)", key: "total", width: 18 },
  ];
  sheet.getRow(1).font = { bold: true };
  let n = 0;
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
    if (onProgress && ++n % 500 === 0) await onProgress(n);
  }
  sheet.getColumn("total").numFmt = "#,##0";
  sheet.getColumn("kg").numFmt = "#,##0.##";
  return Buffer.from(await book.xlsx.writeBuffer());
}
