import { describe, it, expect } from "vitest";
import { buildReceipt } from "@/lib/deliveryReceipt";
import type { RunStop } from "@/lib/delivery";

const stop = {
  id: 1, order_id: 2, order_no: "A-100", customer_id: 3, customer_name: "نانوایی سنگک", address: "خیابان ۱", phone: "0912",
  lat: null, lng: null, status: "pending", collected_toman: 0, sort_order: 1, notes: null, total_toman: 1200000,
  lines: [
    { id: 11, product_name: "شیر", packaging_name: "کارتن", packs_ordered: 10, packs_delivered: null, unit_price_toman: 60000, unit_cost_toman: 0, qty_per_pack: 1, kg_per_base_unit: 1, total_toman: 600000, kg: 10 },
    { id: 12, product_name: "ماست", packaging_name: "بسته", packs_ordered: 6, packs_delivered: null, unit_price_toman: 100000, unit_cost_toman: 0, qty_per_pack: 1, kg_per_base_unit: 1, total_toman: 600000, kg: 6 },
  ],
} as RunStop;

describe("buildReceipt", () => {
  it("lists only delivered lines and shows what is still owed", () => {
    const r = buildReceipt({ stop, packs: { 11: 10, 12: 0 }, collectedToman: 400000, runDate: "2026-10-20", driverName: "علی", businessName: "کارگاه" });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].name).toBe("شیر · کارتن");
    expect(r.totalLabel).toContain("۶۰۰٬۰۰۰");
    expect(r.totalWords).toBe("ششصد هزار تومان");
    expect(r.dueLabel).toContain("۲۰۰٬۰۰۰");
  });
  it("has no amount due when the customer paid in full", () => {
    const r = buildReceipt({ stop, packs: { 11: 10, 12: 6 }, collectedToman: 1200000, runDate: "2026-10-20", driverName: "علی", businessName: "کارگاه" });
    expect(r.dueLabel).toBeNull();
  });
});
