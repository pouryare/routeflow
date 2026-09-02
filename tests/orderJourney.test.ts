import { describe, expect, test } from "vitest";
import { buildJourney, type JourneyInput } from "@/lib/orderJourney";

const base: JourneyInput = {
  order_no: "1404-00012",
  customer_name: "سوپرمارکت رضایی",
  kg: 42,
  line_count: 3,
  status: "DRAFT",
  created_at: "2026-08-01T09:00:00.000Z",
  order_date: "2026-08-01",
  created_by_name: "زهرا احمدی",
  salesperson_name: "علی رضایی",
  run: null,
  delivered_at: null,
  delivered_by_name: null,
  total_toman: 1_000_000,
  paid_toman: 0,
  payment_status: "unpaid",
};

describe("buildJourney", () => {
  test("a draft has only the first step done", () => {
    const nodes = buildJourney(base);
    expect(nodes.map((n) => n.done)).toEqual([true, false, false, false]);
  });

  test("confirming ticks the second step and nothing further", () => {
    const nodes = buildJourney({ ...base, status: "CONFIRMED" });
    expect(nodes.map((n) => n.done)).toEqual([true, true, false, false]);
  });

  test("a run ticks the loading step and names the driver", () => {
    const nodes = buildJourney({
      ...base,
      status: "CONFIRMED",
      run: { date: "2026-08-03", driver_name: "مهدی کاظمی" },
    });
    expect(nodes[2].done).toBe(true);
    expect(nodes[2].person).toBe("مهدی کاظمی");
    expect(nodes[2].at).toBe("2026-08-03");
  });

  test("delivery needs BOTH the status and a timestamp", () => {
    // status alone is not enough: an order marked delivered with no delivered_at is a
    // half-written record, and ticking it would hide that.
    const noStamp = buildJourney({ ...base, status: "DELIVERED", delivered_at: null });
    expect(noStamp[3].done).toBe(false);

    const stamped = buildJourney({
      ...base,
      status: "DELIVERED",
      delivered_at: "2026-08-03T14:20:00.000Z",
      paid_toman: 1_000_000,
      payment_status: "paid",
    });
    expect(stamped[3].done).toBe(true);
  });

  test("the settled note states what was collected against the total", () => {
    const nodes = buildJourney({
      ...base,
      status: "DELIVERED",
      delivered_at: "2026-08-03T14:20:00.000Z",
      paid_toman: 400_000,
      payment_status: "partial",
    });
    expect(nodes[3].note).toContain("۴۰۰٬۰۰۰");
    expect(nodes[3].note).toContain("۱٬۰۰۰٬۰۰۰");
  });

  test("a cancelled order says so instead of sitting in wait forever", () => {
    const nodes = buildJourney({ ...base, status: "CANCELLED" });
    expect(nodes[1].done).toBe(false);
    expect(nodes[1].note).toBe("سفارش لغو شد");
  });

  test("the confirm step never carries a timestamp", () => {
    // There is no confirmed_at column; updated_at moves whenever anyone edits a note.
    for (const status of ["DRAFT", "CONFIRMED", "DELIVERED"]) {
      expect(buildJourney({ ...base, status })[1].at).toBeNull();
    }
  });
});

describe("journey state", () => {
  test("exactly one step is current, and it is the first unfinished one", () => {
    const nodes = buildJourney({ ...base, status: "CONFIRMED" });
    expect(nodes.filter((n) => n.state === "current")).toHaveLength(1);
    expect(nodes.find((n) => n.state === "current")!.key).toBe("loaded");
    expect(nodes.map((n) => n.state)).toEqual(["done", "done", "current", "todo"]);
  });

  test("a finished order has no current step at all", () => {
    const nodes = buildJourney({
      ...base,
      status: "DELIVERED",
      delivered_at: "2026-08-03T14:20:00.000Z",
      run: { date: "2026-08-03", driver_name: "مهدی" },
      paid_toman: 1_000_000,
      payment_status: "paid",
    });
    expect(nodes.every((n) => n.state === "done")).toBe(true);
  });

  test("every step explains itself, so the lane title is never the only words", () => {
    for (const n of buildJourney(base)) {
      expect(n.what.length).toBeGreaterThan(20);
      expect(n.role.length).toBeGreaterThan(2);
    }
  });

  test("a partly-paid delivery states what is still owed", () => {
    const nodes = buildJourney({
      ...base,
      status: "DELIVERED",
      delivered_at: "2026-08-03T14:20:00.000Z",
      paid_toman: 400_000,
      payment_status: "partial",
    });
    expect(nodes[3].note).toContain("مانده");
  });
});
