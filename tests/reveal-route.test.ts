import { describe, expect, it } from "vitest";
import { selectorsFor } from "@/components/meridian/RevealRoute";

describe("RevealRoute selectorsFor", () => {
  it("uses the longest matching sales list", () => {
    expect(selectorsFor("/sales/orders/12")).toEqual(selectorsFor("/sales/orders"));
    expect(selectorsFor("/sales/orders/new")).toContain(".kblock");
  });

  it("gives every other shell page the default card selectors", () => {
    for (const path of ["/crm/leads", "/settings/security", "/accounting", "/my-share"]) {
      expect(selectorsFor(path)).toContain(".card");
    }
  });
});
