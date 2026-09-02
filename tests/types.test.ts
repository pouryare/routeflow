import { describe, it, expect } from "vitest";
import {
  isDistrictColorMode,
  districtGroupColor,
  customerLifecycleColor,
  debtColor,
  salespersonColor,
  daysSinceLastPurchase,
  distanceColor,
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
    lifecycle: "lead",
    customer_type: null,
    parent_customer_id: null,
    payment_terms_days: 0,
    hard_credit_block: 0,
    credit_limit_toman: null,
    qualified_at: null,
    first_order_at: null,
    salesperson: null,
    opening_balance_toman: 0,
    notes: null,
    synced_at: "2026-01-01T00:00:00.000Z",
    last_purchase_date: null,
    ...overrides,
  };
}

describe("customerLifecycleColor", () => {
  it("maps active to the visited colour", () => {
    expect(customerLifecycleColor("active")).toBe(STATUS_COLOR.visited);
  });
  it("maps qualified / sampled / dormant to needs_coverage", () => {
    expect(customerLifecycleColor("qualified")).toBe(STATUS_COLOR.needs_coverage);
    expect(customerLifecycleColor("sampled")).toBe(STATUS_COLOR.needs_coverage);
    expect(customerLifecycleColor("dormant")).toBe(STATUS_COLOR.needs_coverage);
  });
  it("maps lost / blocked to not_allowed", () => {
    expect(customerLifecycleColor("lost")).toBe(STATUS_COLOR.not_allowed);
    expect(customerLifecycleColor("blocked")).toBe(STATUS_COLOR.not_allowed);
  });
  it("maps lead to unknown", () => {
    expect(customerLifecycleColor("lead")).toBe(STATUS_COLOR.unknown);
  });
});

describe("debtColor", () => {
  it("is not_allowed (crit) when bucket_30_plus > 0, regardless of other buckets", () => {
    expect(
      debtColor({ total: 3, bucket_30_plus: 1, bucket_8_30: 1, bucket_0_7: 1 })
    ).toBe(STATUS_COLOR.not_allowed);
  });
  it("is needs_coverage (warn) when only bucket_8_30 > 0", () => {
    expect(debtColor({ total: 1, bucket_30_plus: 0, bucket_8_30: 1, bucket_0_7: 0 })).toBe(
      STATUS_COLOR.needs_coverage
    );
  });
  it("is visited (good) when only the young bucket has debt", () => {
    expect(debtColor({ total: 500, bucket_30_plus: 0, bucket_8_30: 0, bucket_0_7: 500 })).toBe(
      STATUS_COLOR.visited
    );
  });
  it("is unknown when there is no debt object or no debt at all", () => {
    expect(debtColor(undefined)).toBe(STATUS_COLOR.unknown);
    expect(debtColor({ total: 0, bucket_30_plus: 0, bucket_8_30: 0, bucket_0_7: 0 })).toBe(
      STATUS_COLOR.unknown
    );
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

describe("distanceColor", () => {
  const origin = { lat: 35.753263, lng: 51.798381 };
  // For a due-north offset the haversine reduces exactly to R * dlat, so this places a
  // point at a precisely known distance. Using the mean 110.574 km/degree instead is off
  // by 0.6% -- enough to land a "10 km" point outside a 10 km band and fail the boundary
  // assertions for a reason that has nothing to do with the code under test.
  const KM_PER_DEG = (Math.PI / 180) * 6371.0088;
  const at = (km: number) => customer({ lat: origin.lat + km / KM_PER_DEG, lng: origin.lng });

  it("greens a customer inside the near band", () => {
    expect(distanceColor(at(5), origin)).toBe(STATUS_COLOR.visited);
  });

  it("ambers the middle band", () => {
    expect(distanceColor(at(15), origin)).toBe(STATUS_COLOR.needs_coverage);
  });

  it("reds anything past the far threshold", () => {
    expect(distanceColor(at(30), origin)).toBe(STATUS_COLOR.not_allowed);
  });

  // An unknown distance is not a short one, and must not read as a cheap customer.
  it("is neutral when the customer has no coordinates", () => {
    expect(distanceColor(customer({ lat: null, lng: null }), origin)).toBe(STATUS_COLOR.unknown);
  });

  it("is neutral when no origin is configured", () => {
    expect(distanceColor(at(5), null)).toBe(STATUS_COLOR.unknown);
  });

  it("puts the band boundaries on the near side", () => {
    expect(distanceColor(at(10), origin)).toBe(STATUS_COLOR.visited);
    expect(distanceColor(at(20), origin)).toBe(STATUS_COLOR.needs_coverage);
  });
})

describe("district colour modes", () => {
  it("accepts the two real modes and rejects anything else", () => {
    expect(isDistrictColorMode("status")).toBe(true);
    expect(isDistrictColorMode("group")).toBe(true);
    expect(isDistrictColorMode("owner")).toBe(false);
    expect(isDistrictColorMode(undefined)).toBe(false);
    expect(isDistrictColorMode(7)).toBe(false);
  });

  it("colours a district by its group", () => {
    const colors = new Map<number, string | null>([
      [1, "#2DE0E6"],
      [2, null],
    ]);
    expect(districtGroupColor(1, colors)).toBe("#2DE0E6");
    // A group with no colour set, and a district in no group at all, both fall back to
    // the neutral grey -- neither is a coverage status, so neither may borrow one.
    expect(districtGroupColor(2, colors)).toBe(STATUS_COLOR.unknown);
    expect(districtGroupColor(null, colors)).toBe(STATUS_COLOR.unknown);
    expect(districtGroupColor(99, colors)).toBe(STATUS_COLOR.unknown);
  });
});
