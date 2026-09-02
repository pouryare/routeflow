import { describe, it, expect } from "vitest";
import { evaluateConditions, cooldownUntil, isEscalatable } from "@/lib/rules/engine";

describe("evaluateConditions", () => {
  it("no conditions is always true", () => {
    expect(evaluateConditions([], {})).toBe(true);
    expect(evaluateConditions(null, {})).toBe(true);
  });

  it("numeric comparisons", () => {
    expect(evaluateConditions([{ field: "overage", op: "gt", value: 0 }], { overage: 5 })).toBe(true);
    expect(evaluateConditions([{ field: "overage", op: "gt", value: 0 }], { overage: 0 })).toBe(false);
    expect(evaluateConditions([{ field: "n", op: "lte", value: 3 }], { n: 3 })).toBe(true);
  });

  it("in and eq/ne", () => {
    expect(evaluateConditions([{ field: "status", op: "in", value: ["a", "b"] }], { status: "b" })).toBe(true);
    expect(evaluateConditions([{ field: "status", op: "in", value: ["a", "b"] }], { status: "c" })).toBe(false);
    expect(evaluateConditions([{ field: "x", op: "ne", value: 1 }], { x: 2 })).toBe(true);
  });

  it("exists with and without a negation", () => {
    expect(evaluateConditions([{ field: "batch_id", op: "exists" }], { batch_id: 4 })).toBe(true);
    expect(evaluateConditions([{ field: "batch_id", op: "exists" }], {})).toBe(false);
    expect(evaluateConditions([{ field: "batch_id", op: "exists", value: false }], {})).toBe(true);
  });

  it("dotted paths", () => {
    expect(
      evaluateConditions([{ field: "customer.balance", op: "gt", value: 100 }], { customer: { balance: 150 } })
    ).toBe(true);
  });

  it("all conditions must hold (AND)", () => {
    const c = [
      { field: "a", op: "gt", value: 0 },
      { field: "b", op: "eq", value: "x" },
    ] as const;
    expect(evaluateConditions([...c], { a: 1, b: "x" })).toBe(true);
    expect(evaluateConditions([...c], { a: 1, b: "y" })).toBe(false);
  });
});

describe("cooldown / escalation", () => {
  it("cooldownUntil adds the minutes", () => {
    expect(cooldownUntil("2026-03-01T10:00:00.000Z", 60)).toBe("2026-03-01T11:00:00.000Z");
  });

  it("isEscalatable respects the window and the flags", () => {
    const base = { fired_at: "2026-03-01T10:00:00.000Z", escalated_at: null, resolved_at: null };
    expect(isEscalatable(base, 60, "2026-03-01T11:30:00.000Z")).toBe(true);
    expect(isEscalatable(base, 60, "2026-03-01T10:30:00.000Z")).toBe(false);
    expect(isEscalatable(base, null, "2026-03-02T00:00:00.000Z")).toBe(false);
    expect(isEscalatable({ ...base, escalated_at: "x" }, 60, "2026-03-01T13:00:00.000Z")).toBe(false);
    expect(isEscalatable({ ...base, resolved_at: "x" }, 60, "2026-03-01T13:00:00.000Z")).toBe(false);
  });
});
