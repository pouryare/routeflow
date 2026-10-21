import "./helpers/sheetHost";
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Keypad from "@/components/mobile/Keypad";
import DayChips from "@/components/mobile/DayChips";
import DateStep from "@/components/tapflow/DateStep";

describe("phone input components render", () => {
  it("keypad: 12 keys, Persian readout, no text field", () => {
    const out = renderToStaticMarkup(h(Keypad, { value: "1250000", onChange: () => {}, unit: "تومان", suggested: 1250000 }));
    expect(out).toContain("۱٬۲۵۰٬۰۰۰");
    expect(out.match(/keypad__key/g)!.length).toBeGreaterThanOrEqual(12);
    expect(out).not.toContain("<input");
  });
  it("day chips: today first, an 'other day' way out, groups itself by name", () => {
    const out = renderToStaticMarkup(h(DayChips, { value: "", onChange: () => {}, ariaLabel: "روز تحویل" }));
    expect(out).toContain('aria-label="روز تحویل"');
    expect(out).toContain("امروز");
    expect(out).toContain("فردا");
    expect(out).toContain("روز دیگر");
  });
  it("date step with no presets shows day chips instead of the calendar", () => {
    const out = renderToStaticMarkup(
      h(DateStep, { optionId: "go", optionLabel: "ثبت روز", from: "2026-10-21", presets: [], ariaLabel: "روز", submit: () => {} }),
    );
    expect(out).toContain("daychips");
  });
});
