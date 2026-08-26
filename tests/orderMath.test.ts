import { describe, expect, test } from "vitest";
import {
  effectivePacks,
  baseQty,
  lineKg,
  lineTotalToman,
  lineCostToman,
  orderTotalToman,
  orderKg,
  orderMarginToman,
  formatOrderNo,
  type LineSnapshot,
} from "@/lib/orderMath";

const line = (over: Partial<LineSnapshot> = {}): LineSnapshot => ({
  packs_ordered: 2,
  packs_delivered: null,
  unit_price_toman: 440000,
  unit_cost_toman: 300000,
  qty_per_pack: 100,
  kg_per_base_unit: 0.25,
  ...over,
});

describe("effectivePacks", () => {
  test("is the ordered quantity until the driver confirms", () => {
    expect(effectivePacks(line())).toBe(2);
  });

  test("becomes the delivered quantity once there is one", () => {
    expect(effectivePacks(line({ packs_delivered: 1 }))).toBe(1);
  });

  test("respects a delivery of zero rather than falling back to ordered", () => {
    // The customer refused the whole line at the door. Falling back to `ordered` here
    // would invoice and pay commission on goods that went home in the van.
    expect(effectivePacks(line({ packs_delivered: 0 }))).toBe(0);
  });
});

describe("baseQty", () => {
  test("multiplies packs by what is in a pack", () => {
    expect(baseQty(line())).toBe(200);
  });

  test("uses the delivered quantity when there is one", () => {
    expect(baseQty(line({ packs_delivered: 1.5 }))).toBe(150);
  });
});

describe("lineKg", () => {
  test("converts through the base unit", () => {
    expect(lineKg(line())).toBe(50); // 2 packs x 100 عدد x 0.25 kg
  });

  test("uses the frozen factors, not today's", () => {
    // A box revised from 100 to 120 عدد must not change what an old order weighed --
    // commission was already paid on the original figure.
    expect(lineKg(line({ qty_per_pack: 120 }))).toBe(60);
  });

  test("is zero for a product whose weight is not recorded", () => {
    expect(lineKg(line({ kg_per_base_unit: 0 }))).toBe(0);
  });
});

describe("lineTotalToman", () => {
  test("multiplies packs by the snapshotted unit price", () => {
    expect(lineTotalToman(line())).toBe(880000);
  });

  test("rounds a fractional pack to whole Toman", () => {
    expect(lineTotalToman(line({ packs_ordered: 0.5 }))).toBe(220000);
    expect(lineTotalToman(line({ packs_ordered: 1 / 3, unit_price_toman: 100 }))).toBe(33);
  });

  test("returns a negative total for a reversal line", () => {
    expect(lineTotalToman(line({ packs_ordered: -2 }))).toBe(-880000);
  });

  test("mirrors a sale exactly when reversed", () => {
    // Rounding half away from zero, so a reversal cannot leave one Toman behind.
    const sale = lineTotalToman(line({ packs_ordered: 0.5, unit_price_toman: 4401 }));
    const reversal = lineTotalToman(line({ packs_ordered: -0.5, unit_price_toman: 4401 }));
    expect(sale + reversal).toBe(0);
  });

  test("is a whole number always", () => {
    for (const packs of [0.1, 1 / 3, 2 / 7, 1.05]) {
      expect(Number.isInteger(lineTotalToman(line({ packs_ordered: packs })))).toBe(true);
    }
  });
});

describe("orderTotalToman", () => {
  test("adds the lines", () => {
    expect(orderTotalToman([line(), line({ packs_ordered: 1 })])).toBe(1320000);
  });

  test("nets off a reversal", () => {
    expect(orderTotalToman([line(), line({ packs_ordered: -2 })])).toBe(0);
  });

  test("is zero for an order with no lines", () => {
    expect(orderTotalToman([])).toBe(0);
  });
});

describe("lineCostToman", () => {
  test("multiplies packs by the snapshotted unit cost", () => {
    expect(lineCostToman(line())).toBe(600000);
  });

  test("uses the cost frozen at sale, not today's average", () => {
    // The moving average moves with every purchase. If margin read it live, the profit
    // on an order closed in Farvardin would keep changing all year.
    expect(lineCostToman(line({ unit_cost_toman: 999999 }))).toBe(1999998);
  });

  test("follows the delivered quantity", () => {
    expect(lineCostToman(line({ packs_delivered: 1 }))).toBe(300000);
  });
});

describe("orderKg", () => {
  test("adds the lines' weight", () => {
    expect(orderKg([line(), line({ packs_ordered: 1 })])).toBe(75);
  });

  test("is zero for no lines", () => {
    expect(orderKg([])).toBe(0);
  });

  test("nets off a reversal, so commission is not paid twice", () => {
    expect(orderKg([line(), line({ packs_ordered: -2 })])).toBe(0);
  });
});

describe("orderMarginToman", () => {
  test("is what was charged less what it cost", () => {
    expect(orderMarginToman([line()])).toBe(280000);
  });

  test("goes negative when a line is sold below cost", () => {
    expect(orderMarginToman([line({ unit_price_toman: 100000 })])).toBe(-400000);
  });

  test("is a whole number", () => {
    const margin = orderMarginToman([line({ packs_ordered: 1 / 3 })]);
    expect(Number.isInteger(margin)).toBe(true);
  });
});

describe("formatOrderNo", () => {
  test("is the Jalali year and a padded sequence", () => {
    expect(formatOrderNo(1405, 42)).toBe("1405-00042");
  });

  test("stores Latin digits, so it sorts and compares", () => {
    // Persian digits in a key would break ORDER BY, LIKE and every equality check
    // against a number typed on a different keyboard.
    expect(formatOrderNo(1405, 1)).toMatch(/^[0-9-]+$/);
  });

  test("keeps sorting correctly past the padding width", () => {
    expect(formatOrderNo(1405, 100000) < formatOrderNo(1406, 1)).toBe(true);
  });
});
