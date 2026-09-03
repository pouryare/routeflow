import { describe, it, expect } from "vitest";
import { groupKeyFor, renderNotification, type FanoutContext } from "@/lib/repo/notifications";

const base: FanoutContext = {
  kind: "order.passReview",
  entity_type: "order",
  entity_id: 1234,
  occurred_at: "2026-06-01T09:00:00.000Z",
  meta: {},
};

describe("groupKeyFor", () => {
  // Spec ("Bundling"): type_day -> "{type_code}:{jalali_date}". The key is derived from
  // the notification type_code passed in, not from ctx.kind (the raw event kind) -- here
  // base.kind is "order.passReview" but the type_code under test is "order.confirmed".
  it("entity scope keys by entity type + id", () => {
    expect(groupKeyFor("entity", base, "order.confirmed")).toBe("order:1234");
  });

  it("type_day scope keys by type_code + jalali date (stable within a day)", () => {
    const a = groupKeyFor("type_day", { ...base, occurred_at: "2026-06-01T06:00:00.000Z" }, "order.confirmed");
    const b = groupKeyFor("type_day", { ...base, occurred_at: "2026-06-01T20:00:00.000Z" }, "order.confirmed");
    expect(a).toBe(b);
    expect(a).toMatch(/^order\.confirmed:\d{4}-\d{2}-\d{2}$/);
  });

  it("entity scope with no entity falls back to type_code + day so the key is never empty", () => {
    const k = groupKeyFor("entity", { ...base, entity_type: null, entity_id: null }, "order.confirmed");
    expect(k).toMatch(/^order\.confirmed:\d{4}-\d{2}-\d{2}$/);
  });
});

describe("renderNotification", () => {
  it("uses a per-type Persian template and echoes a customer/order label from meta", () => {
    const r = renderNotification("delivery.failed", {
      ...base,
      kind: "delivery.failed",
      meta: { customer_name: "سوپر رضا", order_no: "1200" },
    });
    expect(r.title_fa).toContain("تحویل ناموفق");
    expect(r.body_fa ?? "").toContain("سوپر رضا");
  });

  it("falls back to the catalogue name when the type is unknown", () => {
    const r = renderNotification("something.unmapped", base);
    expect(r.title_fa.length).toBeGreaterThan(0);
    expect(r.body_fa).toBeNull();
  });
});
