import "./helpers/sheetHost";
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FilterChips, { isActive, neutralOf, type FilterGroup } from "@/components/mobile/FilterChips";

const noop = () => {};
const single: FilterGroup = {
  id: "m", label: "روش", mode: "single", value: "CASH", onChange: noop,
  options: [{ id: "CASH", label: "نقد" }, { id: "POS", label: "کارت‌خوان" }],
};
const hidden: FilterGroup = {
  id: "v", label: "باطال‌شده‌ها", mode: "single", neutral: "hide", value: "only", sheet: true, onChange: noop,
  options: [{ id: "only", label: "فقط باطال‌شده‌ها" }],
};

describe("filter chips", () => {
  it("knows what 'no filter' is for each kind of group", () => {
    expect(neutralOf(single)).toBe("");
    expect(neutralOf(hidden)).toBe("hide");
    expect(neutralOf({ ...single, mode: "multi", value: [] })).toEqual([]);
    expect(isActive(single)).toBe(true);
    expect(isActive({ ...hidden, value: "hide" })).toBe(false);
    expect(isActive({ ...single, mode: "multi", value: ["a"] })).toBe(true);
  });
  it("renders chips as pressed toggles, no dropdown, and counts what is tucked away", () => {
    const out = renderToStaticMarkup(h(FilterChips, { groups: [single, hidden] }));
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain("کارت‌خوان");
    expect(out).toContain("فیلترها");
    expect(out).toContain("filterchip__badge");
    expect(out).not.toContain("<select");
  });
  it("a row with nothing tucked away has no filters button", () => {
    expect(renderToStaticMarkup(h(FilterChips, { groups: [single] }))).not.toContain("فیلترها");
  });
});
