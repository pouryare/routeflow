import { describe, it, expect } from "vitest";
import {
  customerStatusColor,
  debtColor,
  salespersonColor,
  daysSinceLastPurchase,
  inactivityColor,
  STATUS_COLOR,
  CustomerRow,
} from "@/lib/types";

function customer(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: 1,
    customer_code: "C1",
    business_name: "Test",
    contact_person: null,
    phone: null,
    address: null,
    city: null,
    province: null,
    lat: null,
    lng: null,
    status: null,
    salesperson: null,
    debt_0_7: 0,
    debt_8_30: 0,
    debt_30_plus: 0,
    notes: null,
    synced_at: "2026-01-01T00:00:00.000Z",
    last_purchase_date: null,
    ...overrides,
  };
}

describe("customerStatusColor", () => {
  it("maps active (فعال) to visited color", () => {
    expect(customerStatusColor("مشتری فعال")).toBe(STATUS_COLOR.visited);
  });
  it("maps inactive (غیرفعال) to unknown color -- checked before the فعال substring match", () => {
    expect(customerStatusColor("غیرفعال")).toBe(STATUS_COLOR.unknown);
  });
  it("maps null/empty status to unknown", () => {
    expect(customerStatusColor(null)).toBe(STATUS_COLOR.unknown);
  });
  it("falls back to needs_coverage for any other status text", () => {
    expect(customerStatusColor("در انتظار بررسی")).toBe(STATUS_COLOR.needs_coverage);
  });
});

describe("debtColor", () => {
  it("is not_allowed (crit) when debt_30_plus > 0, regardless of other buckets", () => {
    expect(debtColor(customer({ debt_30_plus: 1, debt_8_30: 1, debt_0_7: 1 }))).toBe(STATUS_COLOR.not_allowed);
  });
  it("is needs_coverage (warn) when only debt_8_30 > 0", () => {
    expect(debtColor(customer({ debt_8_30: 1 }))).toBe(STATUS_COLOR.needs_coverage);
  });
  it("is visited (good) when there's no debt at all, even with debt_0_7 > 0", () => {
    expect(debtColor(customer({ debt_0_7: 500 }))).toBe(STATUS_COLOR.visited);
    expect(debtColor(customer())).toBe(STATUS_COLOR.visited);
  });
});

describe("daysSinceLastPurchase", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  it("returns null when never purchased", () => {
    expect(daysSinceLastPurchase({ last_purchase_date: null }, now)).toBeNull();
  });
  it("computes whole days between last_purchase_date and now", () => {
    expect(daysSinceLastPurchase({ last_purchase_date: "2026-08-05" }, now)).toBe(10);
  });
  it("returns null for an unparseable date string", () => {
    expect(daysSinceLastPurchase({ last_purchase_date: "not-a-date" }, now)).toBeNull();
  });
});

describe("inactivityColor", () => {
  const now = new Date("2026-08-15T00:00:00.000Z");
  it("is unknown (never purchased)", () => {
    expect(inactivityColor(customer({ last_purchase_date: null }), now)).toBe(STATUS_COLOR.unknown);
  });
  it("is visited (good) within 30 days", () => {
    expect(inactivityColor(customer({ last_purchase_date: "2026-08-01" }), now)).toBe(STATUS_COLOR.visited);
  });
  it("is needs_coverage (warn) between 31 and 60 days", () => {
    expect(inactivityColor(customer({ last_purchase_date: "2026-07-01" }), now)).toBe(STATUS_COLOR.needs_coverage);
  });
  it("is not_allowed (crit) beyond 60 days", () => {
    expect(inactivityColor(customer({ last_purchase_date: "2026-05-01" }), now)).toBe(STATUS_COLOR.not_allowed);
  });
});

describe("salespersonColor", () => {
  it("returns unknown color for no salesperson", () => {
    expect(salespersonColor(null, new Map())).toBe(STATUS_COLOR.unknown);
  });
  it("assigns the same color to the same name across calls", () => {
    const index = new Map<string, number>();
    const first = salespersonColor("Ali", index);
    const second = salespersonColor("Ali", index);
    expect(first).toBe(second);
  });
  it("assigns different colors to different names (until the palette wraps)", () => {
    const index = new Map<string, number>();
    const a = salespersonColor("Ali", index);
    const b = salespersonColor("Reza", index);
    expect(a).not.toBe(b);
  });
});
