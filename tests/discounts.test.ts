import { describe, it, expect } from "vitest";
import {
  applyDeductions,
  canDecideDiscount,
  commissionBase,
  discountAmount,
  discountPercentOf,
  equalShares,
  routeDiscount,
  splitDeduction,
  validateDiscount,
  validateShares,
} from "@/lib/discounts";

describe("discountAmount", () => {
  it("takes a percent of the order, in whole toman", () => {
    expect(discountAmount("percent", 5, 1_000_000)).toBe(50_000);
    expect(discountAmount("percent", 3.33, 1_000_001)).toBe(33_300);
  });
  it("never exceeds the order or goes below zero", () => {
    expect(discountAmount("amount", 5_000_000, 1_000_000)).toBe(1_000_000);
    expect(discountAmount("amount", -5, 1_000_000)).toBe(0);
    expect(discountAmount("percent", 10, 0)).toBe(0);
  });
});

describe("validateDiscount", () => {
  it("accepts ordinary discounts", () => {
    expect(validateDiscount("percent", 5, 1_000_000)).toBeNull();
    expect(validateDiscount("percent", 7.5, 1_000_000)).toBeNull();
    expect(validateDiscount("amount", 250_000, 1_000_000)).toBeNull();
  });
  it("refuses zero, negative, over 100 percent, fractions and more than the order", () => {
    expect(validateDiscount("percent", 0, 100)).not.toBeNull();
    expect(validateDiscount("percent", -1, 100)).not.toBeNull();
    expect(validateDiscount("percent", 101, 100)).not.toBeNull();
    expect(validateDiscount("percent", 1.234, 100)).not.toBeNull();
    expect(validateDiscount("amount", 10.5, 1000)).not.toBeNull();
    expect(validateDiscount("amount", 2000, 1000)).not.toBeNull();
    expect(validateDiscount("amount", Number.NaN, 1000)).not.toBeNull();
  });
});

describe("shares", () => {
  it("equalShares always add to exactly 100", () => {
    for (const n of [1, 2, 3, 4, 6, 7]) {
      const total = equalShares(n).reduce((t, x) => t + Math.round(x * 100), 0);
      expect(total).toBe(10_000);
    }
    expect(equalShares(2)).toEqual([50, 50]);
    expect(equalShares(3)).toEqual([33.34, 33.33, 33.33]);
    expect(equalShares(0)).toEqual([]);
  });
  it("validateShares accepts nobody, and exactly 100", () => {
    expect(validateShares([])).toBeNull();
    expect(validateShares([{ user_id: 1, ledger: "sales", share_pct: 60 }, { user_id: 2, ledger: "driver", share_pct: 40 }])).toBeNull();
  });
  it("validateShares refuses a wrong total, a zero share and a repeated person", () => {
    expect(validateShares([{ user_id: 1, ledger: "sales", share_pct: 60 }])).not.toBeNull();
    expect(validateShares([{ user_id: 1, ledger: "sales", share_pct: 100 }, { user_id: 2, ledger: "sales", share_pct: 0 }])).not.toBeNull();
    expect(validateShares([{ user_id: 1, ledger: "sales", share_pct: 50 }, { user_id: 1, ledger: "sales", share_pct: 50 }])).not.toBeNull();
  });
  it("the same person in two ledgers is two shares", () => {
    expect(validateShares([{ user_id: 1, ledger: "sales", share_pct: 50 }, { user_id: 1, ledger: "driver", share_pct: 50 }])).toBeNull();
  });
});

describe("splitDeduction", () => {
  it("adds to exactly the total, whatever the shares", () => {
    const parts = splitDeduction(1_000_001, equalShares(3).map((p) => ({ share_pct: p })));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    for (const part of parts) expect(Math.abs(part - 1_000_001 / 3)).toBeLessThan(200);
  });
  it("follows uneven shares", () => {
    expect(splitDeduction(5_000_000, [{ share_pct: 60 }, { share_pct: 40 }])).toEqual([3_000_000, 2_000_000]);
  });
  it("is zero for nobody or nothing", () => {
    expect(splitDeduction(100, [])).toEqual([]);
    expect(splitDeduction(0, [{ share_pct: 100 }])).toEqual([0]);
  });
});

describe("commissionBase", () => {
  it("is all of it at 100 and a share below", () => {
    expect(commissionBase(5_000_000, 100)).toBe(5_000_000);
    expect(commissionBase(5_000_000, 50)).toBe(2_500_000);
    expect(commissionBase(5_000_000, 0)).toBe(0);
    expect(commissionBase(5_000_000, 150)).toBe(5_000_000);
  });
});

