import { describe, it, expect } from "vitest";
import { districtMoney, moneyFill } from "@/lib/districtMoney";
import { STATUS_COLOR } from "@/lib/types";

const debt = (total: number, old: number) => ({ total, bucket_0_7: total - old, bucket_8_30: 0, bucket_30_plus: old });

describe("districtMoney", () => {
  it("sums owed, old part and shops per district and skips settled or unplaced shops", () => {
    const m = districtMoney([
      { district_id: 7, debt: debt(20_000_000, 20_000_000) },
      { district_id: 7, debt: debt(18_000_000, 0) },
      { district_id: 7, debt: debt(0, 0) },
      { district_id: null, debt: debt(5, 0) },
      { district_id: 9, debt: undefined },
    ]);
    expect(m.get(7)).toEqual({ owed: 38_000_000, old: 20_000_000, shops: 2 });
    expect(m.size).toBe(1);
  });
  it("colours red when anything is old, green when only fresh, neutral when nothing", () => {
    expect(moneyFill({ owed: 5, old: 1, shops: 1 }, "grey")).toBe(STATUS_COLOR.not_allowed);
    expect(moneyFill({ owed: 5, old: 0, shops: 1 }, "grey")).toBe(STATUS_COLOR.visited);
    expect(moneyFill(undefined, "grey")).toBe("grey");
  });
});
