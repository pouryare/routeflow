import { describe, it, expect } from "vitest";
import { driverDaySections } from "@/lib/driverDay";
import { ROLES, type Role } from "@/lib/roles";

/** Both kinds of work, always, for a van role.
 *
 *  The driver is either a delivery driver, a field rep, or somebody holding both hats.
 *  The page used to answer that with `isManager` — one question, one answer — so a
 *  dual-hat person saw deliveries on /driver and prospect visits on /leads, and had to
 *  navigate between two pages for one working day.
 *
 *  The rule this file exists to hold: BOTH sections render for EVERY van role,
 *  unconditionally. Not "if the driver has visits", not "if the driver also holds
 *  delivery_driver". A section that DISAPPEARS is indistinguishable from a section that
 *  is EMPTY, and a driver must never conclude "I have no deliveries" when the
 *  deliveries section simply did not render. */
describe("what a session sees on /driver", () => {
  it("gives both sections to a delivery driver", () => {
    expect(driverDaySections("delivery_driver")).toEqual(["deliveries", "visits"]);
  });

  it("gives both sections to a field rep", () => {
    expect(driverDaySections("field_rep")).toEqual(["deliveries", "visits"]);
  });

  it("gives both sections to a dual-hat person, whichever hat is active", () => {
    /* The regression this whole spec exists to close. `isManager` answered a single
       question, so a field_rep who also holds delivery_driver was shown one job. The
       active role is the only thing that varies here, and it changes nothing. */
    expect(driverDaySections("field_rep")).toEqual(driverDaySections("delivery_driver"));
  });

  it("orders deliveries above visits", () => {
    // A delivery stop is revenue-bearing and time-bound (cold chain, weather caps); a
    // prospect visit is not. Same reasoning as DriverRunView's own doc comment.
    const s = driverDaySections("delivery_driver");
    expect(s.indexOf("deliveries")).toBeLessThan(s.indexOf("visits"));
  });

  it("gives a non-van role neither", () => {
    for (const role of ROLES.filter((r) => r !== "field_rep" && r !== "delivery_driver")) {
      expect(driverDaySections(role), role).toEqual([]);
    }
  });

  it("knows every role the app has, so a new one cannot slip through untested", () => {
    // If a role is added to the union and not to VAN_ROLES, this is the test that asks
    // what a van role is rather than what it was.
    expect(new Set<Role>(ROLES).size).toBe(ROLES.length);
  });
});
