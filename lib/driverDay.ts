import { isVanRole, type Role } from "./roles";

/** The two kinds of work a van role has, in the order they are read.
 *
 *  Pure on purpose. `/driver` is an async server component that calls cookies(), and
 *  vitest runs in a node environment where nothing renders a page — so the only way the
 *  spec's central promise ("a person sees all their work regardless of which hat is
 *  active") can be asserted is if the DECISION lives somewhere testable. This is that
 *  somewhere. See tests/driver-my-day-sections.test.ts.
 *
 *  Both, or neither. Not "deliveries if you are a delivery_driver" — that is the bug.
 *  A field rep with no delivery run today is told so by the empty state inside the
 *  section, which is an honest answer; a missing section is a lie. */
export type DriverDaySection = "deliveries" | "visits";

export function driverDaySections(role: Role): DriverDaySection[] {
  return isVanRole(role) ? ["deliveries", "visits"] : [];
}
