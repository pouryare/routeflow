import { describe, it, expect } from "vitest";
import { measureFor, type MeasurableOrder } from "@/lib/commission/measure";

/** One fulfilled order with two lines, standing in for a real snapshot. */
const order = (over: Partial<MeasurableOrder> = {}): MeasurableOrder => ({
  lines: [
    {
      packs_ordered: 12,
      packs_delivered: 10,
      qty_per_pack: 1,
      kg_per_base_unit: 2,
      volume_m3_per_base_unit: 0.01,
      unit_price_toman: 50_000,
      unit_cost_toman: 30_000,
    },
  ],
  ...over,
});

describe("measuring a plan", () => {
  it("weight is kg over delivered packs only", () => {
    // 10 packs * 1 * 2kg = 20kg. The order was for 12, so a plan paid on ORDERED weight
    // would credit a rep for goods that came home again.
    expect(measureFor("kg", [order()])).toBe(20);
  });

  it("falls back to ORDERED when nothing was delivered yet", () => {
    // effectivePacks in lib/orderMath: null means "no delivery recorded", which is different
    // from a delivery of zero. A not-yet-delivered line must still measure, or an open
    // order measures nothing at all.
    const undelivered = order({
      lines: [
        {
          packs_ordered: 12,
          packs_delivered: null,
          qty_per_pack: 1,
          kg_per_base_unit: 2,
          volume_m3_per_base_unit: 0.01,
          unit_price_toman: 50_000,
          unit_cost_toman: 30_000,
        },
      ],
    });
    expect(measureFor("kg", [undelivered])).toBe(24); // 12 * 1 * 2
  });

  it("a delivery of ZERO measures zero, it does not fall back to the ordered quantity", () => {
    // The customer refused the line at the door. Paying on 12 packs because 0 is falsy
    // would pay commission on goods that came home.
    const refused = order({
      lines: [
        {
          packs_ordered: 12,
          packs_delivered: 0,
          qty_per_pack: 1,
          kg_per_base_unit: 2,
          volume_m3_per_base_unit: 0.01,
          unit_price_toman: 50_000,
          unit_cost_toman: 30_000,
        },
      ],
    });
    expect(measureFor("kg", [refused])).toBe(0);
    expect(measureFor("revenue_toman", [refused])).toBe(0);
  });

  it("volume multiplies the same way, and the factor already exists on products", () => {
    // 10 * 1 * 0.01 = 0.1 m3. No schema change is needed for volume commission.
    expect(measureFor("volume_m3", [order()])).toBeCloseTo(0.1, 6);
  });

  it("volume uses DELIVERED-or-ordered too — the case that catches a direct read", () => {
    // This is the one input where reading `packs_delivered` directly and going through
    // effectivePacks disagree: null. The direct read gives 0, which would measure a
    // not-yet-delivered order as having no volume at all. Found by mutation — the obvious
    // "zero delivery" case reads the same either way and passed against the wrong code.
    const undelivered = order({
      lines: [
        {
          packs_ordered: 12, packs_delivered: null, qty_per_pack: 1, kg_per_base_unit: 2,
          volume_m3_per_base_unit: 0.01, unit_price_toman: 50_000, unit_cost_toman: 30_000,
        },
      ],
    });
    expect(measureFor("volume_m3", [undelivered])).toBeCloseTo(0.12, 6); // 12 * 1 * 0.01
  });

  it("revenue is the delivered line value in whole Toman", () => {
    expect(measureFor("revenue_toman", [order()])).toBe(500_000);
  });

  it("margin is charged less cost", () => {
    expect(measureFor("margin_toman", [order()])).toBe(200_000);
  });

  it("orders counts fulfilled orders, not lines", () => {
    const two = order({
      lines: [
        { packs_ordered: 1, packs_delivered: 1, qty_per_pack: 1, kg_per_base_unit: 1, volume_m3_per_base_unit: 0, unit_price_toman: 100, unit_cost_toman: 50 },
        { packs_ordered: 1, packs_delivered: 1, qty_per_pack: 1, kg_per_base_unit: 1, volume_m3_per_base_unit: 0, unit_price_toman: 100, unit_cost_toman: 50 },
      ],
    });
    expect(measureFor("orders", [two])).toBe(1);
  });

  it("sums across every order in the period", () => {
    expect(measureFor("kg", [order(), order()])).toBe(40);
  });

  it("an empty period measures zero rather than throwing", () => {
    expect(measureFor("kg", [])).toBe(0);
  });

  it("a line with a NULL volume factor contributes nothing, not NaN", () => {
    // volume_m3_per_base_unit is a nullable column added by ALTER. A product nobody has
    // filled in must not poison the whole month's figure.
    const l = order({
      lines: [
        {
          packs_ordered: 5,
          packs_delivered: 5,
          qty_per_pack: 1,
          kg_per_base_unit: 1,
          volume_m3_per_base_unit: null as never,
          unit_price_toman: 100,
          unit_cost_toman: 50,
        },
      ],
    });
    expect(Number.isNaN(measureFor("volume_m3", [l]))).toBe(false);
    expect(measureFor("volume_m3", [l])).toBe(0);
  });

  it("one unmeasured line does not hide real volume on the others", () => {
    // The `?? 0` is per LINE. Skipping the line entirely, or treating null as "no volume
    // anywhere", would both lose the 0.05 m3 the second line really has.
    const mixed = order({
      lines: [
        {
          packs_ordered: 5, packs_delivered: 5, qty_per_pack: 1, kg_per_base_unit: 1,
          volume_m3_per_base_unit: null as never, unit_price_toman: 100, unit_cost_toman: 50,
        },
        {
          packs_ordered: 5, packs_delivered: 5, qty_per_pack: 1, kg_per_base_unit: 1,
          volume_m3_per_base_unit: 0.01, unit_price_toman: 100, unit_cost_toman: 50,
        },
      ],
    });
    expect(measureFor("volume_m3", [mixed])).toBeCloseTo(0.05, 6);
  });

  it("an order with no lines is not an order someone sold", () => {
    expect(measureFor("orders", [{ lines: [] }, order()])).toBe(1);
  });

  it("every metric measures zero on an empty period, not just kg", () => {
    for (const m of ["kg", "volume_m3", "revenue_toman", "margin_toman", "orders"] as const) {
      expect(measureFor(m, []), `${m} on an empty period`).toBe(0);
    }
  });

  it("a negative order reverses the measure, so a correction nets out", () => {
    // Sign symmetry again: the ledger restates real unpaid earnings, and a corrected order
    // has to subtract what it once added. Tested on the measure, and paired in tiers.test.
    const reversed = order({
      lines: [
        {
          packs_ordered: -10, packs_delivered: -10, qty_per_pack: 1, kg_per_base_unit: 2,
          volume_m3_per_base_unit: 0.01, unit_price_toman: 50_000, unit_cost_toman: 30_000,
        },
      ],
    });
    expect(measureFor("kg", [reversed])).toBe(-20);
    expect(measureFor("kg", [order(), reversed])).toBe(0);
  });
});
