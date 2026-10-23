import { describe, expect, it } from "vitest";
import { priceList } from "@/lib/priceList";
import type { CatalogueProduct } from "@/lib/catalogue";

const base = { sku: null, kg_per_base_unit: 1, avg_cost_toman: 0, notes: null, created_at: "", updated_at: "", reorder_point: null, target_stock: null };
const pack = (id: number, name: string, qty: number, price: number | null, active = 1) => ({
  id, product_id: 1, name, qty_per_pack: qty, barcode: null, active, created_at: "", price_toman: price, price_id: price === null ? null : id,
});

describe("priceList (F23)", () => {
  it("lists priced active packagings and counts the unpriced ones", () => {
    const catalogue: CatalogueProduct[] = [
      { ...base, id: 1, name: "ماست", base_unit: "عدد", active: 1, packagings: [pack(1, "کارتن", 12, 240000), pack(2, "تکی", 1, null)] },
      { ...base, id: 2, name: "دوغ", base_unit: "عدد", active: 1, packagings: [pack(3, "باکس", 6, null)] },
      { ...base, id: 3, name: "پنیر", base_unit: "عدد", active: 0, packagings: [pack(4, "کارتن", 10, 500000)] },
      { ...base, id: 4, name: "کره", base_unit: "عدد", active: 1, packagings: [pack(5, "کارتن", 10, 900000, 0)] },
    ];
    const { sections, unpriced } = priceList(catalogue);
    expect(sections.map((s) => s.product)).toEqual(["ماست"]);
    expect(sections[0].lines).toHaveLength(1);
    expect(sections[0].lines[0].packaging).toBe("کارتن");
    expect(sections[0].lines[0].contents).toBe("۱۲ عدد");
    expect(sections[0].lines[0].priceLabel).toContain("۲۴۰");
    expect(unpriced).toBe(2);
  });

  it("keeps a zero price, which is a real price", () => {
    const { sections } = priceList([{ ...base, id: 1, name: "نمونه", base_unit: "عدد", active: 1, packagings: [pack(1, "تکی", 1, 0)] }]);
    expect(sections).toHaveLength(1);
  });
});
