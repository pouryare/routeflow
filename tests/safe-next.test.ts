import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/safeNext";

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/sales/orders?view=board")).toBe("/sales/orders?view=board");
    expect(safeNextPath("/")).toBe("/");
  });
  it.each([
    "https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)",
    "evil.example", "", "/ok\nHost: x", "/a\\b",
  ])("drops %j", (v) => {
    expect(safeNextPath(v)).toBeNull();
  });
  it("drops null, undefined and oversized values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("/" + "a".repeat(2000))).toBeNull();
  });
});
