import { describe, it, expect } from "vitest";
import { filterOrders, searchTokens } from "@/lib/orderListFilter";
import type { OrderSummary } from "@/lib/orders";

const o = (id: number, over: Partial<OrderSummary>): OrderSummary =>
  ({ id, order_no: `ORD-${id}`, customer_id: 1, customer_name: "فروشگاه الف", group_id: null, salesperson_name: "علی", status: "CONFIRMED", priority: "NORMAL", order_date: "2026-11-13", requested_day: null, requested_kind: null, payment_status: "unpaid", paid_toman: 0, total_toman: 1, discount_toman: 0, kg: 1, line_count: 1, customer_phone: "09121112233", ...over }) as OrderSummary;

describe("orders list filter (FB1)", () => {
  const list = [o(123, {}), o(124, { status: "DELIVERED", payment_status: "paid", salesperson_name: "رضا", order_date: "2026-11-12", customer_phone: "09350000000", customer_name: "ب" }), o(5, { status: "CANCELLED" })];
  it("splits pasted text on spaces, commas and new lines and reads Persian digits", () => {
    expect(searchTokens("۱۲۳، 124\n09350000000")).toEqual(["123", "124", "09350000000"]);
  });
  it("finds many order numbers and a phone at once", () => {
    expect(filterOrders(list, { q: "123 124" }, "2026-11-13").map((x) => x.id)).toEqual([123, 124]);
    expect(filterOrders(list, { q: "9350000000" }, "2026-11-13").map((x) => x.id)).toEqual([124]);
  });
  it("filters by status group, payment, rep and day together", () => {
    expect(filterOrders(list, { status: "done", payment: "paid", rep: "رضا", day: "yesterday" }, "2026-11-13").map((x) => x.id)).toEqual([124]);
    expect(filterOrders(list, { status: "void" }, "2026-11-13").map((x) => x.id)).toEqual([5]);
    expect(filterOrders(list, { day: "week" }, "2026-11-13").length).toBe(3);
  });
});
