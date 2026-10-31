import { describe, expect, it } from "vitest";
import { parseHideMoney } from "@/lib/hideMoney";

describe("hide money choice", () => {
  it("is hidden only when stored as 1", () => {
    expect(parseHideMoney("1")).toBe(true);
    expect(parseHideMoney("0")).toBe(false);
    expect(parseHideMoney(null)).toBe(false);
    expect(parseHideMoney("true")).toBe(false);
  });
});
