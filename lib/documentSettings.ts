/** A13: the company's footer text per printed paper and its order number prefix. Pure. */

export interface DocumentSettings {
  receiptFooter: string | null;
  deliveryNoteFooter: string | null;
  orderPrefix: string | null;
}

export const DEFAULT_RECEIPT_FOOTER = "با تشکر از خرید شما";
const FOOTER_MAX = 160;

/** Up to four Latin capitals. Latin for the same reason the number is (lib/orderMath.ts: it is typed
 *  into search boxes), and no dash, because screens read the sequence as `order_no.split("-")[1]`. */
const PREFIX = /^[A-Z]{1,4}$/;

/** The settings from a request body, or the reason they are refused. Blank text means "use the default". */
export function parseDocumentSettings(body: unknown): DocumentSettings | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const receiptFooter = text(b.receiptFooter);
  const deliveryNoteFooter = text(b.deliveryNoteFooter);
  const orderPrefix = text(b.orderPrefix)?.toUpperCase() ?? null;
  if ((receiptFooter?.length ?? 0) > FOOTER_MAX || (deliveryNoteFooter?.length ?? 0) > FOOTER_MAX) {
    return `متن پایین برگه حداکثر ${FOOTER_MAX.toLocaleString("fa-IR")} حرف است`;
  }
  if (orderPrefix && !PREFIX.test(orderPrefix)) return "پیشوند شمارهٔ سفارش فقط ۱ تا ۴ حرف لاتین بزرگ است، مثل RF";
  return { receiptFooter, deliveryNoteFooter, orderPrefix };
}
