import { describe, it, expect } from "vitest";
import { buildWorklist, inBounds, QUIET_DAYS, type Bounds, type WorkReminder } from "@/lib/mapWorklist";
import type { CustomerRow, DistrictProperties } from "@/lib/types";

const TODAY = "2026-09-10";
const VIEW: Bounds = { south: 35.6, west: 51.3, north: 35.8, east: 51.5 };
const IN = { lat: 35.7, lng: 51.4 };
const OUT = { lat: 36.5, lng: 52.0 };

const cust = (id: number, over: Partial<CustomerRow> = {}): CustomerRow =>
  ({
    id, customer_code: `C${id}`, business_name: `مشتری ${id}`, contact_person: null, phone: null,
    address: null, city: null, province: null, ...IN, lifecycle: "active", customer_type: null,
    parent_customer_id: null, payment_terms_days: 0, hard_credit_block: 0, credit_limit_toman: null,
    qualified_at: null, first_order_at: null, salesperson: null, opening_balance_toman: 0,
    notes: null, synced_at: TODAY, last_purchase_date: "2026-09-01", ...over,
  }) as CustomerRow;

const dist = (id: number, over: Partial<DistrictProperties> = {}): DistrictProperties => ({
  id, name: `منطقه ${id}`, level: "mahalle", parent_name: null, coverage_status: "visited",
  notes: null, is_custom: false, code: `M${id}`, updated_at: TODAY, group_id: null,
  centroid_lat: IN.lat, centroid_lng: IN.lng, ...over,
});

const ago = (days: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

describe("inBounds", () => {
  it("is inclusive at the edges and refuses a missing coordinate", () => {
    expect(inBounds(35.6, 51.3, VIEW)).toBe(true);
    expect(inBounds(null, 51.4, VIEW)).toBe(false);
    expect(inBounds(35.7, 52, VIEW)).toBe(false);
  });
});

describe("buildWorklist", () => {
  it("lists buying customers on screen who have gone quiet, longest silence first", () => {
    const w = buildWorklist(
      [cust(1, { last_purchase_date: ago(QUIET_DAYS) }), cust(2, { last_purchase_date: ago(90) }), cust(3, { last_purchase_date: ago(3) })],
      [], [], VIEW, TODAY,
    );
    expect(w.quiet.map((x) => x.customer.id)).toEqual([2, 1]);
    expect(w.quiet[0].days).toBe(90);
  });

  it("never sends anyone to a lead, a lost customer or one off screen", () => {
    const w = buildWorklist(
      [
        cust(1, { lifecycle: "lead", last_purchase_date: null }),
        cust(2, { lifecycle: "lost", last_purchase_date: ago(200) }),
        cust(3, { ...OUT, last_purchase_date: ago(200) }),
      ],
      [], [], VIEW, TODAY,
    );
    expect(w.quiet).toEqual([]);
  });

  it("a customer marked dormant counts whatever the date says", () => {
    const w = buildWorklist([cust(1, { lifecycle: "dormant", last_purchase_date: ago(2) })], [], [], VIEW, TODAY);
    expect(w.quiet).toHaveLength(1);
  });

  it("places a reminder by its customer or its district, and drops one off screen", () => {
    const reminders: WorkReminder[] = [
      { id: 1, entity_type: "customer", entity_id: 10, label: "a", message: "" },
      { id: 2, entity_type: "district", entity_id: 20, label: "b", message: "" },
      { id: 3, entity_type: "customer", entity_id: 11, label: "c", message: "" },
      { id: 4, entity_type: "customer", entity_id: 999, label: "gone", message: "" },
    ];
    const w = buildWorklist([cust(10), cust(11, OUT)], reminders, [dist(20)], VIEW, TODAY);
    expect(w.reminders.map((r) => r.id)).toEqual([1, 2]);
  });

  it("lists districts that need coverage and have their centre on screen", () => {
    const w = buildWorklist(
      [], [],
      [dist(1, { coverage_status: "needs_coverage" }), dist(2), dist(3, { coverage_status: "needs_coverage", centroid_lat: 40 })],
      VIEW, TODAY,
    );
    expect(w.uncovered.map((d) => d.id)).toEqual([1]);
  });

  it("caps each list but reports the true totals", () => {
    const many = Array.from({ length: 10 }, (_, i) => cust(i + 1, { last_purchase_date: ago(60 + i) }));
    const w = buildWorklist(many, [], [], VIEW, TODAY, 4);
    expect(w.quiet).toHaveLength(4);
    expect(w.totals.quiet).toBe(10);
  });
});
