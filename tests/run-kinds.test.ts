import { describe, expect, it } from "vitest";
import { STOP_KINDS, kindOfStop, tapActionFor, earnsCommission, isVanRoleWithBothHats } from "@/lib/runKinds";
import { ICONS } from "@/components/meridian/icon-map";
import type { Role } from "@/lib/roles";

describe("STOP_KINDS", () => {
  it("names exactly the three things a driver does in one day", () => {
    expect(STOP_KINDS.map((k) => k.kind)).toEqual(["delivery", "revisit", "new"]);
  });

  it("gives every kind an icon, a label and a tap action", () => {
    // A stop the driver cannot identify at a glance is a stop they will mis-tap, and a mis-tap
    // on a delivery collects money. So all three fields are checked for every kind, not just
    // that the table has three rows.
    for (const k of STOP_KINDS) {
      expect(k.icon, `${k.kind} needs an icon`).toBeTruthy();
      expect(k.labelFa, `${k.kind} needs a Persian label`).toBeTruthy();
      expect(k.tapAction, `${k.kind} needs a tap action`).toBeTruthy();
      expect(k.hintFa, `${k.kind} needs a hint`).toBeTruthy();
    }
  });

  it("names icons that actually exist in the meridian registry", () => {
    // Checking `icon` is truthy is not checking it is REAL. An earlier version named "store",
    // which the registry does not contain, and a truthiness assertion passed while the driver
    // saw no icon at all. The type catches it at compile time; this catches it if someone widens
    // the type back to `string`.
    for (const k of STOP_KINDS) {
      expect(ICONS, `${k.kind} names "${k.icon}", which is not a real icon`).toHaveProperty(k.icon);
    }
  });
});

describe("kindOfStop", () => {
  it("reads an order stop as a delivery", () => {
    expect(kindOfStop({ order_id: 12 })).toBe("delivery");
  });

  it("reads a stop with no order as a revisit", () => {
    // A `lead_run_stops` row has no order_id by construction, so that is the signal.
    expect(kindOfStop({ order_id: null })).toBe("revisit");
  });

  it("does not mistake a revisit for a delivery", () => {
    // The dangerous bug: order_id 0 would be falsy, so a naive `stop.order_id ? ... : ...` would
    // report an ordinary stop as a visit and send the driver to the wrong screen.
    expect(kindOfStop({ order_id: 0 })).toBe("delivery");
  });
});

describe("tapActionFor", () => {
  it("sends every kind through ONE tap", () => {
    // Q29: one gesture for all three. Each opens a different screen, but the gesture is the
    // same, because a driver in a van should not have to learn three interaction models.
    for (const k of STOP_KINDS) expect(k.tapAction).toBe(k.tapAction.toLowerCase());
    expect(tapActionFor("delivery")).toBe("complete");
    expect(tapActionFor("revisit")).toBe("complete");
    expect(tapActionFor("new")).toBe("complete");
  });
});

describe("earnsCommission", () => {
  it("pays only for a delivery", () => {
    // Commission is earned by kilograms delivered (driverCommissionLedger gates on commission.kg).
    // A visit earns none, so a mixed day shows a smaller number — which is correct, not a bug.
    expect(earnsCommission("delivery")).toBe(true);
    expect(earnsCommission("revisit")).toBe(false);
    expect(earnsCommission("new")).toBe(false);
  });
});

describe("isVanRoleWithBothHats", () => {
  it("is true for both van roles, because both hats are worn by one person", () => {
    expect(isVanRoleWithBothHats("delivery_driver")).toBe(true);
    expect(isVanRoleWithBothHats("field_rep")).toBe(true);
  });

  it("is false for everyone who never drives", () => {
    // Typed as Role[] rather than string[] so a typo here is a compile error instead of a test
    // that quietly stops checking a role that has since been renamed.
    const neverDrives: Role[] = ["phone_sales", "group_manager", "owner", "platform_owner"];
    for (const r of neverDrives) {
      expect(isVanRoleWithBothHats(r), r).toBe(false);
    }
  });
});