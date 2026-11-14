import { describe, it, expect } from "vitest";
import { buyList, buyQty } from "@/lib/buyList";

const p = (over: Partial<Parameters<typeof buyQty>[0]>) => ({ productId: 1, name: "برنج", unit: "کیلو", onHand: 20, reorderPoint: 30, target: 100, sellOff: false, ...over });

describe("D17 buy list", () => {
  it("asks for target less shelf, never below the supplier minimum", () => {
    expect(buyQty(p({}), null)).toBe(80);
    expect(buyQty(p({}), 100)).toBe(100);
    expect(buyQty(p({ onHand: 200 }), null)).toBe(0);
  });
  it("groups by the cheapest supplier, skips products above the point or in sell-off, and keeps no-supplier last", () => {
    const prices = [
      { supplierId: 1, supplier: "الف", productId: 1, price: 50, minQty: null, deliveryDays: 3 },
      { supplierId: 2, supplier: "ب", productId: 1, price: 40, minQty: 90, deliveryDays: 5 },
    ];
    const groups = buyList([p({}), p({ productId: 2, name: "عدس", onHand: 500 }), p({ productId: 3, name: "قند", sellOff: true }), p({ productId: 4, name: "چای" })], prices);
    expect(groups.map((g) => g.supplier)).toEqual(["ب", "بدون تأمین‌کننده"]);
    expect(groups[0].lines[0].qty).toBe(90);
    expect(groups[0].totalToman).toBe(3600);
  });

  it("counts what is already on open purchase orders as stock (F66)", () => {
    expect(buyQty(p({ onHand: 20, onOrder: 80 }), null)).toBe(0); // target 100: 20 here and 80 coming
    expect(buyQty(p({ onHand: 20, onOrder: 30 }), null)).toBe(50);
    expect(buyList([p({ onOrder: 50 })], [])).toEqual([]); // 70 > reorder point 30
  });
});
