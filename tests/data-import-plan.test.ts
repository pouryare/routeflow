import { describe, expect, it } from "vitest";
import { COLUMNS, detectKind, parseNumber, planImport, priceKey, toRows, type Existing, type Table } from "@/lib/dataIO/importPlan";

const existing: Existing = {
  customers: [
    { id: 1, customer_code: "C-1", business_name: "نانوایی سنگک", contact_person: "رضا", phone: "09121112233", phone_norm: "9121112233", address: "خیابان اول", city: null, notes: null },
    { id: 2, customer_code: "C-2", business_name: "سوپر الف", contact_person: null, phone: null, phone_norm: null, address: null, city: null, notes: null },
    { id: 3, customer_code: "C-3", business_name: "سوپر الف", contact_person: null, phone: null, phone_norm: null, address: null, city: null, notes: null },
  ],
  products: [{ id: 10, sku: "MLK", name: "شیر ۱ لیتری", base_unit: "عدد", kg_per_base_unit: 1, packagings: [{ id: 100, name: "کارتن ۱۲تایی" }] }],
  prices: new Map([[priceKey(10, null), 45000]]),
};

const table = (kind: keyof typeof COLUMNS, rows: string[][]): Table => ({ sheetName: kind, headers: COLUMNS[kind].map((c) => c.header), rows });

describe("data import plan", () => {
  it("detects the kind of a sheet from its header row", () => {
    expect(detectKind(COLUMNS.customers.map((c) => c.header))).toBe("customers");
    expect(detectKind(COLUMNS.products.map((c) => c.header))).toBe("products");
    expect(detectKind(COLUMNS.prices.map((c) => c.header))).toBe("prices");
    expect(detectKind(["a", "b"])).toBeNull();
  });

  it("reads Persian digits and thousands separators", () => {
    expect(parseNumber("۴۸٬۰۰۰")).toBe(48000);
    expect(parseNumber("1,200.5")).toBe(1200.5);
    expect(parseNumber("abc")).toBeNull();
  });

  it("marks new, changed (old to new), unchanged and error customers", () => {
    const plan = planImport(
      [table("customers", [
        ["C-1", "نانوایی سنگک", "", "09121112233", "خیابان دوم", "", ""], // address changed
        ["", "قصابی تازه", "", "۰۹۱۳۱۲۳۴۵۶۷", "", "", ""], // new
        ["", "سوپر الف", "", "", "", "", ""], // two shops share the name
        ["", "نانوایی سنگک", "", "", "", "", ""], // unchanged (matched by name)
        ["", "خراب", "", "12", "", "", ""], // bad phone
      ])],
      existing
    );
    const [changed, fresh, ambiguous, same, bad] = plan.items;
    expect(changed.status).toBe("changed");
    expect(changed.changes).toEqual([{ field: "آدرس", from: "خیابان اول", to: "خیابان دوم" }]);
    expect(fresh.status).toBe("new");
    expect(fresh.op).toMatchObject({ t: "customer.insert", data: { phone: "09131234567", phoneNorm: "9131234567" } });
    expect(ambiguous.status).toBe("error");
    expect(same.status).toBe("same");
    expect(bad.status).toBe("error");
    expect(plan.counts).toEqual({ new: 1, changed: 1, same: 1, error: 2 });
  });

  it("never erases a saved value with a blank cell", () => {
    const plan = planImport([table("customers", [["C-1", "نانوایی سنگک", "", "", "", "", ""]])], existing);
    expect(plan.items[0].status).toBe("same");
  });

  it("catches the same customer twice in one file", () => {
    const plan = planImport([table("customers", [["", "الف ب", "", "09125556677", "", "", ""], ["", "دیگر", "", "09125556677", "", "", ""]])], existing);
    expect(plan.items.map((i) => i.status)).toEqual(["new", "error"]);
  });

  it("plans a price change as old to new, and a price that needs a product from the same file", () => {
    const plan = planImport(
      [
        table("products", [["NEW", "ماست", "عدد", "0.5"]]),
        table("prices", [
          ["MLK", "", "", "۴۸٬۰۰۰"], // 45000 -> 48000
          ["NEW", "ماست", "", "30000"], // product created by the same file
          ["", "شیر ۱ لیتری", "کارتن ۱۲تایی", "500000"], // packaging with no price yet
          ["", "شیر ۱ لیتری", "پالت", "1"], // unknown packaging
          ["", "ناشناخته", "", "5"], // unknown product
          ["MLK", "", "", "12.5"], // not a whole toman
        ]),
      ],
      existing
    );
    const prices = plan.items.filter((i) => i.kind === "prices");
    expect(prices[0]).toMatchObject({ status: "changed", changes: [{ from: "45000", to: "48000" }] });
    expect(prices[1].status).toBe("new");
    expect(prices[2].status).toBe("new");
    expect(prices.slice(3).map((i) => i.status)).toEqual(["error", "error", "error"]);
    expect(plan.kinds).toEqual(["products", "prices"]);
  });

  it("checks product weight", () => {
    const plan = planImport([table("products", [["", "نمک", "", "5000"], ["MLK", "", "", "2"]])], existing);
    // the second row has no name: error; the first has an impossible weight: error
    expect(plan.items.map((i) => i.status)).toEqual(["error", "error"]);
  });

  it("skips empty rows and keeps the sheet line number", () => {
    const rows = toRows("customers", table("customers", [["", "", "", "", "", "", ""], ["", "فروشگاه", "", "", "", "", ""]]));
    expect(rows).toHaveLength(1);
    expect(rows[0].row).toBe(3);
  });
});
