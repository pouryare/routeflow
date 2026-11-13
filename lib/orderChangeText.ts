/** FB24: the one line a driver reads when an order on their route is changed. Pure.
 *  Example: the delivery day moved to 12 Dey → «موعد تحویل به ۱۲ دی منتقل شد». */
export type ChangedField = "requested_day" | "due_date" | "ship_address" | "notes";

export function orderChangeLine(field: ChangedField, newValueShown: string): string {
  switch (field) {
    case "requested_day": return `موعد تحویل به ${newValueShown} منتقل شد`;
    case "due_date": return "مبلغ و موعد دریافتی تغییر کرد";
    case "ship_address": return "آدرس تحویل تغییر کرد";
    case "notes": return "یادداشت سفارش تغییر کرد";
  }
}
