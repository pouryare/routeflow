import { describe, it, expect } from "vitest";
import { isId } from "@/lib/inputChecks";

describe("isId", () => {
  it("accepts plain positive whole numbers only", () => {
    expect(isId("12")).toBe(true);
    for (const bad of ["abc", "0", "-1", "1e3", "0x1", "١٢", "1.5", "", " 1", "1 ", "9999999999999999"]) expect(isId(bad)).toBe(false);
  });
});

import { toNumber, toToman } from "@/lib/money";

describe("toNumber", () => {
  it("reads Persian, Arabic-Indic and Latin digits", () => {
    expect(toNumber("۱۲")).toBe(12);
    expect(toNumber("١٢٫٥")).toBe(12.5);
    expect(toNumber("1,200")).toBe(1200);
    expect(toNumber("abc")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toToman("۱٬۲۰۰")).toBe(1200);
  });
});
