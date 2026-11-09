import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { figureChars } from "@/components/meridian/GradientStat";
import CountUp from "@/components/meridian/CountUp";

describe("figureChars", () => {
  it("counts what the figure prints, so a long total can shrink to fit its card", () => {
    // ۶۲۹٬۸۷۶٬۷۴۲٬۰۰۰: twelve digits and three separators.
    expect(figureChars(createElement(CountUp, { value: 629_876_742_000 }))).toBe(15);
    expect(figureChars(createElement(CountUp, { value: 0.5, mode: "pct" }))).toBe(3);
    expect(figureChars(createElement(CountUp, { value: 12, suffix: " مشتری" }))).toBe(8);
    expect(figureChars("۴٫۵")).toBe(3);
    expect(figureChars(null)).toBeUndefined();
  });
});
