import { describe, it, expect } from "vitest";
import { ownerChangeNote } from "@/lib/repo/crm/ownerChange";

describe("ownerChangeNote", () => {
  it("names both sides and the reason", () => {
    expect(ownerChangeNote("pool_claim", "owner", null, "سارا")).toBe(
      "برداشتن از استخر گروه · مسئول: از «بدون مسئول» به «سارا»"
    );
  });

  it("says when a customer leaves every group", () => {
    expect(ownerChangeNote("territory", "group", "شمال", null)).toBe(
      "تغییر محدودهٔ گروه‌ها · گروه: از «شمال» به «بدون گروه»"
    );
  });
});
