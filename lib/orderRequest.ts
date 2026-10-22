/** Shape validation of a new-order request body, apart from the HTTP handling. Pure: no lookups, so each
 *  rule can be read and tested on its own. Who the customer, products and seller are is decided later,
 *  against the caller's company. */

import { isRequestedKind, type RequestedKind } from "@/lib/requestedDay";
import type { LineInput } from "@/lib/orders";

export type OrderRequest =
  | { ok: true; orderDate: string; requestedDay: string | null; kind: RequestedKind; lines: LineInput[] }
  | { ok: false; error: string };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (v: string) => ISO_DAY.test(v) && !Number.isNaN(Date.parse(v));

export function parseOrderRequest(
  body: { order_date?: unknown; requested_day?: unknown; requested_kind?: unknown; lines?: unknown } | null
): OrderRequest {
  const orderDate = typeof body?.order_date === "string" ? body.order_date : "";
  if (!validDay(orderDate)) return { ok: false, error: "تاریخ سفارش معتبر نیست" };

  /* The day the customer asked for is NOT order_date: one is when the slip was typed, the other is when
     the goods should go. Absent or null is the NORMAL state («در اولین فرصت»), so validation is on SHAPE,
     and an unparseable string is refused rather than coerced to null: silently turning "2026-13-45" into
     "uncommitted" would lose a commitment nobody could see. */
  const requestedDay = body?.requested_day == null ? null : String(body.requested_day);
  if (requestedDay !== null && !validDay(requestedDay)) return { ok: false, error: "تاریخ خواسته‌شده معتبر نیست" };

  /* Only a SENT kind is validated; absent or null must pass, or every caller written before this field
     existed would be rejected. An unrecognised string IS refused: guessing which kind "tomorrow-ish" meant
     is how a commitment silently changes shape. */
  const requestedKind = body?.requested_kind == null ? null : String(body.requested_kind);
  if (requestedKind !== null && !isRequestedKind(requestedKind)) return { ok: false, error: "نوع تاریخ معتبر نیست" };
  /* A day with no kind is read as an exact date: the calendar was the control used. */
  const kind: RequestedKind = requestedKind ?? (requestedDay === null ? "soonest" : "exact_date");

  const lines = Array.isArray(body?.lines) ? (body.lines as LineInput[]) : [];
  if (lines.length === 0) return { ok: false, error: "سفارش بدون قلم ثبت نمی‌شود" };

  return { ok: true, orderDate, requestedDay, kind, lines };
}
