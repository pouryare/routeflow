import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FilteredEmpty, { hiddenLine } from "@/components/FilteredEmpty";

describe("empty states name what is hidden (FB4)", () => {
  it("says how many the filter hides and offers to clear it", () => {
    expect(hiddenLine(3)).toBe("۳ مورد با این فیلتر پنهان است.");
    const h = renderToStaticMarkup(createElement(FilteredEmpty, { title: "یافت نشد", hidden: 3, onClear: () => {} }));
    expect(h).toContain("پاک کردن فیلتر");
  });

  it("has no clear button when nothing is hidden", () => {
    const h = renderToStaticMarkup(createElement(FilteredEmpty, { title: "یافت نشد", hidden: 0, onClear: () => {} }));
    expect(h).not.toContain("پاک کردن فیلتر");
  });
});
