import { describe, it, expect } from "vitest";
import { dueDateFor, termLabel } from "@/lib/paymentTerms";
import { jalaliToIsoDate } from "@/lib/jalali";

describe("dueDateFor (D5)", () => {
  it("is the delivery day for cash on delivery", () => {
    expect(dueDateFor("cod", 30, "2026-11-13")).toBe("2026-11-13");
  });
  it("adds the days after delivery", () => {
    expect(dueDateFor("days", 10, "2026-11-13")).toBe("2026-11-23");
    expect(dueDateFor("days", 30, "2026-12-20")).toBe("2027-01-19");
  });
  it("counts from the last day of the Persian month for end-of-month terms", () => {
    const delivered = jalaliToIsoDate(1405, 8, 12);
    const monthEnd = jalaliToIsoDate(1405, 8, 30);
    expect(dueDateFor("eom", 0, delivered)).toBe(monthEnd);
    expect(dueDateFor("eom", 10, delivered)).toBe(dueDateFor("days", 10, monthEnd));
  });
  it("reads in words", () => {
    expect(termLabel("cod", 0)).toContain("نقد");
  });
});