describe("routeDiscount", () => {
  it("applies the owner's own at once", () => {
    expect(routeDiscount({ id: 1, role: "owner" }, 20, 0)).toBe("auto_owner");
    expect(routeDiscount({ id: 1, role: "platform_owner" }, 20, 0)).toBe("auto_owner");
  });
  it("waits by default and passes below the company's limit", () => {
    expect(routeDiscount({ id: 2, role: "phone_sales" }, 1, 0)).toBe("needs_approval");
    expect(routeDiscount({ id: 2, role: "phone_sales" }, 2.9, 3)).toBe("auto_limit");
    expect(routeDiscount({ id: 2, role: "phone_sales" }, 3, 3)).toBe("needs_approval");
  });
});

describe("canDecideDiscount", () => {
  const seller = { id: 10, role: "phone_sales" };
  const gm = { id: 20, role: "group_manager", group_id: 5 };
  const owner = { id: 1, role: "owner", group_id: null };
  it("lets the group manager answer for their own group only", () => {
    expect(canDecideDiscount(seller, gm, 5)).toBe(true);
    expect(canDecideDiscount(seller, gm, 6)).toBe(false);
    expect(canDecideDiscount(seller, gm, null)).toBe(false);
  });
  it("lets the owner answer anything", () => {
    expect(canDecideDiscount(seller, owner, 6)).toBe(true);
    expect(canDecideDiscount(seller, owner, null)).toBe(true);
  });
  it("never lets anyone answer their own", () => {
    expect(canDecideDiscount({ id: 20, role: "group_manager" }, gm, 5)).toBe(false);
    expect(canDecideDiscount({ id: 1, role: "owner" }, owner, 5)).toBe(false);
  });
  it("sends a group manager's own discount to the owner", () => {
    expect(canDecideDiscount({ id: 21, role: "group_manager" }, gm, 5)).toBe(false);
    expect(canDecideDiscount({ id: 20, role: "group_manager" }, owner, 5)).toBe(true);
  });
  it("refuses everyone else", () => {
    expect(canDecideDiscount(seller, { id: 30, role: "rep_manager", group_id: 5 }, 5)).toBe(false);
    expect(canDecideDiscount(seller, { id: 31, role: "phone_sales", group_id: 5 }, 5)).toBe(false);
  });
});

describe("applyDeductions", () => {
  it("takes what the commission covers and carries the rest", () => {
    expect(applyDeductions(1_200_000, 2_000_000)).toEqual({ applied: 1_200_000, carried: 800_000 });
    expect(applyDeductions(5_000_000, 2_000_000)).toEqual({ applied: 2_000_000, carried: 0 });
    expect(applyDeductions(0, 300)).toEqual({ applied: 0, carried: 300 });
    expect(applyDeductions(100, 0)).toEqual({ applied: 0, carried: 0 });
  });
});

describe("discountPercentOf", () => {
  it("is the share of the order, zero for an empty order", () => {
    expect(discountPercentOf(50_000, 1_000_000)).toBe(5);
    expect(discountPercentOf(50_000, 0)).toBe(0);
  });
});

describe("parseDiscountBody", () => {
  it("treats a missing discount as none", async () => {
    const { parseDiscountBody } = await import("@/lib/discounts");
    expect(parseDiscountBody(undefined)).toEqual({ ok: true, discount: null });
    expect(parseDiscountBody(null)).toEqual({ ok: true, discount: null });
  });
  it("reads a well-formed one and trims the note", async () => {
    const { parseDiscountBody } = await import("@/lib/discounts");
    const r = parseDiscountBody({ kind: "percent", value: "5", reason: "loyal", note: "  سلام ", shares: [{ user_id: 3, ledger: "sales", share_pct: 100 }] });
    expect(r).toEqual({ ok: true, discount: { kind: "percent", value: 5, reason: "loyal", note: "سلام", shares: [{ user_id: 3, ledger: "sales", share_pct: 100 }] } });
  });
  it("refuses bad shapes", async () => {
    const { parseDiscountBody } = await import("@/lib/discounts");
    expect(parseDiscountBody("x").ok).toBe(false);
    expect(parseDiscountBody({ kind: "free", value: 1, reason: "loyal" }).ok).toBe(false);
    expect(parseDiscountBody({ kind: "percent", value: "abc", reason: "loyal" }).ok).toBe(false);
    expect(parseDiscountBody({ kind: "percent", value: 1, reason: "nope" }).ok).toBe(false);
    expect(parseDiscountBody({ kind: "percent", value: 1, reason: "loyal", shares: [{ user_id: 1, ledger: "boss", share_pct: 100 }] }).ok).toBe(false);
    expect(parseDiscountBody({ kind: "percent", value: 1, reason: "loyal", shares: "x" }).ok).toBe(false);
  });
});
