import { describe, it, expect } from "vitest";
import {
  legalOrderActions,
  canAdvanceOrder,
  type OrderRole,
} from "@/lib/orderStateMachine";

/** What a person who is BOTH a field rep and a delivery driver, with `field_rep` ACTIVE,
 *  must still be able to do. This is the case the single-role guard used to refuse: the
 *  design's own promise, broken at the last step, in a van, with a Persian error. */
const DUAL_HAT: OrderRole[] = ["field_rep", "delivery_driver"];

describe("the order state machine, for someone with two roles", () => {
  it("lets a dual-hat person start the route", () => {
    expect(canAdvanceOrder("READY", "startRoute", DUAL_HAT)).toBe(true);
  });

  it("lets a dual-hat person deliver a stop", () => {
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "deliver", DUAL_HAT)).toBe(true);
  });

  it("offers them the same buttons it will let them fire", () => {
    // A button the guard would refuse is worse than a missing one: it is a lie the driver
    // taps in a van. legalOrderActions renders, canAdvanceOrder enforces.
    for (const action of legalOrderActions("OUT_FOR_DELIVERY", DUAL_HAT)) {
      expect(canAdvanceOrder("OUT_FOR_DELIVERY", action, DUAL_HAT), action).toBe(true);
    }
  });

  it("still refuses them a manager-only edge", () => {
    expect(canAdvanceOrder("DELIVERED", "returnOrder", DUAL_HAT)).toBe(false);
    expect(canAdvanceOrder("PENDING_CREDIT", "approveCredit", DUAL_HAT)).toBe(false);
  });

  it("does not give a plain field rep the delivery buttons", () => {
    // A field rep who does NOT drive must not be offered `deliver`, or we have granted
    // exactly the access the split was meant to remove.
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "deliver", ["field_rep"])).toBe(false);
    expect(legalOrderActions("OUT_FOR_DELIVERY", ["field_rep"])).not.toContain("deliver");
  });

  it("still accepts a SINGLE role, so the ~139 existing call sites are untouched", () => {
    // Backward compatibility is the whole reason this is a union rather than a new
    // function: every existing `canAdvanceOrder(from, action, actor.role)` keeps working.
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "deliver", "delivery_driver")).toBe(true);
    expect(canAdvanceOrder("DELIVERED", "returnOrder", "owner")).toBe(true);
    expect(canAdvanceOrder("DELIVERED", "returnOrder", "phone_sales")).toBe(false);
  });

  it("a set and the single role it contains agree", () => {
    for (const r of ["phone_sales", "group_manager", "owner", "field_rep", "delivery_driver", "system"] as OrderRole[]) {
      expect(canAdvanceOrder("READY", "startRoute", [r]), r).toBe(canAdvanceOrder("READY", "startRoute", r));
      expect(legalOrderActions("OUT_FOR_DELIVERY", [r]), r).toEqual(legalOrderActions("OUT_FOR_DELIVERY", r));
    }
  });

  it("grants the union of a dual-hat person, not the intersection", () => {
    // A set means "holds ANY of these", so a person who is both gets BOTH worlds. Reading
    // it as an intersection would silently refuse everything they can legitimately do.
    const both = new Set(legalOrderActions("OUT_FOR_DELIVERY", DUAL_HAT));
    for (const a of [...legalOrderActions("OUT_FOR_DELIVERY", "field_rep"), ...legalOrderActions("OUT_FOR_DELIVERY", "delivery_driver")]) {
      expect(both.has(a), a).toBe(true);
    }
  });

  it("an empty set is refused everything, not everything", () => {
    // The degenerate case worth pinning: an empty array is not a wildcard.
    expect(canAdvanceOrder("OUT_FOR_DELIVERY", "deliver", [])).toBe(false);
    expect(legalOrderActions("OUT_FOR_DELIVERY", [])).toEqual([]);
  });
});
