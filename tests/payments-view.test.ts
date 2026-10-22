import { describe, it, expect } from "vitest";
import { filterPayments, groupByMonth, paymentTotals, paymentsCsv, type Payment } from "@/lib/paymentsView";

const p = (id: number, over: Partial<Payment> = {}): Payment => ({
  id, customer_id: 1, amount_toman: 100, method: "CASH", received_at: "2026-02-10T08:00:00.000Z",
  reference: null, note: null, voided_at: null, ...over,
});

describe("payments view", () => {
  it("hides voided receipts by default and sorts newest first", () => {
    const rows = [p(1), p(2, { received_at: "2026-02-12T08:00:00.000Z" }), p(3, { voided_at: "x" })];
    const out = filterPayments(rows, { method: "", from: "", to: "", voided: "hide" });
    expect(out.map((r) => r.id)).toEqual([2, 1]);
    expect(filterPayments(rows, { method: "", from: "", to: "", voided: "only" }).map((r) => r.id)).toEqual([3]);
  });
  it("filters by method and day range", () => {
    const rows = [p(1), p(2, { method: "POS" }), p(3, { received_at: "2026-03-01T08:00:00.000Z" })];
    expect(filterPayments(rows, { method: "POS", from: "", to: "", voided: "all" }).map((r) => r.id)).toEqual([2]);
    expect(filterPayments(rows, { method: "", from: "2026-02-20", to: "", voided: "all" }).map((r) => r.id)).toEqual([3]);
  });
  it("totals today, week and month by method, largest first", () => {
    const rows = [p(1, { amount_toman: 50 }), p(2, { method: "POS", amount_toman: 70 }), p(3, { received_at: "2026-01-05T00:00:00.000Z" })];
    const t = paymentTotals(rows, "2026-02-10", "2026-02-03");
    expect(t.today.total).toBe(120);
    expect(t.today.byMethod[0]).toEqual(["POS", 70]);
    expect(t.month.total).toBe(120);
  });
  it("groups by month and writes a BOM-led CSV", () => {
    expect(groupByMonth([p(1), p(2, { received_at: "2026-03-01T00:00:00.000Z" })]).map(([k]) => k)).toEqual(["2026-02", "2026-03"]);
    const csv = paymentsCsv([p(1, { note: 'say "hi"' })], () => "Shop");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"say ""hi"""');
  });
});
