import { describe, it, expect } from "vitest";
import { addCandidatesFor, pickCandidatesFor, toDateStr, type PlanRow } from "@/lib/plannerView";
import type { CustomerRow } from "@/lib/types";

const cust = (id: number, name: string, lat: number | null = 35, lng: number | null = 51) =>
  ({ id, business_name: name, customer_code: `C${id}`, lat, lng }) as unknown as CustomerRow;
const lead = (id: number, name: string, lat: number | null = 35) => ({ id, name, lat, lng: 51, address: null });
const plan = (entity_type: PlanRow["entity_type"], entity_id: number) => ({ entity_type, entity_id }) as PlanRow;

describe("planner view helpers", () => {
  it("formats a date as ISO without timezone shifts", () => {
    expect(toDateStr(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
  it("offers customers and leads matching the query, not those already planned, keyed by type", () => {
    const out = addCandidatesFor("shop", [cust(5, "shop a"), cust(6, "shop b")], [lead(5, "shop lead")], [plan("customer", 6)]);
    expect(out.map((c) => c.kind)).toEqual(["customer", "lead"]);
    expect(addCandidatesFor("  ", [cust(1, "x")], [], [])).toEqual([]);
  });
  it("lists only placed, unplanned pins for the pick map", () => {
    const out = pickCandidatesFor([cust(1, "a"), cust(2, "b", null, null)], [lead(1, "l"), lead(2, "m", null as unknown as number)], [plan("lead_location", 1)]);
    expect(out.map((p) => p.key)).toEqual(["c1"]);
  });
});
