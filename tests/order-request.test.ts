import { describe, it, expect } from "vitest";
import { parseOrderRequest } from "@/lib/orderRequest";

const line = { product_id: 1, packaging_id: 1, packs: 1 };

describe("parseOrderRequest", () => {
  it("accepts a plain order and reads a missing day as «soonest»", () => {
    const r = parseOrderRequest({ order_date: "2026-01-05", lines: [line] });
    expect(r).toMatchObject({ ok: true, requestedDay: null, kind: "soonest" });
  });
  it("reads a day with no kind as an exact date", () => {
    expect(parseOrderRequest({ order_date: "2026-01-05", requested_day: "2026-01-09", lines: [line] })).toMatchObject({ ok: true, kind: "exact_date" });
  });
  it("refuses a bad order date, a bad requested day, an unknown kind and an empty order", () => {
    expect(parseOrderRequest({ order_date: "05/01/2026", lines: [line] })).toMatchObject({ ok: false });
    expect(parseOrderRequest({ order_date: "2026-01-05", requested_day: "2026-13-45", lines: [line] })).toMatchObject({ ok: false });
    expect(parseOrderRequest({ order_date: "2026-01-05", requested_kind: "tomorrow-ish", lines: [line] })).toMatchObject({ ok: false });
    expect(parseOrderRequest({ order_date: "2026-01-05", lines: [] })).toMatchObject({ ok: false });
    expect(parseOrderRequest(null)).toMatchObject({ ok: false });
  });
});
