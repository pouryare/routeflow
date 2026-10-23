import { describe, it, expect } from "vitest";
import { foldReasons, type ReasonEvent } from "@/lib/repo/reasonReport";

const ev = (domain: ReasonEvent["domain"], reasonLabel: string | null, valueToman = 100): ReasonEvent => ({
  domain,
  reasonLabel,
  orderId: 1,
  valueToman,
});

describe("foldReasons", () => {
  it("returns every area, even an empty one, in a fixed order", () => {
    const areas = foldReasons([]);
    expect(areas.map((a) => a.domain)).toEqual(["delivery_fail", "order_cancel", "order_return", "delivery_delay"]);
    expect(areas.every((a) => a.total === 0 && a.rows.length === 0)).toBe(true);
  });

  it("counts by reason, sorts the biggest first and adds up value", () => {
    const [fail] = foldReasons([
      ev("delivery_fail", "مغازه تعطیل بود", 100),
      ev("delivery_fail", "مغازه تعطیل بود", 300),
      ev("delivery_fail", "اختلاف بر سر مبلغ", 50),
    ]);
    expect(fail.total).toBe(3);
    expect(fail.valueToman).toBe(450);
    expect(fail.rows[0]).toMatchObject({ label: "مغازه تعطیل بود", count: 2, valueToman: 400 });
    expect(fail.rows[0].share).toBeCloseTo(2 / 3);
  });

  it("keeps events with no reason as their own row and counts them", () => {
    const cancel = foldReasons([ev("order_cancel", null), ev("order_cancel", "سفارش تکراری")])[1];
    expect(cancel.unexplained).toBe(1);
    expect(cancel.rows.map((r) => r.label)).toContain(null);
  });
});

