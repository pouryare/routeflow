import { describe, expect, it } from "vitest";
import { suggestOwnerUsername } from "@/lib/credentials";

describe("suggestOwnerUsername", () => {
  it("uses the name before the top-level domain", () => {
    expect(suggestOwnerUsername("app.taminodis.ir", "طعمینو")).toBe("taminodis.admin");
    expect(suggestOwnerUsername("taminodis.ir", "")).toBe("taminodis.admin");
  });
  it("falls back to a Latin company name, then a fixed word", () => {
    expect(suggestOwnerUsername("", "Tamino Co")).toBe("taminoco.admin");
    expect(suggestOwnerUsername("", "طعمینو")).toBe("company.admin");
  });
});
