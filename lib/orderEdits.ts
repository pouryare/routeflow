/** F48 + F73: the details of a confirmed order a manager may change, and how each value is checked. Pure. */

export const ORDER_DETAIL_FIELDS = [
  { id: "requested_day", label: "روز تحویل", kind: "date" },
  { id: "due_date", label: "سررسید", kind: "date" },
  { id: "ship_address", label: "آدرس", kind: "text", max: 300 },
  { id: "notes", label: "یادداشت", kind: "text", max: 500 },
] as const;
export type OrderDetailField = (typeof ORDER_DETAIL_FIELDS)[number]["id"];
export const isOrderDetailField = (v: unknown): v is OrderDetailField => ORDER_DETAIL_FIELDS.some((f) => f.id === v);
export const detailLabel = (f: OrderDetailField): string => ORDER_DETAIL_FIELDS.find((x) => x.id === f)!.label;

/** Requests nobody answers lapse after this many days. */
export const REQUEST_EXPIRY_DAYS = 3;

/** The value to store, or the reason it is refused. A date is an ISO day; text is trimmed. */
export function checkDetail(field: OrderDetailField, raw: unknown): { ok: true; value: string } | { ok: false; why: string } {
  const def = ORDER_DETAIL_FIELDS.find((f) => f.id === field)!;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { ok: false, why: "مقدار تازه را بنویسید" };
  if (def.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? { ok: true, value: s } : { ok: false, why: "تاریخ نامعتبر است" };
  return s.length <= def.max ? { ok: true, value: s } : { ok: false, why: `${def.label} حداکثر ${def.max} حرف است` };
}
